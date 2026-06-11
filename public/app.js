console.log('[APP-v9] JS loaded OK');
const promptEl = document.getElementById('prompt');
const charNum = document.getElementById('char-num');
const clearBtn = document.getElementById('clear-btn');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const thumbsEl = document.getElementById('thumbs');
const generateBtn = document.getElementById('generate-btn');
const statusEl = document.getElementById('status');
const galleryGrid = document.getElementById('gallery-grid');

let referenceImages = [];
const HISTORY_KEY = 'gpt-image-history';
const MAX_HISTORY = 50;

// --- 字数统计 ---
promptEl.addEventListener('input', () => {
  charNum.textContent = promptEl.value.length;
});
clearBtn.addEventListener('click', (e) => {
  e.preventDefault();
  promptEl.value = '';
  charNum.textContent = '0';
});

// --- 按钮组选择逻辑 ---
function setupBtnGroup(containerId, defaultVal) {
  const group = document.getElementById(containerId);
  let selected = defaultVal;
  group.querySelectorAll('.opt-btn, .ratio-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.opt-btn, .ratio-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selected = btn.dataset.value;
    });
    if (btn.dataset.value === defaultVal) btn.classList.add('active');
  });
  return () => selected;
}

const getQuality = setupBtnGroup('quality-group', 'medium');
const getResolution = setupBtnGroup('resolution-group', '2048x2048');
const getRatio = setupBtnGroup('ratio-grid', 'auto');

// --- 图片上传 ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

function addFiles(fileList) {
  for (const file of fileList) {
    if (referenceImages.length >= 8) break; // UI显示0-8张
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (e) => {
      referenceImages.push({ file, dataURL: e.target.result });
      renderThumbs();
    };
    reader.readAsDataURL(file);
  }
}

function renderThumbs() {
  // 更新卡片标题数字
  const labelCard = dropZone.closest('.card');
  const label = labelCard.querySelector('.field-label');
  label.innerHTML = `上传参考图(${referenceImages.length} - 8张)<span class="required">*</span>`;

  thumbsEl.innerHTML = '';
  referenceImages.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'thumb-item';
    div.innerHTML = `<img src="${img.dataURL}" alt="ref"><button class="remove-btn" data-idx="${i}">×</button>`;
    div.querySelector('.remove-btn').addEventListener('click', () => {
      referenceImages.splice(i, 1);
      renderThumbs();
    });
    thumbsEl.appendChild(div);
  });
}

// --- 生成 ---
generateBtn.addEventListener('click', generate);

async function generate() {
  const prompt = promptEl.value.trim();
  if (!prompt) { setStatus('请输入 Prompt', 'error'); return; }

  // 组装 params：比例优先，分辨率作为 fallback size
  let size = getRatio();       // auto / 1:1 / 3:2 等
  const quality = getQuality();

  generateBtn.disabled = true;
  setStatus('正在提交任务…');

  try {
    console.log('[generate] referenceImages count:', referenceImages.length);
    const params = { size, quality };
    if (referenceImages.length > 0) {
      console.log('[generate] uploading', referenceImages.length, 'reference images...');
      // Upload base64 images to get public URLs (API requires public URLs)
      const uploadedUrls = [];
      for (const img of referenceImages) {
        const uploadResp = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataURL: img.dataURL }),
        });
        const uploadData = await uploadResp.json();
        console.log('[generate] upload result:', JSON.stringify(uploadData).slice(0, 200));
        if (!uploadData.url) console.warn('Upload failed for ref image:', uploadData.error);
        else uploadedUrls.push(uploadData.url);
      }
      console.log('[generate] uploaded URLs:', uploadedUrls.length);
      if (uploadedUrls.length > 0) {
        params.images = uploadedUrls.map((url) => ({
          type: 'image_url',
          image_url: { url },
        }));
      }
    }

    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, params }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      setStatus('请求失败: ' + (data.error || data.body || JSON.stringify(data).slice(0, 200)), 'error');
      generateBtn.disabled = false;
      return;
    }
    // 同步返回结果（result_url 在顶层）
    if (data.result_url) {
      displayResults([{ url: data.result_url }], prompt);
      setStatus('生成完成！', 'success');
      generateBtn.disabled = false;
      return;
    }

    // 异步 task_id 轮询
    const taskId = data.task_id || data.data?.task_id;
    if (!taskId) {
      setStatus('未获取到 task_id，响应: ' + JSON.stringify(data).slice(0, 200), 'error');
      generateBtn.disabled = false;
      return;
    }
    setStatus('任务已提交，轮询中…');
    await poll(taskId, prompt);
  } catch (err) {
    setStatus('请求失败: ' + err.message, 'error');
  } finally {
    generateBtn.disabled = false;
  }
}

async function poll(taskId, prompt) {
  const MAX_POLL = 45;
  for (let i = 0; i < MAX_POLL; i++) {
    await sleep(4000);
    setStatus(`生成中… (${i + 1}/${MAX_POLL})`);
    try {
      const resp = await fetch(`/api/status?task_id=${encodeURIComponent(taskId)}`);
      const data = await resp.json();
      if (data.is_final === true) {
        if (data.state === 'success') {
          // result_url 在顶层
          const items = data.result_url ? [{ url: data.result_url }] : (data.data || []);
          displayResults(items, prompt);
          setStatus('生成完成！', 'success');
        } else if (data.state === 'failed') {
          setStatus('生成失败（已自动退款）', 'error');
        } else {
          setStatus('任务结束，状态: ' + data.state, 'error');
        }
        return;
      }
    } catch (err) {
      setStatus('轮询出错: ' + err.message, 'error');
      return;
    }
  }
  setStatus('超时，请稍后重试', 'error');
}

function displayResults(items, prompt) {
  const history = loadHistory();
  items.forEach((item) => {
    const url = item.url || item.result_url;
    if (!url) return;

    // 写入历史
    const record = { url, prompt, time: Date.now() };
    history.unshift(record);
    if (history.length > MAX_HISTORY) history.pop();
    saveHistory(history);

    // 渲染卡片
    const div = makeGalleryItem(url, prompt, new Date().toLocaleString('zh-CN'));
    galleryGrid.prepend(div);
  });
}

// --- 历史记录 ---
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}
function renderHistory() {
  const history = loadHistory();
  history.forEach((r) => {
    const timeStr = new Date(r.time).toLocaleString('zh-CN');
    const div = makeGalleryItem(r.url, r.prompt, timeStr);
    galleryGrid.appendChild(div);
  });
}

function makeGalleryItem(url, prompt, timeStr) {
  const div = document.createElement('div');
  div.className = 'gallery-item';
  div.dataset.url = url;
  div.innerHTML = `
    <div class="gi-img-wrap" style="position:relative;">
      <img src="${url}" alt="gallery" style="cursor:pointer;display:block;width:100%;border-radius:8px;">
      <button class="gi-delete-btn" title="删除" style="position:absolute;top:6px;right:6px;width:28px;height:28px;border:none;border-radius:50%;background:rgba(239,68,68,.9);color:#fff;font-size:16px;line-height:28px;text-align:center;cursor:pointer;opacity:0;transition:opacity .15s;z-index:10;display:flex;align-items:center;justify-content:center;">×</button>
    </div>
    <div class="prompt-tag">${escapeHtml(prompt)}<span style="float:right;color:#bbb;font-size:11px;margin-left:8px">${timeStr || ''}</span></div>
  `;
  const imgEl = div.querySelector('img');
  const delBtn = div.querySelector('.gi-delete-btn');
  const wrap = div.querySelector('.gi-img-wrap');

  imgEl.addEventListener('click', () => openLightbox(url));

  // 鼠标悬停显示删除按钮
  wrap.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
  wrap.addEventListener('mouseleave', () => { delBtn.style.opacity = '0'; });

  // 删除功能
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('确定删除这张图片？')) return;
    // 从 localStorage 删除
    let history = JSON.parse(localStorage.getItem('gpt-image-history') || '[]');
    history = history.filter(item => item.url !== url);
    localStorage.setItem('gpt-image-history', JSON.stringify(history));
    // 从 DOM 移除
    div.remove();
  });

  return div;
}

// =============================================
// 图片编辑器（内嵌灯箱）
// =============================================
let ie = {};

function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.id = 'lightbox-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:9999;animation:fadeIn .15s ease';

  // 图片容器
  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center';

  const img = document.createElement('img');
  img.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);object-fit:contain;cursor:zoom-out';
  img.src = url;
  imgWrap.appendChild(img);

  // 顶部工具栏
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;background:rgba(15,15,15,.75);backdrop-filter:blur(12px);border-radius:14px;padding:8px 14px;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.4)';

  const btnDraw = makeTbBtn('✏️ 涂鸦', () => setTbTool('draw', url, overlay, imgWrap));
  const btnClose = makeTbBtn('✕', () => { ie._cleanup && ie._cleanup(); overlay.remove(); });
  btnClose.style.cssText = 'background:rgba(255,255,255,.1);border:none;color:#fff;border-radius:8px;padding:6px 12px;font-size:16px;cursor:pointer;margin-left:8px;font-weight:700;min-width:36px;height:36px';

  toolbar.appendChild(btnDraw);
  toolbar.appendChild(btnClose);
  imgWrap.appendChild(toolbar);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === img) { ie._cleanup && ie._cleanup(); overlay.remove(); }
  });
  const onKey = (e) => { if (e.key === 'Escape') { ie._cleanup && ie._cleanup(); overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  overlay.appendChild(imgWrap);
  document.body.appendChild(overlay);
}

function makeTbBtn(text, onclick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = 'background:#7c3aed;color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s';
  btn.onmouseover = () => { btn.style.background = '#6d28d9'; };
  btn.onmouseout = () => { btn.style.background = '#7c3aed'; };
  btn.onclick = onclick;
  return btn;
}

function setTbTool(tool, url, overlay, imgWrap) {
  // 清理旧的编辑器
  ie._cleanup && ie._cleanup();

  // 隐藏原有图片
  const origImg = imgWrap.querySelector('img');
  origImg.style.display = 'none';

  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:10000;pointer-events:auto';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);pointer-events:auto;display:block;background:#ff000010';
  const ctx = canvas.getContext('2d');
  canvasWrap.appendChild(canvas);

  // 编辑器工具栏
  const editorBar = document.createElement('div');
  editorBar.style.cssText = 'position:absolute;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:rgba(15,15,15,.8);backdrop-filter:blur(12px);border-radius:14px;padding:10px 16px;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.4);flex-wrap:wrap;justify-content:center;max-width:92vw';

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#ef4444';
  colorInput.style.cssText = 'width:36px;height:36px;border:none;border-radius:8px;cursor:pointer;padding:2px';

  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = 1; sizeSlider.max = 100; sizeSlider.value = 60;
  sizeSlider.style.cssText = 'width:100px;accent-color:#7c3aed';
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = '60%';
  sizeLabel.style.cssText = 'color:#fff;font-size:12px;min-width:36px;text-align:center';

  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.min = 1; opacitySlider.max = 100; opacitySlider.value = 25;
  opacitySlider.style.cssText = 'width:80px;accent-color:#7c3aed';
  const opacityLabel = document.createElement('span');
  opacityLabel.textContent = '25%';
  opacityLabel.style.cssText = 'color:#fff;font-size:12px;min-width:36px;text-align:center';

  sizeSlider.oninput = () => { sizeLabel.textContent = sizeSlider.value + '%'; };
  opacitySlider.oninput = () => { opacityLabel.textContent = opacitySlider.value + '%'; };

  const btnUndo = makeTbBtn('↩ 撤销', () => undoEdit());

  const btnOk = document.createElement('button');
  btnOk.textContent = '✓ 确定';
  btnOk.style.cssText = 'background:#22c55e;color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = '✕ 取消';
  btnCancel.style.cssText = 'background:#ef4444;color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer';

  editorBar.appendChild(colorInput);
  editorBar.appendChild(sizeSlider);
  editorBar.appendChild(sizeLabel);
  editorBar.appendChild(opacitySlider);
  editorBar.appendChild(opacityLabel);
  editorBar.appendChild(btnUndo);
  editorBar.appendChild(btnOk);
  editorBar.appendChild(btnCancel);
  canvasWrap.appendChild(editorBar);
  imgWrap.appendChild(canvasWrap);

  // 编辑状态 v4 - mousedown只记录坐标不画线
  let editing = false;
  let lastX = -1, lastY = -1;
  console.log('[涂鸦v4] 已加载 - mousedown不再画点');
  let drawSnapshots = [];

  function saveSnapshot() {
    drawSnapshots.push(canvas.toDataURL());
    if (drawSnapshots.length > 50) drawSnapshots.shift();
  }

  function undoEdit() {
    if (drawSnapshots.length <= 1) return;
    drawSnapshots.pop();
    const prev = drawSnapshots[drawSnapshots.length - 1];
    const pImg = new Image();
    pImg.onload = () => { canvas.width = pImg.width; canvas.height = pImg.height; ctx.drawImage(pImg, 0, 0); };
    pImg.src = prev;
  }

  // 坐标换算：基于 canvas 的显示尺寸
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  }

  // 用原始图片预计算 canvas 尺寸（走代理避免跨域）
  const preloadImg = new Image();
  preloadImg.crossOrigin = 'anonymous';

  function setupEditorEvents() {
    canvas.style.cursor = 'crosshair';
    canvas.style.pointerEvents = 'auto';
    canvasWrap.style.pointerEvents = 'auto';
    const cssW = canvas.getBoundingClientRect().width;
    const cssH = canvas.getBoundingClientRect().height;
    console.log('[EDIT-v8] canvas ready:', canvas.width, 'x', canvas.height, 'CSS:', cssW, 'x', cssH);

    let drawing = false;

    function getDrawPos(e) {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height),
      };
    }

    function startDraw(e) {
      e.preventDefault();
      e.stopPropagation();
      const p = getDrawPos(e);
      if (!p) { console.warn('[EDIT-v8] startDraw getPos null'); return; }
      drawing = true;
      saveSnapshot();
      lastX = p.x; lastY = p.y;
      ctx.globalAlpha = parseInt(opacitySlider.value) / 100;
      ctx.fillStyle = colorInput.value;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, parseInt(sizeSlider.value) / 100 * canvas.width * 0.04), 0, Math.PI * 2);
      ctx.fill();
      console.log('[EDIT-v8] ✅ START at', Math.round(p.x), Math.round(p.y), 'target:', e.target.tagName, e.target.id);
    }

    function moveDraw(e) {
      if (!drawing) return;
      const p = getDrawPos(e);
      if (!p) return;
      if (lastX < 0 || lastY < 0) { lastX = p.x; lastY = p.y; return; }
      ctx.globalAlpha = parseInt(opacitySlider.value) / 100;
      ctx.strokeStyle = colorInput.value;
      ctx.lineWidth = Math.max(2, Math.round(parseInt(sizeSlider.value) / 100 * canvas.width * 0.08));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x; lastY = p.y;
    }

    function endDraw() {
      if (drawing) console.log('[EDIT-v8] END');
      drawing = false;
    }

    // === v8: addEventListener + capture 阶段 ===
    const opts = { capture: true, passive: false };
    canvas.addEventListener('pointerdown', startDraw, opts);
    canvas.addEventListener('pointermove', moveDraw, opts);
    canvas.addEventListener('pointerup', endDraw, opts);
    canvas.addEventListener('pointerleave', endDraw, opts);
    canvas.addEventListener('mousedown', startDraw, opts);
    canvas.addEventListener('mousemove', moveDraw, opts);
    canvas.addEventListener('mouseup', endDraw, opts);
    canvas.addEventListener('mouseleave', endDraw, opts);

    // canvasWrap fallback：如果点击穿透到了 wrap 层
    canvasWrap.addEventListener('pointerdown', (e) => {
      if (e.target === canvasWrap || e.target === canvasWrap.firstElementChild) {
        console.log('[EDIT-v8] 点击到canvasWrap，转发');
        startDraw(e);
      }
    }, opts);

    canvas.ontouchstart = (e) => { e.preventDefault(); startDraw(e.touches[0]); };
    canvas.ontouchmove = (e) => { e.preventDefault(); moveDraw(e.touches[0]); };
    canvas.ontouchend = endDraw;

    console.log('[EDIT-v8] addEventListener(capture) bound + canvasWrap fallback');
  }

  preloadImg.onerror = () => {
    console.error('[EDIT] 图片加载失败，尝试直连');
    const fallbackImg = new Image();
    fallbackImg.crossOrigin = 'anonymous';
    fallbackImg.onload = () => {
      const maxW = Math.min(window.innerWidth * 0.92, 1200);
      const maxH = Math.min(window.innerHeight * 0.92, 800);
      const scale = Math.min(1, maxW / fallbackImg.width, maxH / fallbackImg.height);
      canvas.width = Math.round(fallbackImg.width * scale);
      canvas.height = Math.round(fallbackImg.height * scale);
      ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
      drawSnapshots = [];
      setupEditorEvents();
    };
    fallbackImg.src = url;
  };

  preloadImg.onload = () => {
    // 按原图比例计算显示尺寸，保持宽高比一致
    const imgW = preloadImg.naturalWidth || preloadImg.width;
    const imgH = preloadImg.naturalHeight || preloadImg.height;
    const maxW = Math.min(window.innerWidth * 0.92, 1200);
    const maxH = Math.min(window.innerHeight * 0.92, 800);
    const scale = Math.min(1, maxW / imgW, maxH / imgH);
    canvas.width = Math.round(imgW * scale);
    canvas.height = Math.round(imgH * scale);
    // 关键：CSS 尺寸必须和内部分辨率一致！
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
    ctx.drawImage(preloadImg, 0, 0, canvas.width, canvas.height);
    try { drawSnapshots = [canvas.toDataURL()]; } catch (e) { console.warn('[EDIT] toDataURL 失败', e); drawSnapshots = []; }
    setupEditorEvents();
  };

  preloadImg.onerror = () => {
    console.error('[EDIT] 代理加载失败，重试代理（可能仍会因跨域失败）');
    const fallbackImg = new Image();
    fallbackImg.crossOrigin = 'anonymous';
    fallbackImg.onload = () => {
      const imgW = fallbackImg.naturalWidth || fallbackImg.width;
      const imgH = fallbackImg.naturalHeight || fallbackImg.height;
      const maxW = Math.min(window.innerWidth * 0.92, 1200);
      const maxH = Math.min(window.innerHeight * 0.92, 800);
      const scale = Math.min(1, maxW / imgW, maxH / imgH);
      canvas.width = Math.round(imgW * scale);
      canvas.height = Math.round(imgH * scale);
      canvas.style.width = canvas.width + 'px';
      canvas.style.height = canvas.height + 'px';
      ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
      try { drawSnapshots = [canvas.toDataURL()]; } catch (e) { console.warn('[EDIT] fallback toDataURL 失败', e); drawSnapshots = []; }
      setupEditorEvents();
    };
    fallbackImg.onerror = () => {
      console.error('[EDIT] 代理重试也失败，无法编辑此图片');
      alert('图片加载失败，无法编辑');
    };
    // fallback 也走代理，确保同源
    fallbackImg.src = isExternalUrl ? ('/api/proxy-image?url=' + encodeURIComponent(url)) : url;
  };

  // 判断是否需要代理：外部 URL 走代理，dataURL/base64 不走
  const isExternalUrl = /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin);
  preloadImg.src = isExternalUrl ? ('/api/proxy-image?url=' + encodeURIComponent(url)) : url;






  // 确定：合并结果并上传到参考图，然后关闭灯箱
  btnOk.onclick = () => {
    console.log('[BTN-OK] clicked, canvas size:', canvas.width, 'x', canvas.height);
    const dataURL = canvas.toDataURL('image/png');
    console.log('[BTN-OK] dataURL length:', dataURL.length);
    origImg.src = dataURL;
    origImg.style.display = '';
    canvasWrap.remove();
    ie._cleanup = null;
    // 上传到参考图
    const blob = dataURLtoBlob(dataURL);
    const file = new File([blob], 'edited.png', { type: 'image/png' });
    console.log('[BTN-OK] referenceImages before:', referenceImages.length);
    if (referenceImages.length >= 8) referenceImages.shift();
    referenceImages.push({ file, dataURL });
    console.log('[BTN-OK] referenceImages after:', referenceImages.length);
    renderThumbs();
    console.log('[BTN-OK] renderThumbs called');
    // 关闭灯箱
    overlay.remove();
  };

  // 取消
  btnCancel.onclick = () => {
    canvasWrap.remove();
    origImg.style.display = '';
    ie._cleanup = null;
  };

  // 清理
  ie._cleanup = () => { editing = false; };
}

// fadeIn 动画
const style = document.createElement('style');
style.textContent = `@keyframes fadeIn{from{opacity:0}to{opacity:1}}`;
document.head.appendChild(style);

// 页面加载时恢复历史记录
renderHistory();



function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}
function dataURLtoBlob(dataURL) {
  const [header, data] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
