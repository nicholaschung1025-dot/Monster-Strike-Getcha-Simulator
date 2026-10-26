/* ==========================================================================
   sim-core.js — 《怪物彈珠》抽卡蒙地卡羅核心
   純函式模組：同時供 sim-worker.js（Web Worker）與 logic.js（主執行緒備援）使用。
   機率模型（與遊戲機制一致）：
     - 五星基礎出率 12%，四星 88%
     - 每抽到一隻四星(含以下) → 星星碎片 +1
     - 碎片累積 50 顆 → 觸發「非洲玉」保底五星，並扣除 50（超出 50 的餘數保留）
     - 非洲玉中目標角色的機率 = 目標常規機率 ÷ 12%
   ========================================================================== */
(function (global) {
  'use strict';

  /* 可重現亂數：mulberry32 */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIVE_STAR_RATE = 0.12;   // 預設五星基礎出率（超獸／激獸神祭 12%）
  const FRAGMENT_LIMIT = 50;     // 非洲玉所需星星碎片

  /* 依參數推導機率：
     pTarget  = 目標常規機率
     pFive    = 五星基礎出率（一般池 8.4%、極池 12%）
     pFour    = 1 - pFive（四星／以下，碎片來源）
     pJadeHit = 目標常規機率 ÷ 五星基礎出率 → 非洲玉中的中標機率 */
  function deriveRates(rate, baseRate) {
    const pTarget = rate / 100;
    const pFive = (baseRate || FIVE_STAR_RATE * 100) / 100;
    return {
      pTarget: pTarget,
      pFive: pFive,
      pFour: 1 - pFive,
      pJadeHit: pFive > 0 ? pTarget / pFive : 0
    };
  }

  /* ---------------------------------------------------------------------
     模式一：固定目標隻數 → 求抽數 (CDF)
     ------------------------------------------------------------------- */
  function createMode1Runner(params) {
    const iterations = params.iterations;
    const rates = deriveRates(params.rate, params.baseRate);
    const pTarget = rates.pTarget;
    const pFive = rates.pFive;
    const pJade = rates.pJadeHit;
    const target = params.targetCopies;
    const startShards = params.startShards;
    const results = new Int32Array(iterations);
    const rand = mulberry32(params.seed);
    let i = 0;

    function step(limit) {
      const end = Math.min(iterations, i + limit);
      for (; i < end; i++) {
        let hits = 0, pulls = 0, s = startShards;
        while (hits < target) {
          pulls++;
          const r = rand();
          if (r < pTarget) {
            hits++;
          } else if (r >= pFive) {
            s++;
            if (s >= FRAGMENT_LIMIT) {
              s -= FRAGMENT_LIMIT;
              if (rand() < pJade) hits++;
            }
          }
        }
        results[i] = pulls;
      }
      return i;
    }

    function finish() {
      results.sort();
      const at = function (p) {
        let idx = Math.floor(iterations * p);
        if (idx >= iterations) idx = iterations - 1;
        return results[idx];
      };
      /* 分位數的 95% 信賴區間：以經驗分佈的抽樣標準誤推估水平範圍，再映射回抽數 */
      const ciOf = function (p) {
        const se = Math.sqrt(p * (1 - p) / iterations);
        const atLevel = function (level) {
          let idx = Math.floor(iterations * level);
          if (idx >= iterations) idx = iterations - 1;
          return results[idx];
        };
        return {
          lo: atLevel(Math.max(0, p - 1.96 * se)),
          hi: atLevel(Math.min(1, p + 1.96 * se))
        };
      };
      let sum = 0;
      for (let k = 0; k < iterations; k++) sum += results[k];
      const mean = sum / iterations;

      const maxPulls = at(0.995);
      const cdfFull = new Float64Array(maxPulls + 1);
      let resIdx = 0;
      for (let p = 1; p <= maxPulls; p++) {
        while (resIdx < iterations && results[resIdx] <= p) resIdx++;
        cdfFull[p] = (resIdx / iterations) * 100;
      }
      // 抽稀到最多 900 個取樣點，維持曲線形狀
      const stride = Math.max(1, Math.ceil(maxPulls / 900));
      const xs = [], ys = [];
      for (let p = 1; p <= maxPulls; p += stride) { xs.push(p); ys.push(cdfFull[p]); }
      if (xs[xs.length - 1] !== maxPulls) { xs.push(maxPulls); ys.push(cdfFull[maxPulls]); }

      const levels = { p10: 0.10, p25: 0.25, p50: 0.50, p75: 0.75, p85: 0.85, p90: 0.90, p95: 0.95, p99: 0.99 };
      const ci = {};
      Object.keys(levels).forEach(function (k) { ci[k] = ciOf(levels[k]); });

      return {
        percentiles: {
          p10: at(0.10), p25: at(0.25), p50: at(0.50), p75: at(0.75),
          p85: at(0.85), p90: at(0.90), p95: at(0.95), p99: at(0.99)
        },
        ci: ci,
        mean: mean,
        maxPulls: maxPulls,
        cdf: { x: xs, y: ys }
      };
    }

    return {
      step: step,
      get done() { return i; },
      get total() { return iterations; },
      get complete() { return i >= iterations; },
      finish: finish
    };
  }

  /* ---------------------------------------------------------------------
     模式二：固定抽數 → 求隻數 (PDF)
     ------------------------------------------------------------------- */
  function createMode2Runner(params) {
    const iterations = params.iterations;
    const pulls = params.pulls;
    const rates = deriveRates(params.rate, params.baseRate);
    const pTarget = rates.pTarget;
    const pFive = rates.pFive;
    const pJade = rates.pJadeHit;
    const startShards = params.startShards;
    const counts = new Int32Array(pulls + 2);
    /* 抽數 → 期望值 曲線（含抽樣誤差）：每個抽數節點都累積一次 */
    const hitsByPull = new Float64Array(pulls + 1);
    const sqByPull = new Float64Array(pulls + 1);
    const rand = mulberry32(params.seed);
    let i = 0, totalHits = 0, totalJade = 0, totalFrags = 0, sumHitsSq = 0;

    function step(limit) {
      const end = Math.min(iterations, i + limit);
      for (; i < end; i++) {
        let hits = 0, s = startShards, jade = 0;
        for (let p = 0; p < pulls; p++) {
          const r = rand();
          if (r < pTarget) {
            hits++;
          } else if (r >= pFive) {
            s++;
            if (s >= FRAGMENT_LIMIT) {
              s -= FRAGMENT_LIMIT;
              jade++;
              if (rand() < pJade) hits++;
            }
          }
          hitsByPull[p + 1] += hits;
          sqByPull[p + 1] += hits * hits;
        }
        counts[hits]++;
        totalHits += hits;
        totalJade += jade;
        totalFrags += s;
        sumHitsSq += hits * hits;
      }
      return i;
    }

    function finish() {
      const dist = [];
      for (let k = 0; k < counts.length; k++) {
        if (counts[k] > 0 || k <= 12) dist.push({ k: k, count: counts[k] });
      }
      const mean = totalHits / iterations;
      const variance = Math.max(0, sumHitsSq / iterations - mean * mean);
      const se = Math.sqrt(variance / iterations);

      /* 抽數 → 期望值 曲線（最多 400 個取樣點） */
      const stride = Math.max(1, Math.ceil(pulls / 400));
      const curveX = [], curveMean = [], curveLo = [], curveHi = [];
      for (let p = stride; p <= pulls; p += stride) {
        const m = hitsByPull[p] / iterations;
        const v = Math.max(0, sqByPull[p] / iterations - m * m);
        const e = 1.96 * Math.sqrt(v / iterations);
        curveX.push(p);
        curveMean.push(m);
        curveLo.push(Math.max(0, m - e));
        curveHi.push(m + e);
      }
      if (curveX[curveX.length - 1] !== pulls) {
        const m = hitsByPull[pulls] / iterations;
        const v = Math.max(0, sqByPull[pulls] / iterations - m * m);
        const e = 1.96 * Math.sqrt(v / iterations);
        curveX.push(pulls);
        curveMean.push(m);
        curveLo.push(Math.max(0, m - e));
        curveHi.push(m + e);
      }

      return {
        dist: dist,
        expectation: mean,
        stdErr: se,
        ci95: { lo: mean - 1.96 * se, hi: mean + 1.96 * se },
        curve: { x: curveX, mean: curveMean, lo: curveLo, hi: curveHi },
        avgJade: totalJade / iterations,
        avgFragments: totalFrags / iterations,
        jadePer100: (totalJade / iterations / pulls) * 100
      };
    }

    return {
      step: step,
      get done() { return i; },
      get total() { return iterations; },
      get complete() { return i >= iterations; },
      finish: finish
    };
  }

  /* 運算量估算：避免玩家在極端參數下（如 20 隻 × 100 萬次）等到天荒地老 */
  function estimateWork(mode, params) {
    const rates = deriveRates(params.rate, params.baseRate);
    const pTarget = rates.pTarget;
    const pFour = rates.pFour;
    const pJade = rates.pJadeHit;
    let pullsPerSim;
    if (mode === 'mode2') {
      pullsPerSim = params.pulls;
    } else {
      // 每抽的期望命中數 = 直接命中 + 四星碎片累積帶來的非洲玉貢獻
      const perPull = pTarget + (pFour / FRAGMENT_LIMIT) * pJade;
      pullsPerSim = perPull > 0 ? params.targetCopies / perPull : params.targetCopies * 1000;
    }
    const steps = params.iterations * pullsPerSim;
    return {
      pullsPerSim: Math.round(pullsPerSim),
      steps: Math.round(steps),
      seconds: Math.round(steps / 20000000) // 以每秒 2000 萬步保守估算（一般桌機瀏覽器）
    };
  }

  global.MSSim = {
    mulberry32: mulberry32,
    deriveRates: deriveRates,
    estimateWork: estimateWork,
    FIVE_STAR_RATE: FIVE_STAR_RATE,
    FRAGMENT_LIMIT: FRAGMENT_LIMIT,
    createMode1Runner: createMode1Runner,
    createMode2Runner: createMode2Runner
  };
})(typeof self !== 'undefined' ? self : this);
