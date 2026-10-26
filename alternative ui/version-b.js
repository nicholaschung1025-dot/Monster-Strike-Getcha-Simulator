/* ==========================================================================
   version-b.js · loud-flat-poster 版的行為層
   依賴：logic.js（先載入，本檔只做鏡像同步與章節換色，不動其狀態）
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.documentElement.classList.add('jsok');

  /* ======================================================================
     1. 展示區計量器：真參數的鏡像
     ====================================================================== */
  var mirrorGrid = document.getElementById('mirrorGrid');
  var mirrorCount = document.getElementById('mirrorCount');
  var meterWord = document.getElementById('meterWord');
  var meterHeadWord = document.getElementById('meterHeadWord');
  var showcase = document.querySelector('.showcase');
  var shardsInput = document.getElementById('currentShards');

  function renderMirror() {
    if (!mirrorGrid) return;
    var n = clamp(parseInt(shardsInput.value, 10) || 0, 0, 50);
    $$('.frag-cell', mirrorGrid).forEach(function (c, i) {
      c.classList.toggle('on', i < n);
    });
    if (mirrorCount) mirrorCount.textContent = String(n);
    var live = n >= 50;
    if (showcase) showcase.classList.toggle('jade-live', live);
    if (meterWord) meterWord.textContent = live ? '非洲玉，發動。' : '累積中';
    if (meterHeadWord) meterHeadWord.textContent = live ? '非洲玉' : '碎片';
  }

  (function buildMirror() {
    if (!mirrorGrid) return;
    for (var i = 0; i < 50; i++) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'frag-cell';
      c.setAttribute('aria-label', '星星碎片 ' + (i + 1));
      c.dataset.index = String(i);
      c.style.setProperty('--i', String(i));
      mirrorGrid.appendChild(c);
    }
    mirrorGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.frag-cell');
      if (!cell || !shardsInput) return;
      var idx = parseInt(cell.dataset.index, 10);
      var current = parseInt(shardsInput.value, 10) || 0;
      shardsInput.value = (current === idx + 1) ? idx : idx + 1;
      shardsInput.dispatchEvent(new Event('change'));
      renderMirror();
    });
  })();

  if (shardsInput) {
    shardsInput.addEventListener('change', renderMirror);
    shardsInput.addEventListener('input', renderMirror);
    renderMirror();
  }

  /* ======================================================================
     2. 章節換色：固定角標跟著章節墨色走
     ====================================================================== */
  (function chapterColour() {
    var chapters = $$('[data-chapter]');
    if (!chapters.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          document.documentElement.dataset.chapter = en.target.dataset.chapter || 'bg';
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    chapters.forEach(function (s) { io.observe(s); });
    document.documentElement.dataset.chapter = 'red';
  })();

  /* ======================================================================
     3. CTA：把填好的參數帶回模擬器並開跑
     ====================================================================== */
  (function ctaPlanner() {
    var seg = $$('.cta-seg-btn');
    var go = document.getElementById('btnCtaGo');
    var rateInput = document.getElementById('ctaRate');
    var copies = 1;

    seg.forEach(function (b) {
      b.addEventListener('click', function () {
        seg.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        copies = parseInt(b.dataset.copies, 10) || 1;
      });
    });

    if (!go) return;
    go.addEventListener('click', function () {
      var rate = clamp(parseFloat(rateInput.value) || 1.2, 0.05, 12);
      var targetRate = document.getElementById('targetRate');
      var targetCopies = document.getElementById('targetCopies');
      if (targetRate) {
        targetRate.value = String(rate);
        targetRate.dispatchEvent(new Event('change'));
      }
      if (targetCopies) {
        targetCopies.value = String(clamp(copies, 1, 20));
        targetCopies.dispatchEvent(new Event('change'));
      }
      var dash = document.getElementById('dash');
      if (dash) dash.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      window.setTimeout(function () {
        var run = document.getElementById('btnMode1');
        if (run && !run.disabled) run.click();
      }, reduceMotion ? 100 : 750);
    });
  })();

  /* ======================================================================
     4. 進場：各章節部件分批升起（reduced-motion 由 CSS 關掉）
     ====================================================================== */
  (function entrance() {
    if (!('IntersectionObserver' in window)) return;
    var targets = $$('.tile, .band-copy, .band-art, .cta-close, .cta-panel, .showcase-head, .footer-blocks, .faq-side .section-head, .legal .section-head');
    targets.forEach(function (t, i) {
      t.classList.add('reveal');
      t.style.animationDelay = (i % 6) * 70 + 'ms';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    targets.forEach(function (t) { io.observe(t); });
    window.setTimeout(function () {
      targets.forEach(function (t) { t.classList.add('in'); });
    }, 2400);
  })();
})();
