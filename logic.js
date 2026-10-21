/* ==========================================================================
   logic.js — 怪物彈珠抽卡分析器：儀表板邏輯、圖表與模擬調度
   依賴：sim-core.js（蒙地卡羅核心）、Chart.js（圖表）
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var nf = function (n) { return Number(n).toLocaleString('en-US'); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ======================================================================
     0. Chart.js 主題
     ====================================================================== */
  if (window.Chart) {
    Chart.defaults.color = '#a7b3e4';
    Chart.defaults.borderColor = 'rgba(146,172,255,.12)';
    Chart.defaults.font.family = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
    Chart.defaults.font.size = 12.5;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(8,12,38,.96)';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(146,172,255,.35)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 11;
    Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
  }

  /* 百分位垂直標記 */
  var percentilePlugin = {
    id: 'percentiles',
    afterDatasetsDraw: function (chart) {
      var opts = chart.options.plugins && chart.options.plugins.percentiles;
      if (!opts || !opts.marks) return;
      var ctx = chart.ctx, area = chart.chartArea, sx = chart.scales.x;
      var placed = [];
      opts.marks.forEach(function (m) {
        var x = sx.getPixelForValue(m.x);
        if (x < area.left - 1 || x > area.right + 1) return;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        var text = m.label + ' · ' + nf(m.value) + ' 抽';
        ctx.font = '700 11.5px ' + Chart.defaults.font.family;
        var w = ctx.measureText(text).width + 12;
        var bx = clamp(x - w / 2, area.left, area.right - w);
        var by = area.top + 3;
        // 標籤互相重疊時往下錯開
        placed.forEach(function (p) {
          if (bx < p.x + p.w + 4 && bx + w > p.x - 4 && Math.abs(by - p.y) < 22) by = p.y + 23;
        });
        placed.push({ x: bx, y: by, w: w });
        ctx.fillStyle = 'rgba(8,12,38,.9)';
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bx, by, w, 20, 6);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(bx, by, w, 20);
        }
        ctx.fillStyle = m.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + w / 2, by + 10);
        ctx.restore();
      });
    }
  };
  if (window.Chart) Chart.register(percentilePlugin);

  /* ======================================================================
     1. 參數讀取 / 驗證 / 儲存
     ====================================================================== */
  var STORE_KEY = 'ms-gacha-params-v2';

  function readParams() {
    return {
      rate: clamp(parseFloat($('#targetRate').value) || 0, 0.05, 12),
      baseRate: clamp(parseFloat($('#baseRate').value) || 12, 1, 12),
      shards: clamp(parseInt($('#currentShards').value, 10) || 0, 0, 50),
      iterations: clamp(parseInt($('#simCount').value, 10) || 1000000, 10000, 5000000),
      copies: clamp(parseInt($('#targetCopies').value, 10) || 1, 1, 20),
      pulls: clamp(parseInt($('#simPulls').value, 10) || 100, 1, 5000),
      seed: $('#seed').value.trim()
    };
  }

  function saveParams() {
    var p = readParams();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        rate: p.rate, baseRate: p.baseRate, shards: p.shards,
        iterations: p.iterations, copies: p.copies, pulls: p.pulls, seed: p.seed
      }));
    } catch (e) { /* 隱私模式可能不可用 */ }
  }

  function loadParams() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p.rate) $('#targetRate').value = p.rate;
      if (p.baseRate) $('#baseRate').value = p.baseRate;
      if (p.shards != null) $('#currentShards').value = p.shards;
      if (p.iterations) $('#simCount').value = p.iterations;
      if (p.copies) $('#targetCopies').value = p.copies;
      if (p.pulls) $('#simPulls').value = p.pulls;
      if (p.seed) $('#seed').value = p.seed;
    } catch (e) { /* 忽略格式錯誤 */ }
  }

  /* ======================================================================
     2. 星星碎片格
     ====================================================================== */
  (function shardGrid() {
    var grid = document.getElementById('shardGrid');
    if (!grid) return;
    for (var i = 0; i < 50; i++) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'frag-cell';
      c.setAttribute('aria-label', '星星碎片 ' + (i + 1));
      c.dataset.index = String(i);
      grid.appendChild(c);
    }
    grid.addEventListener('click', function (e) {
      var cell = e.target.closest('.frag-cell');
      if (!cell) return;
      var idx = parseInt(cell.dataset.index, 10);
      var current = parseInt($('#currentShards').value, 10) || 0;
      $('#currentShards').value = (current === idx + 1) ? idx : idx + 1;
      $('#currentShards').dispatchEvent(new Event('change'));
      syncShardGrid();
      saveParams();
    });
  })();

  function syncShardGrid() {
    var grid = document.getElementById('shardGrid');
    if (!grid) return;
    var n = clamp(parseInt($('#currentShards').value, 10) || 0, 0, 50);
    $$('.frag-cell', grid).forEach(function (c, i) { c.classList.toggle('on', i < n); });
  }

  /* ======================================================================
     3. 機率預設 / 摘要 / 對照表 / 運算量
     ====================================================================== */
  (function ratePresets() {
    var wrap = document.getElementById('ratePresets');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      $('#targetRate').value = chip.dataset.rate;
      syncRateChips();
      saveParams();
    });
  })();

  function syncRateChips() {
    var v = parseFloat($('#targetRate').value);
    $$('#ratePresets .chip').forEach(function (c) {
      c.classList.toggle('active', Math.abs(parseFloat(c.dataset.rate) - v) < 0.001);
    });
  }

  function jadeRate(rate, baseRate) {
    return baseRate > 0 ? (rate / baseRate) * 100 : 0;
  }

  function updateSummary() {
    var p = readParams();
    var j = jadeRate(p.rate, p.baseRate);
    var pFour = (100 - p.baseRate) / 100;
    var gap = pFour > 0 ? Math.round(50 / pFour) : 50;

    var el = document.getElementById('setupSummary');
    if (el) {
      el.innerHTML = '非洲玉中標率 <strong>' + j.toFixed(1) + '%</strong> · 平均約 <strong>' + gap +
        ' 抽</strong>觸發一次非洲玉 · 碎片剩餘 <strong>' + p.shards + '</strong> 顆';
    }
    var cardRate = document.getElementById('cardRate');
    if (cardRate) cardRate.textContent = p.rate.toFixed(p.rate % 1 === 0 ? 0 : 1);
    var cardJade = document.getElementById('cardJade');
    if (cardJade) cardJade.textContent = j.toFixed(1);
    var metaRate = document.getElementById('metaRate');
    if (metaRate) metaRate.textContent = p.rate + '%';
    var metaJade = document.getElementById('metaJade');
    if (metaJade) metaJade.textContent = j.toFixed(1) + '%';
    var metaIter = document.getElementById('metaIter');
    if (metaIter) metaIter.textContent = (p.iterations / 10000) + ' 萬';

    renderJadeTable(p);
    updateWorkEstimate();
  }

  function renderJadeTable(p) {
    var tbody = document.querySelector('#jadeTable tbody');
    if (!tbody) return;
    var rows = [
      { r: 0.4, d: '一般轉蛋的限定角色（未加倍）' },
      { r: 0.6, d: '一般轉蛋的限定角色（加倍）' },
      { r: 0.9, d: '常設角色／部分限定' },
      { r: 1.2, d: '超獸・激獸神祭的當期主角' },
      { r: 1.4, d: '新系列轉蛋的特別角色' },
      { r: 1.8, d: '期間限定角色的常見出貨率' }
    ];
    tbody.innerHTML = rows.map(function (row) {
      var j = jadeRate(row.r, p.baseRate);
      var mult = (row.r / 100) > 0 ? j / (row.r) : 0;
      return '<tr>' +
        '<td class="num"><span class="rank-badge">' + row.r.toFixed(1) + '%</span></td>' +
        '<td class="num pct">' + j.toFixed(1) + '%</td>' +
        '<td class="num">' + mult.toFixed(1) + '×</td>' +
        '<td>' + row.d + '</td>' +
        '</tr>';
    }).join('');
  }

  /* 運算量預估：極端參數會讓玩家等上數分鐘，先提示 */
  var WORK_BUDGET_STEPS = 120000000;

  function updateWorkEstimate() {
    var p = readParams();
    if (!window.MSSim || !MSSim.estimateWork) return;
    var configs = [
      ['1', 'mode1', { iterations: p.iterations, rate: p.rate, baseRate: p.baseRate, targetCopies: p.copies }],
      ['2', 'mode2', { iterations: p.iterations, rate: p.rate, baseRate: p.baseRate, pulls: p.pulls }]
    ];
    configs.forEach(function (cfg) {
      var el = document.getElementById('workEstimate' + cfg[0]);
      if (!el) return;
      var w = MSSim.estimateWork(cfg[1], cfg[2]);
      var sec = Math.max(1, w.seconds);
      var txt = '預估 ' + nf(w.steps) + ' 次抽卡模擬 · 約 ' + (sec >= 60 ? Math.round(sec / 60) + ' 分鐘' : sec + ' 秒');
      if (w.steps > WORK_BUDGET_STEPS * 6) { txt += '（偏久，建議降低樣本數）'; el.className = 'work-hint work-warn'; }
      else if (w.steps > WORK_BUDGET_STEPS) { txt += '（略久）'; el.className = 'work-hint work-warn'; }
      else { el.className = 'work-hint'; }
      el.textContent = txt;
    });
  }

  /* ======================================================================
     4. 模擬調度（Worker 優先，失敗退回主執行緒分批）
     ====================================================================== */
  function runSimulation(mode, params, hooks) {
    var ctrl = { cancelled: false, worker: null, fallback: false };
    var canUseWorker = !!(window.Worker && window.MSSim && location.protocol !== 'file:');
    window.MSApp = window.MSApp || {};
    window.MSApp.runner = canUseWorker ? 'worker' : 'fallback';

    function startFallback() {
      ctrl.fallback = true;
      window.MSApp.runner = 'fallback';
      var runner = mode === 'mode2' ? MSSim.createMode2Runner(params) : MSSim.createMode1Runner(params);
      var t0 = performance.now();
      function tick() {
        if (ctrl.cancelled) return;
        runner.step(20000);
        hooks.onProgress(runner.done, runner.total);
        if (runner.complete) {
          var res = runner.finish();
          res.elapsed = performance.now() - t0;
          res.iterations = runner.total;
          hooks.onDone(res);
        } else {
          setTimeout(tick, 0);
        }
      }
      setTimeout(tick, 0);
    }

    if (!canUseWorker) { startFallback(); return ctrl; }

    try {
      var w = new Worker('sim-worker.js');
      ctrl.worker = w;
      var restarted = false;
      w.onmessage = function (e) {
        var m = e.data || {};
        if (m.type === 'progress') hooks.onProgress(m.done, m.total);
        else if (m.type === 'done') { w.terminate(); hooks.onDone(m.result); }
        else if (m.type === 'cancelled') { w.terminate(); }
      };
      w.onerror = function (e) {
        window.MSApp.workerError = (e && e.message) ? e.message : 'worker error';
        w.terminate();
        if (!restarted) { restarted = true; startFallback(); }
      };
      w.postMessage({ mode: mode, params: params });
    } catch (err) {
      startFallback();
    }
    return ctrl;
  }

  function cancelRun(ctrl) {
    if (!ctrl) return;
    ctrl.cancelled = true;
    if (ctrl.worker) {
      try { ctrl.worker.postMessage({ cmd: 'cancel' }); } catch (e) { }
      ctrl.worker.terminate();
    }
  }

  function setProgress(prefix, pct, label) {
    var fill = $('#progressFill' + prefix);
    var txt = $('#progressText' + prefix);
    var pctEl = $('#progressPct' + prefix);
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    if (txt) txt.textContent = label;
    if (pctEl) pctEl.textContent = pct.toFixed(0) + '%';
  }

  function countUp(el, to, dur, decimals) {
    if (!el) return;
    dur = dur || 800;
    if (reduceMotion) {
      el.textContent = decimals ? to.toFixed(decimals) : nf(to);
      return;
    }
    var t0 = performance.now();
    function frame(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      var v = to * e;
      el.textContent = decimals ? v.toFixed(decimals) : nf(Math.round(v));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ======================================================================
     5. 分頁切換 / 圖表軸切換 / 曲線疊圖
     ====================================================================== */
  function switchView(viewId) {
    $$('.dash-tab').forEach(function (t) {
      var on = t.dataset.view === viewId;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.dash-view').forEach(function (v) { v.hidden = (v.id !== viewId); });
  }

  var axisMode = 'pulls';
  var savedCurves = [];
  var CURVE_COLORS = ['#7cf3c0', '#9d84ff', '#ff9d5c'];

  /* ======================================================================
     6. 模式一
     ====================================================================== */
  var cdfChart = null, pdfChart = null, curveChart = null, ciChart = null, ciChart2 = null;
  var activeRun1 = null, activeRun2 = null;
  var lastMode1 = null;

  function runMode1() {
    var p = readParams();
    if (activeRun1) return;

    var seed = p.seed ? (parseInt(p.seed, 10) >>> 0) : (Math.random() * 4294967295) >>> 0;
    $('#seed').value = String(seed);
    saveParams();

    var btn = $('#btnMode1'), cancel = $('#btnCancel1');
    btn.disabled = true; cancel.hidden = false;
    $('#progress1').hidden = false;
    setProgress('1', 0, '運算中…');

    activeRun1 = runSimulation('mode1', {
      iterations: p.iterations, rate: p.rate, baseRate: p.baseRate,
      targetCopies: p.copies, startShards: p.shards, seed: seed
    }, {
      onProgress: function (done, total) {
        setProgress('1', total ? (done / total) * 100 : 0, '模擬中… ' + nf(done) + ' / ' + nf(total));
      },
      onDone: function (res) {
        activeRun1 = null;
        btn.disabled = false; cancel.hidden = true;
        $('#progress1').hidden = true;
        renderMode1(res, p, seed);
      }
    });
  }

  function renderMode1(res, p, seed) {
    var pc = res.percentiles;
    lastMode1 = { res: res, p: p };
    $('#dispSimCount1').textContent = nf(res.iterations);

    [['stat25', pc.p25], ['stat50', pc.p50], ['stat85', pc.p85], ['stat99', pc.p99]].forEach(function (pair) {
      countUp(document.getElementById(pair[0]), pair[1], 900, 0);
      countUp(document.getElementById(pair[0] + 'Orbs'), pair[1] * 5, 900, 0);
    });

    var results = $('#mode1Results');
    results.hidden = false;
    results.style.animation = 'none';
    void results.offsetWidth;
    results.style.animation = '';

    var remarks = {
      10: '天選之子（超幸運）', 25: '運氣極佳', 50: '中位數（一般水準）', 75: '運氣偏弱',
      85: '多數玩家的保底極限', 90: '開始進入非酋領域', 95: '嚴重非酋', 99: '幾乎 100% 能出貨的防線'
    };
    var order = [10, 25, 50, 75, 85, 90, 95, 99];
    var tbody = document.querySelector('#milestoneTable tbody');
    tbody.innerHTML = order.map(function (k) {
      var v = pc['p' + k];
      var ci = res.ci ? res.ci['p' + k] : null;
      return '<tr>' +
        '<td><span class="rank-badge">' + k + '%</span></td>' +
        '<td class="num">' + nf(v) + ' 抽</td>' +
        '<td class="num">' + nf(v * 5) + ' 寶珠</td>' +
        '<td class="ci">' + (ci ? nf(ci.lo) + '～' + nf(ci.hi) + ' 抽' : '—') + '</td>' +
        '<td>' + remarks[k] + '</td>' +
        '</tr>';
    }).join('');

    drawCdf(res, pc);
    drawCiChart(res);

    var pFour = (100 - p.baseRate) / 100;
    var gap = pFour > 0 ? Math.round(50 / pFour) : 50;
    $('#mode1Note').innerHTML =
      '本次模擬：目標常規機率 <strong>' + p.rate + '%</strong> · 五星基礎出率 <strong>' + p.baseRate +
      '%</strong> · 非洲玉中標率 <strong>' + jadeRate(p.rate, p.baseRate).toFixed(1) +
      '%</strong> · 初始碎片 <strong>' + p.shards + ' / 50</strong> · 樣本數 <strong>' + nf(res.iterations) +
      '</strong> · 平均 <strong>' + res.mean.toFixed(1) + ' 抽</strong> · 種子 <code>' + seed + '</code>' +
      ' · 曲線階梯間距約 <strong>' + gap + ' 抽</strong>（50 ÷ 四星率）。';
  }

  function drawCdf(res, pc) {
    var canvas = document.getElementById('cdfChart');
    if (!canvas || !window.Chart) return;
    var ctx = canvas.getContext('2d');
    if (cdfChart) cdfChart.destroy();

    var marks = [
      { x: pc.p25, value: pc.p25, color: '#7cf3c0', label: '25%' },
      { x: pc.p50, value: pc.p50, color: '#7ec8ff', label: '50%' },
      { x: pc.p85, value: pc.p85, color: '#ffcf5c', label: '85%' },
      { x: pc.p99, value: pc.p99, color: '#ff7d95', label: '99%' }
    ];

    var points = res.cdf.x.map(function (x, i) { return { x: x, y: res.cdf.y[i] }; });
    var datasets = [{
      label: '累積達成率 (%)',
      data: points,
      borderColor: function (c) {
        var g = ctx.createLinearGradient(0, 0, 0, c.chart.height);
        g.addColorStop(0, 'rgba(255,214,110,1)');
        g.addColorStop(0.55, 'rgba(120,215,255,1)');
        g.addColorStop(1, 'rgba(120,140,255,0.9)');
        return g;
      },
      borderWidth: 2.6,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: '#fff',
      pointHoverBorderColor: '#ffd24a',
      tension: 0.25,
      fill: true,
      backgroundColor: function (c) {
        var area = c.chart.chartArea;
        if (!area) return 'rgba(120,190,255,.12)';
        var g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, 'rgba(255,205,110,.30)');
        g.addColorStop(0.45, 'rgba(110,200,255,.18)');
        g.addColorStop(1, 'rgba(90,120,255,.02)');
        return g;
      }
    }];

    savedCurves.forEach(function (sc) {
      datasets.push({
        label: sc.label,
        data: sc.x.map(function (x, i) { return { x: x, y: sc.y[i] }; }),
        borderColor: sc.color,
        borderWidth: 1.6,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.25,
        fill: false
      });
    });

    var isOrbs = axisMode === 'orbs';
    cdfChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reduceMotion ? 0 : 800, easing: 'easeOutQuart' },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          percentiles: { marks: marks },
          tooltip: {
            callbacks: {
              title: function (items) { return nf(items[0].parsed.x) + ' 抽（' + nf(items[0].parsed.x * 5) + ' 寶珠）'; },
              label: function (item) {
                return ' ' + item.dataset.label + '：' + item.parsed.y.toFixed(2) + '%';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: isOrbs ? '累積寶珠數（1 抽 = 5 寶珠）' : '累積抽數', color: '#7784bd' },
            grid: { display: false },
            ticks: {
              color: '#7784bd',
              maxTicksLimit: 9,
              callback: function (v) { return nf(isOrbs ? v * 5 : v); }
            }
          },
          y: {
            min: 0, max: 100,
            title: { display: true, text: '累積達成率 (%)', color: '#7784bd' },
            grid: { color: 'rgba(146,172,255,.10)' },
            ticks: { color: '#7784bd', callback: function (v) { return v + '%'; } }
          }
        }
      }
    });

    var legend = $('#cdfLegend');
    if (legend) {
      legend.innerHTML = marks.map(function (m) {
        return '<span class="legend-item"><span class="legend-swatch" style="background:' + m.color +
          '"></span>' + m.label + ' 達成率 → ' + nf(m.value) + ' 抽（' + nf(m.value * 5) + ' 寶珠）</span>';
      }).join('');
    }
    renderCompareList();
  }

  /* 分位數 95% 信賴區間（以「誤差半寬」呈現，否則在數百抽的尺度上會看不見） */
  function drawCiChart(res) {
    var canvas = document.getElementById('ciChart');
    if (!canvas || !window.Chart || !res.ci) return;
    if (ciChart) ciChart.destroy();

    var rows = [['p10', 10], ['p25', 25], ['p50', 50], ['p75', 75], ['p85', 85], ['p90', 90], ['p95', 95], ['p99', 99]];
    var labels = rows.map(function (r) { return r[1] + '%（' + nf(res.percentiles[r[0]]) + ' 抽）'; });
    var halves = rows.map(function (r) {
      var c = res.ci[r[0]];
      return Math.max(0, Math.round((c.hi - c.lo) / 2));
    });

    ciChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '95% 信賴半寬（抽）',
          data: halves,
          backgroundColor: 'rgba(110,160,255,.45)',
          borderColor: 'rgba(150,190,255,.8)',
          borderWidth: 1,
          borderRadius: 5,
          barPercentage: 0.62
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reduceMotion ? 0 : 700, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) {
                var r = rows[item.dataIndex];
                return [' 點估計：' + nf(res.percentiles[r[0]]) + ' 抽',
                  ' 95% 區間：' + nf(res.ci[r[0]].lo) + '～' + nf(res.ci[r[0]].hi) + ' 抽',
                  ' 寶珠區間：' + nf(res.ci[r[0]].lo * 5) + '～' + nf(res.ci[r[0]].hi * 5)];
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: '抽數誤差 ±（95% 信賴半寬）', color: '#7784bd' },
            grid: { color: 'rgba(146,172,255,.10)' },
            ticks: { color: '#7784bd', precision: 0 }
          },
          y: { grid: { display: false }, ticks: { color: '#7784bd' } }
        }
      }
    });
  }

  /* 曲線疊圖：把目前曲線存起來，最多 3 條 */
  function saveCurrentCurve() {
    if (!lastMode1) return;
    if (savedCurves.length >= 3) savedCurves.shift();
    var p = lastMode1.p;
    var color = CURVE_COLORS[savedCurves.length % CURVE_COLORS.length];
    savedCurves.push({
      label: p.rate + '% × ' + p.copies + ' 隻',
      color: color,
      x: lastMode1.res.cdf.x,
      y: lastMode1.res.cdf.y
    });
    if (lastMode1) drawCdf(lastMode1.res, lastMode1.res.percentiles);
  }

  function renderCompareList() {
    var box = document.getElementById('compareList');
    if (!box) return;
    box.hidden = savedCurves.length === 0;
    box.innerHTML = savedCurves.map(function (sc, i) {
      return '<span class="compare-item"><i style="background:' + sc.color + '"></i>' + sc.label +
        '<button type="button" data-index="' + i + '" aria-label="移除此曲線">×</button></span>';
    }).join('');
  }

  /* ======================================================================
     7. 模式二
     ====================================================================== */
  function runMode2() {
    var p = readParams();
    if (activeRun2) return;

    var seed = p.seed ? (parseInt(p.seed, 10) >>> 0) : (Math.random() * 4294967295) >>> 0;
    $('#seed').value = String(seed);
    saveParams();

    var btn = $('#btnMode2'), cancel = $('#btnCancel2');
    btn.disabled = true; cancel.hidden = false;
    $('#progress2').hidden = false;
    setProgress('2', 0, '運算中…');

    activeRun2 = runSimulation('mode2', {
      iterations: p.iterations, rate: p.rate, baseRate: p.baseRate,
      pulls: p.pulls, startShards: p.shards, seed: seed
    }, {
      onProgress: function (done, total) {
        setProgress('2', total ? (done / total) * 100 : 0, '模擬中… ' + nf(done) + ' / ' + nf(total));
      },
      onDone: function (res) {
        activeRun2 = null;
        btn.disabled = false; cancel.hidden = true;
        $('#progress2').hidden = true;
        renderMode2(res, p);
        switchView('view2');
      }
    });
  }

  function renderMode2(res, p) {
    var results = $('#mode2Results');
    results.hidden = false;
    results.style.animation = 'none';
    void results.offsetWidth;
    results.style.animation = '';

    $('#dispSimCount2').textContent = nf(res.iterations);
    $('#resPulls2').textContent = nf(p.pulls);
    countUp(document.getElementById('resAvg'), res.expectation, 900, 2);
    countUp(document.getElementById('resJade'), res.avgJade, 900, 2);
    $('#resJade100').textContent = res.jadePer100.toFixed(1);
    $('#resAvgCI').textContent = '95% 區間 ' + res.ci95.lo.toFixed(3) + ' ～ ' + res.ci95.hi.toFixed(3) + ' 隻（±' +
      ((res.ci95.hi - res.ci95.lo) / 2).toFixed(3) + '）';

    var dist = res.dist.filter(function (d) { return d.k <= 12; });
    var maxK = Math.max.apply(null, dist.map(function (d) { return d.k; }));
    var showMax = Math.min(maxK, 10);
    var rows = [];
    var cumulative = 100;

    for (var k = 0; k <= showMax; k++) {
      var count = 0;
      res.dist.forEach(function (d) {
        if (k === showMax && showMax === 10) { if (d.k >= 10) count += d.count; }
        else if (d.k === k) count += d.count;
      });
      var prob = (count / res.iterations) * 100;
      rows.push({ label: (k === showMax && showMax === 10) ? '10 隻以上' : k + ' 隻', prob: prob, cum: cumulative });
      cumulative -= prob;
    }

    document.querySelector('#distTable tbody').innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<td><strong>' + r.label + '</strong></td>' +
        '<td class="num pct">' + r.prob.toFixed(3) + '%</td>' +
        '<td><div class="bar-chart" style="width:' + clamp(r.prob, 0.4, 100).toFixed(2) + '%"></div></td>' +
        '<td class="num cum">' + (r.cum < 0 ? 0 : r.cum).toFixed(3) + '%</td>' +
        '</tr>';
    }).join('');

    drawPdf(res);
    drawExpectCurve(res);
  }

  function drawPdf(res) {
    var canvas = document.getElementById('pdfChart');
    if (!canvas || !window.Chart) return;
    if (pdfChart) pdfChart.destroy();

    var dist = res.dist.filter(function (d) { return d.k <= 12; });
    var labels = dist.map(function (d) { return d.k + ' 隻'; });
    var values = dist.map(function (d) { return (d.count / res.iterations) * 100; });

    pdfChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '出現機率 (%)',
          data: values,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 54,
          backgroundColor: function (c) {
            var area = c.chart.chartArea;
            if (!area) return 'rgba(120,180,255,.6)';
            var g = c.chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
            var k = c.dataIndex;
            if (k === 0) { g.addColorStop(0, 'rgba(255,90,118,.3)'); g.addColorStop(1, 'rgba(255,120,140,.95)'); }
            else if (k === 1) { g.addColorStop(0, 'rgba(120,150,255,.28)'); g.addColorStop(1, 'rgba(150,175,255,.9)'); }
            else { g.addColorStop(0, 'rgba(255,170,40,.28)'); g.addColorStop(1, 'rgba(255,215,120,.95)'); }
            return g;
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reduceMotion ? 0 : 800, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (item) { return ' 出現機率 ' + item.parsed.y.toFixed(3) + '%'; } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#7784bd' } },
          y: {
            min: 0,
            title: { display: true, text: '出現機率 (%)', color: '#7784bd' },
            grid: { color: 'rgba(146,172,255,.10)' },
            ticks: { color: '#7784bd', callback: function (v) { return v + '%'; } }
          }
        }
      }
    });
  }

  /* 抽數 → 期望值 曲線（含 95% 信賴帶） */
  function drawExpectCurve(res) {
    var canvas = document.getElementById('ciChart2');
    if (!canvas || !window.Chart || !res.curve) return;
    if (curveChart) curveChart.destroy();

    var c = res.curve;
    var lower = c.x.map(function (x, i) { return { x: x, y: c.lo[i] }; });
    var upper = c.x.map(function (x, i) { return { x: x, y: c.hi[i] }; });
    var mid = c.x.map(function (x, i) { return { x: x, y: c.mean[i] }; });

    curveChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: '期望值',
            data: mid,
            borderColor: '#ffd24a',
            borderWidth: 2.4,
            pointRadius: 0,
            tension: 0.2,
            fill: false
          },
          {
            label: '95% 上界',
            data: upper,
            borderColor: 'rgba(255,210,74,.28)',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.2,
            fill: '+1',
            backgroundColor: 'rgba(255,210,74,.10)'
          },
          {
            label: '95% 下界',
            data: lower,
            borderColor: 'rgba(255,210,74,.28)',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.2,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reduceMotion ? 0 : 800, easing: 'easeOutQuart' },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return nf(items[0].parsed.x) + ' 抽'; },
              label: function (item) {
                if (item.dataset.label === '期望值') return ' 期望值 ' + item.parsed.y.toFixed(3) + ' 隻';
                return ' ' + item.dataset.label + ' ' + item.parsed.y.toFixed(3) + ' 隻';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: '累積抽數', color: '#7784bd' },
            grid: { display: false },
            ticks: { color: '#7784bd', maxTicksLimit: 8 }
          },
          y: {
            min: 0,
            title: { display: true, text: '期望隻數', color: '#7784bd' },
            grid: { color: 'rgba(146,172,255,.10)' },
            ticks: { color: '#7784bd' }
          }
        }
      }
    });
  }

  /* ======================================================================
     8. 進場動畫
     ====================================================================== */
  (function revealOnScroll() {
    var targets = $$('.section > .section-head, .section > .panel, .model-grid-2, .legal-grid > article, .faq-list > .faq-item, .grid-2 > .panel, .stat-card');
    if (!('IntersectionObserver' in window)) return;
    targets.forEach(function (t, i) {
      t.classList.add('reveal');
      t.style.animationDelay = (i % 6) * 60 + 'ms';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    targets.forEach(function (t) { io.observe(t); });
    setTimeout(function () { targets.forEach(function (t) { t.classList.add('in'); }); }, 2400);
  })();

  /* ======================================================================
     9. 載入時自動跑一次，讓儀表板一開就有資料
     ====================================================================== */
  function autoRun() {
    var p = readParams();
    if (!window.MSSim || !MSSim.estimateWork) return;
    var w = MSSim.estimateWork('mode1', {
      iterations: p.iterations, rate: p.rate, baseRate: p.baseRate, targetCopies: p.copies
    });
    // 估算太慢就先用較小的樣本數，避免一進頁面就卡住
    if (w.seconds > 10 && p.iterations > 100000) {
      $('#simCount').value = '100000';
      saveParams();
    }
    runMode1();
  }

  /* ======================================================================
     10. 事件綁定
     ====================================================================== */
  function bind() {
    $('#btnMode1').addEventListener('click', runMode1);
    $('#btnMode2').addEventListener('click', runMode2);
    $('#btnCancel1').addEventListener('click', function () {
      cancelRun(activeRun1); activeRun1 = null;
      $('#btnMode1').disabled = false; $('#btnCancel1').hidden = true; $('#progress1').hidden = true;
    });
    $('#btnCancel2').addEventListener('click', function () {
      cancelRun(activeRun2); activeRun2 = null;
      $('#btnMode2').disabled = false; $('#btnCancel2').hidden = true; $('#progress2').hidden = true;
    });

    $('#btnSeedRoll').addEventListener('click', function () {
      $('#seed').value = String((Math.random() * 4294967295) >>> 0);
      saveParams();
    });

    $$('.dash-tab').forEach(function (t) {
      t.addEventListener('click', function () { switchView(t.dataset.view); });
    });

    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        axisMode = b.dataset.axis;
        if (lastMode1) drawCdf(lastMode1.res, lastMode1.res.percentiles);
      });
    });

    var saveBtn = $('#btnSaveCurve');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentCurve);

    var compareList = $('#compareList');
    if (compareList) {
      compareList.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        savedCurves.splice(parseInt(btn.dataset.index, 10), 1);
        if (lastMode1) drawCdf(lastMode1.res, lastMode1.res.percentiles);
      });
    }

    ['targetRate', 'baseRate', 'currentShards', 'simCount', 'targetCopies', 'simPulls', 'seed'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        syncShardGrid();
        syncRateChips();
        if (id === 'simPulls') {
          var pulls = parseInt($('#simPulls').value, 10) || 0;
          $('#pullsOrbs').textContent = nf(pulls * 5);
        }
        updateSummary();
        saveParams();
      });
    });

    $('#simPulls').dispatchEvent(new Event('change'));
  }

  /* ======================================================================
     11. 啟動
     ====================================================================== */
  loadParams();
  syncShardGrid();
  syncRateChips();
  updateSummary();
  bind();
  switchView('view1');
  autoRun();
})();
