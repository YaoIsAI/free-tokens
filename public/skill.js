(function() {
  'use strict';

  const T = window.TokenApp || { esc: s => s, showToast: () => {}, openAuth: () => {}, api: null };

  function icon(name, extraClass) {
    return '<svg class="ic' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true" focusable="false"><use href="#lucide-' + name + '"/></svg>';
  }

  const CATEGORIES = ['通用', '提示词', '工具集', '开发', '测试', '其他'];

  function renderCategories() {
    const chips = document.getElementById('skillCats');
    if (!chips) return;
    const html = CATEGORIES.map(c => '<span class="skill-chip" data-cat="' + c + '">' + c + '</span>').join('');
    chips.innerHTML = '<span class="skill-chip skill-chip--active" data-cat="all">全部</span>' + html;
    chips.addEventListener('click', e => {
      const cat = e.target.dataset && e.target.dataset.cat;
      if (!cat) return;
      [...chips.querySelectorAll('.skill-chip')].forEach(el => el.classList.toggle('skill-chip--active', el === e.target));
      loadSkills(cat === 'all' ? '' : cat);
    });
  }

  let loadedSkills = [];
  async function loadSkills(category, search = '', page = 1) {
    const grid = document.getElementById('skillGrid');
    const moreWrap = document.getElementById('skillMoreWrap');
    if (!grid) return;
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    params.set('limit', '20');
    params.set('offset', String((page - 1) * 20));

    try {
      const res = await fetch('/api/skills?' + params);
      const data = await res.json();
      const items = data.items || [];
      loadedSkills = page > 1 ? loadedSkills.concat(items) : items;
      renderSkills(loadedSkills);
      if (moreWrap) moreWrap.style.display = items.length >= 20 ? 'block' : 'none';
    } catch (e) {
      T.showToast('加载失败', 'error');
    }
  }

  function renderSkills(skills) {
    const grid = document.getElementById('skillGrid');
    if (!skills.length) {
      grid.innerHTML = '<div class="empty">暂无 Skill</div>';
      return;
    }
    grid.innerHTML = skills.map(s => {
      const priceLabel = s.price > 0 ? '<span class="skill-price">' + s.price + ' 积分</span>' : '<span class="skill-price-free">免费</span>';
      const purchased = s.purchased ? '<span class="skill-badge">已购买</span>' : '';
      var rawSummary = (s.summary || s.description || '').slice(0, 80);
      return '<a class="skill-card" href="/skills/' + encodeURIComponent(s.slug) + '">' +
        (s.cover ? '<img class="skill-card__cover" src="' + T.esc(s.cover) + '" alt="' + T.esc(s.title) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '<div class="skill-card__cover skill-card__cover--placeholder">' + icon('package') + '</div>') +
        '<div class="skill-card__body">' +
        '<h3 class="skill-card__title">' + T.esc(s.title) + '</h3>' +
        '<p class="skill-card__summary">' + T.esc(rawSummary) + '</p>' +
        '<div class="skill-card__meta">' +
        '<span class="skill-author">' + T.esc(s.authorName || '匿名') + '</span>' +
        priceLabel + purchased +
        '</div></div></a>';
    }).join('');
  }

  document.getElementById('skillPublishBtn')?.addEventListener('click', openPublish);
  document.getElementById('skillMore')?.addEventListener('click', () => {
    loadSkills(document.querySelector('.skill-chip.skill-chip--active')?.dataset.cat || '', '', (loadedSkills.length / 20) + 1);
  });

  document.addEventListener('click', e => {
    if (e.target.id === 'skillBuyBtn') {
      const btn = e.target;
      const skillId = btn.dataset.skillId;
      const price = parseInt(btn.dataset.price, 10);
      handleBuy(skillId, price);
    }
  });

  async function handleBuy(skillId, price) {
    if (price > 0) {
      var ok = confirm('确认用 ' + price + ' 积分购买此 Skill？购买后永久授权，0% 抽成作者全额获得。');
      if (!ok) return;
    }
    try {
      const res = await T.api('POST', '/api/skills/' + skillId + '/buy');
      if (res.status === 401) {
        T.showToast('请先登录后再购买', 'error');
        if (T.openAuth) T.openAuth('login');
        return;
      }
      const data = await res.json();
      if (data.error) {
        T.showToast(data.error, 'error');
        return;
      }
      if (data.already) {
        T.showToast('已购买，无需重复购买', 'info');
        setTimeout(() => location.reload(), 600);
        return;
      }
      T.showToast(data.free ? '已获得免费 Skill！' : '购买成功！', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      T.showToast('购买失败', 'error');
    }
  }

  // 发布弹窗
  function openPublish() {
    if (!T.getToken || !T.getToken()) {
      T.showToast('请先登录后再发布', 'error');
      if (T.openAuth) T.openAuth('login');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal skill-publish-modal';
    modal.innerHTML =
      '<div class="modal__backdrop" data-action="close-skill-publish"></div>' +
      '<div class="modal__panel" style="max-width:680px">' +
      '<button class="modal__x" data-action="close-skill-publish" aria-label="关闭">' + icon('x') + '</button>' +
      '<h2 class="modal__title">' + icon('package') + ' 发布 Skill</h2>' +
      '<p class="modal__meta">支持上传 GitHub 风格的 zip 包，或手动填写内容。发布后进入审核，审核通过后公开。</p>' +
      '<div class="pub-section"><div class="pub-section__title">' + icon('upload') + ' 上传压缩包 <span class="muted" style="font-weight:400;font-size:12px">（推荐）</span></div>' +
      '<div class="uploader" id="skillZipUpload">' +
      '<div class="uploader__zone" tabindex="0" role="button">' +
      '<input type="file" accept=".zip" hidden id="skillZipInput">' +
      '<span class="uploader__icon">' + icon('package') + '</span>' +
      '<span class="uploader__hint">点击选择 zip 包 / 拖拽上传</span>' +
      '</div>' +
      '<div class="uploader__preview" id="skillZipPreview"></div>' +
      '</div>' +
      '<div class="form-note" id="skillZipNote">压缩包要求：根目录必须包含 SKILL.md（frontmatter 可写 name/description），支持 README.md 作为说明，文件数 ≤200，单文件 ≤2MB，总解压 ≤20MB。</div>' +
      '</div>' +
      '<div class="pub-section"><div class="pub-section__title">' + icon('file-text') + ' 元信息</div>' +
      '<div class="form-group"><label>标题 *</label><input class="input" id="skillTitle" maxlength="120" placeholder="如：Claude Code Skill 编写指南"></div>' +
      '<div class="form-row"><div class="form-group"><label>简介</label><input class="input" id="skillSummary" maxlength="300" placeholder="一句话概述"></div>' +
      '<div class="form-group"><label>分类</label><select class="input" id="skillCategory">' + CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('') + '</select></div></div>' +
      '<div class="form-group"><label>标签</label><input class="input" id="skillTags" placeholder="逗号分隔，如: 免费,工具（最多10个，逗号支持中英文）"></div>' +
      '<div class="form-group"><label>封面 <span class="muted">(选填)</span></label><div class="uploader-mount" id="skillCoverMount"></div><input type="hidden" id="skillCoverVal" value=""><input class="input" id="skillCoverInput" placeholder="或粘贴 /uploads/xxx.png 或 https://... 外链 (选填)" style="margin-top:8px"></div>' +
      '<div class="form-group"><label>价格（积分） <span class="muted">(0=免费，≤10000)</span></label><input class="input" type="number" id="skillPrice" min="0" max="10000" step="1" value="0" placeholder="0 表示免费"><div class="form-note">0% 平台抽成，作者全额获得；购买后永久授权，版主审核通过后作者 +1 积分。</div></div>' +
      '</div>' +
      '<div class="pub-section pub-section--optional"><div class="pub-section__title">' + icon('file-text') + ' SKILL.md 内容（不上传压缩包时必填）</div>' +
      '<div class="form-group"><textarea class="input" id="skillContent" rows="10" placeholder="---&#10;name: 你的 Skill 名称&#10;description: 一句话描述&#10;---&#10;&#10;在此编写 Skill 正文..."></textarea><div class="form-note" id="skillContentNote" style="display:none"></div></div>' +
      '</div>' +
      '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;font-weight:500;font-size:13px;color:var(--text-2)"><input type="checkbox" id="skillCovenantCheck" style="width:16px;height:16px"> 我已阅读并同意 <a href="/skills" target="_blank" style="color:var(--brand);text-decoration:underline">Skill广场公约</a></label></div>' +
      '<div class="form-actions"><button class="btn btn--primary btn--lg pub-submit" id="skillSubmit">' + icon('send') + ' 发布 Skill</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.classList.add('modal--open');
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function doClose(){ modal.remove(); document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', escHandler); }
    function escHandler(e){ if(e.key==='Escape') doClose(); }
    document.addEventListener('keydown', escHandler);
    modal.querySelectorAll('[data-action="close-skill-publish"]').forEach(function(el){ el.addEventListener('click', doClose); });
    var coverValEl = modal.querySelector('#skillCoverVal');
    var coverInputEl = modal.querySelector('#skillCoverInput');
    var coverMountEl = modal.querySelector('#skillCoverMount');
    if (coverMountEl && coverValEl && typeof window.Uploader !== 'undefined' && window.Uploader.create) {
      try {
        window.Uploader.create({ mount: coverMountEl, token: function(){ return T.getToken(); }, toast: function(m){ T.showToast(m,'error'); }, hidden: coverValEl });
        coverValEl.addEventListener('change', function(){ if(coverInputEl) coverInputEl.value = coverValEl.value; });
      } catch(_){}
    }
    if (coverInputEl && coverValEl) {
      coverInputEl.addEventListener('input', function(){ coverValEl.value = coverInputEl.value.trim(); });
    }
    const zipInput = modal.querySelector('#skillZipInput');
    const zipZone = modal.querySelector('.uploader__zone');
    const zipPreview = modal.querySelector('#skillZipPreview');
    const contentNote = modal.querySelector('#skillContentNote');
    let packageId = '';
    function syncPackageState(){
      if(packageId){
        if(contentNote){ contentNote.style.display='block'; contentNote.textContent='已上传压缩包，发布时将使用包内 SKILL.md，手动填写的内容将被忽略。如需改用手动填写，请移除压缩包。'; contentNote.style.color='var(--amber)'; contentNote.style.background='var(--amber-bg)'; }
      } else {
        if(contentNote) contentNote.style.display='none';
      }
    }
    function clearPackage(){
      packageId='';
      if(zipPreview){ zipPreview.innerHTML=''; }
      if(zipInput) zipInput.value='';
      syncPackageState();
      T.showToast('已移除压缩包','info');
    }
    async function handleZipFile(file){
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.zip')) { T.showToast('仅支持 .zip 格式', 'error'); if(zipPreview) zipPreview.innerHTML=''; return; }
      if (file.size > 10 * 1024 * 1024) { T.showToast('压缩包不能超过 10MB', 'error'); if(zipPreview) zipPreview.innerHTML=''; return; }
      zipPreview.innerHTML = '<div class="spinner"></div> 正在上传...';
      try {
        const res = await T.api('POST', '/api/skills/package', file, 'application/zip');
        const data = await res.json();
        if (!res.ok) { T.showToast(data.error || '上传失败', 'error'); zipPreview.innerHTML=''; packageId=''; syncPackageState(); return; }
        packageId = data.packageId;
        var filesHtml = (data.files||[]).map(function(f){ return '  ' + T.esc(f.path) + '  (' + (Math.round(f.size / 1024) || 0) + ' KB)'; }).join('\n');
        zipPreview.innerHTML = '<div class="uploader__preview">' +
            '<div style="margin-bottom:8px;color:var(--text-muted);font-size:13px;">' + data.fileCount + ' 个文件，' +
            (Math.round(data.totalSize / 1024) || 0) + ' KB</div>' +
            '<details style="margin-top:8px" open>' +
            '<summary style="cursor:pointer;color:var(--brand);font-size:13px">查看文件树</summary>' +
            '<pre style="background:var(--surface-2);padding:8px;border-radius:4px;font-family:var(--mono);font-size:12px;margin-top:6px;max-height:150px;overflow:auto">' +
            T.esc(filesHtml) + '</pre></details>' +
            '<button type="button" class="btn btn--sm btn--ghost" id="skillZipClear" style="margin-top:10px">' + icon('x') + ' 移除压缩包</button></div>';
        var clearBtn = modal.querySelector('#skillZipClear');
        if(clearBtn) clearBtn.addEventListener('click', clearPackage);
        if (data.skillMd && data.skillMd.name) {
          modal.querySelector('#skillTitle').value = data.skillMd.name;
        }
        if (data.skillMd && data.skillMd.description) {
          modal.querySelector('#skillSummary').value = data.skillMd.description;
        }
        T.showToast('上传成功', 'success');
        syncPackageState();
      } catch (err) {
        zipPreview.innerHTML = '';
        packageId='';
        syncPackageState();
        T.showToast('上传失败', 'error');
      }
    }
    if (zipInput) {
      zipInput.addEventListener('change', async function(e){ var file = e.target.files[0]; await handleZipFile(file); });
    }
    if (zipZone) {
      zipZone.addEventListener('click', function(){ if(zipInput) zipInput.click(); });
      zipZone.addEventListener('keydown', function(e){ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); if(zipInput) zipInput.click(); }});
      var dragDepth=0;
      zipZone.addEventListener('dragenter', function(e){ e.preventDefault(); dragDepth++; zipZone.classList.add('is-dragging'); });
      zipZone.addEventListener('dragover', function(e){ e.preventDefault(); });
      zipZone.addEventListener('dragleave', function(e){ e.preventDefault(); dragDepth=Math.max(0,dragDepth-1); if(dragDepth===0) zipZone.classList.remove('is-dragging'); });
      zipZone.addEventListener('drop', async function(e){
        e.preventDefault(); dragDepth=0; zipZone.classList.remove('is-dragging');
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        await handleZipFile(file);
      });
    }
    if (modal.querySelector('#skillPrice')) {
      modal.querySelector('#skillPrice').addEventListener('input', function(){
        var v = Number(this.value);
        if(this.value!=='' && (!Number.isInteger(v) || v<0 || v>10000)){
          this.setCustomValidity('价格需为 0-10000 的整数');
        } else { this.setCustomValidity(''); }
      });
    }
    const submitBtn = modal.querySelector('#skillSubmit');
    if (submitBtn) {
      submitBtn.addEventListener('click', async function(e){
        e.preventDefault();
        const title = modal.querySelector('#skillTitle').value.trim();
        const summary = modal.querySelector('#skillSummary').value.trim();
        // 文本域是 SKILL.md 正文，后端字段名为 content（description 是详情页说明，另有 2000 字上限，不可混用）
        const content = modal.querySelector('#skillContent').value.trim();
        const category = modal.querySelector('#skillCategory').value;
        var rawTags = modal.querySelector('#skillTags').value;
        var tags = rawTags.split(/[,，]/).map(function(t){return t.trim();}).filter(function(t){return t;});
        tags = Array.from(new Set(tags));
        var cover = (coverValEl && coverValEl.value.trim()) || (coverInputEl && coverInputEl.value.trim()) || '';
        var priceRaw = modal.querySelector('#skillPrice').value.trim();
        var price = priceRaw===''?0:Number(priceRaw);
        if (!title) { T.showToast('请填写标题', 'error'); return; }
        if (title.length>120){ T.showToast('标题不能超过120个字符','error'); return; }
        if (summary.length>300){ T.showToast('简介不能超过300个字符','error'); return; }
        if (tags.length>10){ T.showToast('标签最多10个','error'); return; }
        if (tags.some(function(t){ return t.length>30; })){ T.showToast('标签单个不能超过30个字符','error'); return; }
        if (!Number.isInteger(price) || price<0 || price>10000){ T.showToast('价格需为 0-10000 的整数','error'); return; }
        if (cover && cover.length>500){ T.showToast('封面链接过长','error'); return; }
        if (cover && !(/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(cover) || /^https?:\/\/\S{5,}$/i.test(cover))){ T.showToast('封面需为 /uploads/... 或 http(s):// 图片链接','error'); return; }
        if (!CATEGORIES.includes(category)){ T.showToast('分类不在允许范围','error'); return; }
        if (!content && !packageId) { T.showToast('请填写 Skill 内容或上传压缩包', 'error'); return; }
        if (content && content.length>100000){ T.showToast('Skill 内容最多100000字','error'); return; }
        if (packageId && content){ T.showToast('将使用压缩包内容，手动填写将被忽略','info'); }
        var covenantOk = modal.querySelector('#skillCovenantCheck') && modal.querySelector('#skillCovenantCheck').checked;
        if (!covenantOk) { T.showToast('请先勾选同意 Skill广场公约','error'); return; }
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> 正在提交...';
        try {
          // content = SKILL.md 正文（必填 unless zip 包）；description 详情页说明留空（与 CLI 不传 --description 一致）
          const body = { title: title, summary: summary, description: '', content: content, category: category, tags: tags, price: price, cover: cover };
          if (packageId) body.packageId = packageId;
          const res = await T.api('POST', '/api/skills', body);
          if (res.status === 401) {
            T.showToast('请先登录后再发布', 'error');
            if (T.openAuth) T.openAuth('login');
            submitBtn.disabled=false; submitBtn.innerHTML = icon('send') + ' 发布 Skill'; return;
          }
          const result = await res.json();
          if (!res.ok) { T.showToast(result.error || '发布失败', 'error'); submitBtn.disabled=false; submitBtn.innerHTML = icon('send') + ' 发布 Skill'; return; }
          T.showToast('发布成功，等待审核', 'success');
          doClose();
          loadSkills(document.querySelector('.skill-chip.skill-chip--active')?.dataset.cat || '');
        } catch (err) {
          T.showToast('发布失败', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = icon('send') + ' 发布 Skill';
        }
      });
    }
  }

  renderCategories();
  loadSkills();
})();