// AI 工具导航：搜索过滤 + 吸顶分类条平滑滚动 + 当前分类高亮
(function () {
  var search = document.getElementById('toolsSearch');
  var list = document.getElementById('toolsList');
  var nav = document.querySelector('.tools-nav');
  if (!search || !list || !nav) return;

  var cats = Array.prototype.slice.call(list.querySelectorAll('.tools-cat'));
  var chips = Array.prototype.slice.call(nav.querySelectorAll('.tools-chip'));

  // 品牌 logo 加载失败 → 隐藏 img，露出底下字母（CSP script-src-attr 'none' 禁内联 onerror，用 JS 监听兜底）
  Array.prototype.forEach.call(document.querySelectorAll('.tools-avatar__img'), function (img) {
    img.addEventListener('error', function () { this.style.display = 'none'; });
  });

  // 无结果提示
  var NA = document.createElement('div');
  NA.className = 'tools-empty';
  NA.style.display = 'none';
  NA.textContent = '没找到匹配的工具，换个关键词试试？';
  list.appendChild(NA);

  function applyFilter(q) {
    q = String(q || '').trim().toLowerCase();
    var shown = 0;
    cats.forEach(function (sec) {
      var secCards = Array.prototype.slice.call(sec.querySelectorAll('.tools-card-wrap'));
      var secShown = 0;
      secCards.forEach(function (wrap) {
        var match = !q || (wrap.textContent || '').toLowerCase().indexOf(q) !== -1;
        wrap.style.display = match ? '' : 'none';
        if (match) secShown++;
      });
      sec.style.display = secShown ? '' : 'none';
      shown += secShown;
    });
    NA.style.display = shown ? 'none' : 'block';
  }

  search.addEventListener('input', function () { applyFilter(search.value); });

  // 分类 chip → 平滑滚动到对应 section（偏移吸顶条高度）
  chips.forEach(function (chip) {
    chip.addEventListener('click', function (e) {
      var sec = document.getElementById(String(chip.getAttribute('href') || '').slice(1));
      if (!sec) return;
      e.preventDefault();
      var top = sec.getBoundingClientRect().top + window.pageYOffset - nav.offsetHeight - 14;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      history.replaceState(null, '', chip.getAttribute('href'));
    });
  });

  // scrollspy：滚动时高亮当前分类
  function onScroll() {
    var off = nav.offsetHeight + 20;
    var cur = null;
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].getBoundingClientRect().top <= off) cur = cats[i].getAttribute('data-tools-cat');
    }
    chips.forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-tools-cat') === cur);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
