// 中转站掺水检测页（public/verify.js）——薄调用层
// 实际交互逻辑已抽到可复用组件 window.VerifyRelay（public/verify-relay.js，全局加载，
// 详情弹窗等任意页面可复用）。本文件只在 /verify 页把组件挂到 mount 容器。
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    if (!window.VerifyRelay) return;
    var mount = document.getElementById('verifyRelayMount');
    if (!mount) return;
    window.VerifyRelay.create(mount); // /verify 页无预填，用户手填 Base URL + Key
  });
})();
