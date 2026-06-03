// ========== 全局状态 ==========
const state = {
  mode: 'mosaic', // 'mosaic' | 'blur' | 'crop'
  src: null,       // 原始图片 base64
  brushSize: 20,
  strokes: [],     // 涂抹记录 [{x, y, size, mode}]
  cropBox: null,   // {x, y, w, h}
  cropRatio: 'free', // 'free' | '1:1' | '4:3' | '16:9'
  exportFormat: 'image/jpeg',
  exportQuality: 90,
};

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d');
const overlayCanvas = document.createElement('canvas');
const overlayCtx = overlayCanvas.getContext('2d');
const cropCanvas = document.createElement('canvas');
const cropCtx = cropCanvas.getContext('2d');

let isDrawing = false;
let img = new Image();

// ========== DOM 引用 ==========
function $(id) { return document.getElementById(id); }

// ========== 渲染 ==========
function render() {
  const root = document.getElementById('root');
  const m = window.innerWidth < 768;

  root.innerHTML = `
    <div style="height:100vh;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)">
      <!-- 顶部导航 -->
      <header style="padding:16px 24px 12px;display:flex;align-items:center;gap:16px;flex-shrink:0;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;margin-right:auto">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#22C55E,#16A34A);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;box-shadow:0 4px 16px rgba(34,197,94,.35)">🔲</div>
          <div>
            <div style="font-size:20px;font-weight:800;letter-spacing:-.5px">修修图·<span style="color:var(--accent)">电商工作台</span></div>
            <div style="font-size:10px;color:var(--text2)">图片打码 / 裁剪 / 本地处理</div>
          </div>
        </div>
        <!-- 模式切换 -->
        <div class="mode-group">
          <button class="mode-btn ${state.mode==='mosaic'?'active':''}" onclick="switchMode('mosaic')">🔲 马赛克</button>
          <button class="mode-btn ${state.mode==='blur'?'active':''}" onclick="switchMode('blur')">🌫️ 模糊</button>
          <button class="mode-btn ${state.mode==='crop'?'active':''}" onclick="switchMode('crop')">✂️ 裁剪</button>
        </div>
      </header>

      <!-- 主体 -->
      <main style="flex:1;display:flex;overflow:hidden;flex-direction:${m?'column':'row'};gap:16px;padding:0 20px 20px">
        ${renderSidebar()}
        ${renderPreview()}
      </main>
    </div>
  `;

  // 绑定事件
  setTimeout(() => {
    const fi = document.getElementById('fileInput');
    if (fi) fi.onchange = e => { if (e.target.files[0]) loadImage(e.target.files[0]); };

    const mainCanvas = document.getElementById('mainCanvas');
    if (mainCanvas) {
      mainCanvas.onmousedown = onPointerDown;
      mainCanvas.onmousemove = onPointerMove;
      mainCanvas.onmouseup = onPointerUp;
      mainCanvas.onmouseleave = onPointerUp;
      mainCanvas.ontouchstart = e => { e.preventDefault(); onPointerDown(e.touches[0]); };
      mainCanvas.ontouchmove = e => { e.preventDefault(); onPointerMove(e.touches[0]); };
      mainCanvas.ontouchend = onPointerUp;
    }

    // 画笔预览圈
    const brushPreview = document.getElementById('brushPreview');
    if (brushPreview && mainCanvas) {
      mainCanvas.onmousemove = function(e) {
        onPointerMove(e);
        const rect = mainCanvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        brushPreview.style.left = e.clientX + 'px';
        brushPreview.style.top = e.clientY + 'px';
        brushPreview.style.width = (state.brushSize / scaleX * 2) + 'px';
        brushPreview.style.height = (state.brushSize / scaleY * 2) + 'px';
        brushPreview.style.display = (state.mode === 'mosaic' || state.mode === 'blur') ? 'block' : 'none';
      };
      mainCanvas.onmouseleave = () => { brushPreview.style.display = 'none'; };
    }

    if (state.src) drawAll();
  }, 50);
}

function renderSidebar() {
  const m = window.innerWidth < 768;
  const hasImg = !!state.src;

  return `
    <div class="card" style="${m?'width:100%':'width:300px;flex-shrink:0'};display:flex;flex-direction:column;gap:16px;overflow-y:auto;max-height:${m?'45%':'100%'}">
      <div style="font-size:18px;font-weight:700;text-align:center">🔲 电商工作台</div>

      <!-- 上传区 -->
      ${!hasImg ? `
        <div class="upload-zone" onDragOver="event.preventDefault()" onDrop="event.preventDefault();if(event.dataTransfer.files[0])loadImage(event.dataTransfer.files[0])" onclick="document.getElementById('fileInput').click()">
          <div style="font-size:42px">🖼️</div>
          <div style="font-weight:600;margin-top:8px;font-size:15px">点击或拖拽图片到此处</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">100% 本地处理，不上传服务器</div>
        </div>
      ` : `
        <div style="text-align:center">
          <img src="${state.src}" class="preview-thumb" style="max-height:100px">
          <button onclick="resetAll()" style="font-size:12px;color:var(--text2);text-decoration:underline;margin-top:8px">重新选择</button>
        </div>
      `}
      <input id="fileInput" type="file" accept="image/*" hidden/>

      <!-- 打码设置（仅在打码模式下显示） -->
      ${(state.mode === 'mosaic' || state.mode === 'blur') && hasImg ? `
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:700;text-align:center">画笔大小</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="range" min="5" max="80" value="${state.brushSize}" oninput="state.brushSize=parseInt(this.value);render()">
            <span style="font-weight:700;font-size:14px;min-width:36px;color:var(--accent)">${state.brushSize}px</span>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="undoStroke()" class="btn btn-outline" style="flex:1;font-size:13px;padding:8px">↩ 撤销</button>
          <button onclick="clearStrokes()" class="btn btn-danger" style="flex:1;font-size:13px;padding:8px">🧹 全部清除</button>
        </div>
      ` : ''}

      <!-- 裁剪设置（仅在裁剪模式下显示） -->
      ${state.mode === 'crop' && hasImg ? `
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:700;text-align:center">裁剪比例</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">
            ${['free','1:1','4:3','16:9'].map(r => `
              <button onclick="state.cropRatio='${r}';render()" style="padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;border:2px solid ${state.cropRatio===r?'var(--accent)':'var(--border)'};background:${state.cropRatio===r?'var(--accent-light)':'#fff'};color:${state.cropRatio===r?'var(--accent)':'var(--text2)'}">${r==='free'?'自由':'📐 '+r}</button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 导出设置 -->
      ${hasImg ? `
        <div style="margin-top:auto">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:700;text-align:center">导出设置</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="font-size:12px;color:var(--text2)">格式</span>
            <select onchange="state.exportFormat=this.value;render()" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600">
              <option value="image/jpeg" ${state.exportFormat==='image/jpeg'?'selected':''}>JPG</option>
              <option value="image/png" ${state.exportFormat==='image/png'?'selected':''}>PNG</option>
              <option value="image/webp" ${state.exportFormat==='image/webp'?'selected':''}>WebP</option>
            </select>
            <span style="font-size:12px;color:var(--text2)">质量</span>
            <input type="range" min="10" max="100" value="${state.exportQuality}" oninput="state.exportQuality=parseInt(this.value);render()">
            <span style="font-weight:700;font-size:13px;min-width:36px;color:var(--accent)">${state.exportQuality}%</span>
          </div>
          <button onclick="exportImage()" class="btn btn-primary" style="width:100%">⬇ 导出图片</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderPreview() {
  const hasImg = !!state.src;
  return `
    <div class="card" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;min-height:400px">
      ${!hasImg ? `
        <div style="text-align:center;color:#aaa">
          <div style="font-size:64px;margin-bottom:12px">🔲</div>
          <div style="font-weight:600;font-size:16px">上传图片，开始打码或裁剪</div>
          <div style="font-size:12px;margin-top:6px">支持马赛克 · 模糊 · 裁剪，纯本地处理</div>
        </div>
      ` : `
        <div class="canvas-wrapper" id="canvasWrapper">
          <canvas id="mainCanvas"></canvas>
          <div class="brush-preview" id="brushPreview"></div>
        </div>
      `}
    </div>
  `;
}

// ========== 模式切换 ==========
function switchMode(mode) {
  state.mode = mode;
  render();
  if (state.src) setTimeout(() => drawAll(), 100);
}

// ========== 图片加载 ==========
function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.src = e.target.result;
    state.strokes = [];
    state.cropBox = null;
    img = new Image();
    img.onload = () => {
      initCanvas();
      drawAll();
      render();
    };
    img.src = state.src;
  };
  reader.readAsDataURL(file);
}

// ========== Canvas 初始化 ==========
function initCanvas() {
  const maxW = 1200, maxH = 900;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > h && w > maxW) { h = h * maxW / w; w = maxW; }
  else if (h > maxH) { w = w * maxH / h; h = maxH; }

  [canvas, originalCanvas, overlayCanvas].forEach(c => { c.width = w; c.height = h; });
  originalCtx.drawImage(img, 0, 0, w, h);
}

// ========== 绘制全部 ==========
function drawAll() {
  if (!state.src) return;
  // 清空主画布
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 绘制原图
  ctx.drawImage(originalCanvas, 0, 0);

  // 绘制所有涂抹
  if (state.mode === 'mosaic' || state.mode === 'blur') {
    state.strokes.forEach(s => applyStroke(s));
  }

  // 更新页面上的 canvas
  const mainCanvas = document.getElementById('mainCanvas');
  if (mainCanvas) {
    mainCanvas.width = canvas.width;
    mainCanvas.height = canvas.height;
    const mainCtx = mainCanvas.getContext('2d');
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(canvas, 0, 0);

    // 裁剪模式下绘制裁剪框
    if (state.mode === 'crop') {
      drawCropBox(mainCtx);
    }
  }
}

// ========== 涂抹处理 ==========
function applyStroke(stroke) {
  const size = stroke.size;
  const x = stroke.x - size;
  const y = stroke.y - size;
  const sw = size * 2;
  const sh = size * 2;

  if (stroke.mode === 'mosaic') {
    // 马赛克：像素化
    const imageData = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.min(sw, canvas.width - Math.max(0, x)), Math.min(sh, canvas.height - Math.max(0, y)));
    const data = imageData.data;
    const blockSize = Math.max(4, Math.floor(size / 2));
    for (let by = 0; by < imageData.height; by += blockSize) {
      for (let bx = 0; bx < imageData.width; bx += blockSize) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = 0; dy < blockSize && by + dy < imageData.height; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < imageData.width; dx++) {
            const idx = ((by + dy) * imageData.width + (bx + dx)) * 4;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; n++;
          }
        }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        for (let dy = 0; dy < blockSize && by + dy < imageData.height; dy++) {
          for (let dx = 0; dx < blockSize && bx + dx < imageData.width; dx++) {
            const idx = ((by + dy) * imageData.width + (bx + dx)) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(imageData, Math.max(0, x), Math.max(0, y));
  } else {
    // 高斯模糊简化版（盒式模糊叠加）
    const imageData = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.min(sw, canvas.width - Math.max(0, x)), Math.min(sh, canvas.height - Math.max(0, y)));
    const blurRadius = Math.max(2, Math.floor(size / 3));
    const copy = new Uint8ClampedArray(imageData.data);
    const w = imageData.width, h = imageData.height;
    // 3 次盒式模糊
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -blurRadius; dy <= blurRadius; dy++) {
            for (let dx = -blurRadius; dx <= blurRadius; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const idx = (ny * w + nx) * 4;
                r += copy[idx]; g += copy[idx + 1]; b += copy[idx + 2]; n++;
              }
            }
          }
          const idx = (y * w + x) * 4;
          imageData.data[idx] = r / n;
          imageData.data[idx + 1] = g / n;
          imageData.data[idx + 2] = b / n;
        }
      }
      copy.set(imageData.data);
    }
    ctx.putImageData(imageData, Math.max(0, x), Math.max(0, y));
  }
}

// ========== 裁剪框绘制 ==========
function drawCropBox(mainCtx) {
  const w = canvas.width, h = canvas.height;
  let box = state.cropBox;
  if (!box) {
    // 默认裁剪框：图片中央 80%
    const margin = 0.1;
    box = { x: w * margin, y: h * margin, w: w * (1 - margin * 2), h: h * (1 - margin * 2) };
    state.cropBox = box;
  }

  // 半透明遮罩
  mainCtx.fillStyle = 'rgba(0,0,0,0.4)';
  mainCtx.fillRect(0, 0, w, box.y);
  mainCtx.fillRect(0, box.y, box.x, box.h);
  mainCtx.fillRect(box.x + box.w, box.y, w - box.x - box.w, box.h);
  mainCtx.fillRect(0, box.y + box.h, w, h - box.y - box.h);

  // 裁剪框边框
  mainCtx.strokeStyle = '#22C55E';
  mainCtx.lineWidth = 2;
  mainCtx.setLineDash([6, 3]);
  mainCtx.strokeRect(box.x, box.y, box.w, box.h);

  // 四角拖拽手柄
  mainCtx.setLineDash([]);
  mainCtx.fillStyle = '#22C55E';
  [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].forEach(([cx, cy]) => {
    mainCtx.fillRect(cx - 6, cy - 6, 12, 12);
  });
}

// ========== 鼠标/触摸事件 ==========
function getPos(e) {
  const mainCanvas = document.getElementById('mainCanvas');
  if (!mainCanvas) return { x: 0, y: 0 };
  const rect = mainCanvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function onPointerDown(e) {
  if (!state.src || state.mode === 'crop') return;
  isDrawing = true;
  const pos = getPos(e);
  state.strokes.push({ x: pos.x, y: pos.y, size: state.brushSize, mode: state.mode });
  applyStroke(state.strokes[state.strokes.length - 1]);
  const mainCanvas = document.getElementById('mainCanvas');
  if (mainCanvas) {
    const mainCtx = mainCanvas.getContext('2d');
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(canvas, 0, 0);
  }
}

function onPointerMove(e) {
  if (!isDrawing || state.mode === 'crop') return;
  const pos = getPos(e);
  state.strokes.push({ x: pos.x, y: pos.y, size: state.brushSize, mode: state.mode });
  applyStroke(state.strokes[state.strokes.length - 1]);
  const mainCanvas = document.getElementById('mainCanvas');
  if (mainCanvas) {
    const mainCtx = mainCanvas.getContext('2d');
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(canvas, 0, 0);
  }
}

function onPointerUp() {
  isDrawing = false;
}

// ========== 操作函数 ==========
function undoStroke() {
  if (state.strokes.length === 0) return;
  // 撤销最后一段连续涂抹
  state.strokes.pop();
  // 重建画布
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(originalCanvas, 0, 0);
  state.strokes.forEach(s => applyStroke(s));
  drawAll();
}

function clearStrokes() {
  state.strokes = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(originalCanvas, 0, 0);
  drawAll();
}

function resetAll() {
  state.src = null;
  state.strokes = [];
  state.cropBox = null;
  render();
}

function exportImage() {
  if (!state.src) return;

  let exportCanvas = document.createElement('canvas');
  let exportCtx = exportCanvas.getContext('2d');

  if (state.mode === 'crop' && state.cropBox) {
    const box = state.cropBox;
    exportCanvas.width = box.w;
    exportCanvas.height = box.h;
    exportCtx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  } else {
    exportCanvas = canvas;
  }

  exportCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xiuxiutu_workbench.${state.exportFormat.split('/')[1]}`;
    a.click();
    URL.revokeObjectURL(url);
  }, state.exportFormat, state.exportQuality / 100);
}

// ========== 初始化 ==========
render();
window.addEventListener('resize', render); 