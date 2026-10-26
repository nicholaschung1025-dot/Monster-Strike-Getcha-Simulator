/* ==========================================================================
   sim-worker.js — 蒙地卡羅模擬執行緒
   把 100 萬次模擬丟到背景執行緒，畫面保持 60fps；同時回報進度、可取消。
   載入失敗時（例：file:// 直接開檔）主程式會自動退回主執行緒分批模擬。
   ========================================================================== */
'use strict';

importScripts('sim-core.js');

let cancelled = false;
let lastPost = 0;

self.onmessage = function (e) {
  var msg = e.data || {};

  if (msg.cmd === 'cancel') { cancelled = true; return; }

  var mode = msg.mode;
  var params = msg.params || {};
  var runner = mode === 'mode2' ? MSSim.createMode2Runner(params) : MSSim.createMode1Runner(params);
  var started = Date.now();
  var lastPost = 0;

  function pump() {
    if (cancelled) {
      self.postMessage({ type: 'cancelled' });
      return;
    }
    var CHUNK = 25000;
    var now = Date.now();
    runner.step(CHUNK);

    if (now - lastPost > 60 || runner.complete) {
      lastPost = now;
      self.postMessage({
        type: 'progress',
        done: runner.done,
        total: runner.total
      });
    }

    if (runner.complete) {
      var result = runner.finish();
      result.elapsed = Date.now() - started;
      result.iterations = runner.total;
      self.postMessage({ type: 'done', result: result });
    } else {
      setTimeout(pump, 0);
    }
  }

  pump();
};
