// 简易 GM UI：悬浮按钮 + 面板 + 命令行交互
export function renderGMButton() {
  let btn = document.getElementById('gm-toggle-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'gm-toggle-btn';
    btn.className = 'gm-button';
    btn.title = 'GM 调试面板 (按 `~` 显示)';
    btn.innerHTML = '⚙️';
    document.body.appendChild(btn);
  }
  return btn;
}

export function renderGMPanel() {
  let panel = document.getElementById('gm-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'gm-panel';
    panel.className = 'gm-panel hidden';
    panel.innerHTML = `
      <div class="gm-panel-inner">
        <div class="gm-header">GM 调试面板 <button id="gm-close" class="small">×</button></div>
        <div class="gm-body">
          <div class="gm-controls">
            <input id="gm-cmd" class="gm-cmd" placeholder="输入 /help 查看命令" />
            <button id="gm-exec" class="gm-exec">执行</button>
          </div>
          <div class="gm-quick" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button id="gm-add-1k" class="small">+1000万</button>
            <button id="gm-add-year" class="small">+1 年（不结算）</button>
            <button id="gm-phase-up" class="small">提升阶段</button>
          </div>
          <div id="gm-log" class="gm-log"></div>
        </div>
      </div>`;
    document.body.appendChild(panel);
  }
  return panel;
}

export function bindGMUI(gm) {
  const btn = renderGMButton();
  const panel = renderGMPanel();
  const input = panel.querySelector('#gm-cmd');
  const exec = panel.querySelector('#gm-exec');
  const close = panel.querySelector('#gm-close');
  const log = panel.querySelector('#gm-log');

  function showLog(text, level='info') {
    const el = document.createElement('div'); el.className = 'gm-log-line'; el.textContent = text; log.prepend(el);
  }

  btn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    input.focus();
  });
  close.addEventListener('click', () => panel.classList.add('hidden'));

  exec.addEventListener('click', async () => {
    const v = input.value.trim();
    if (!v) return;
    showLog(`> ${v}`);
    const r = await gm.executeCommand(v);
    if (r && r.msg) showLog(String(r.msg));
    input.value = '';
  });

  // 回车执行
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { exec.click(); }
  });

  // 快捷键：`键显示按钮
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') {
      btn.style.display = '';
      btn.classList.add('gm-visible');
    }
  });

  // quick action bindings
  const add1k = panel.querySelector('#gm-add-1k');
  const addYear = panel.querySelector('#gm-add-year');
  const phaseUp = panel.querySelector('#gm-phase-up');
  add1k.addEventListener('click', async () => {
    showLog('> +1000万');
    const r = await gm.executeCommand('/add 1000');
    if (r && r.msg) showLog(String(r.msg));
  });
  addYear.addEventListener('click', async () => {
    showLog('> +1 年（不结算）');
    const r = await gm.executeCommand('/time year');
    if (r && r.msg) showLog(String(r.msg));
  });
  phaseUp.addEventListener('click', async () => {
    showLog('> 提升阶段');
    const r = await gm.executeCommand('/phase next');
    if (r && r.msg) showLog(String(r.msg));
  });

  return { showLog };
}
