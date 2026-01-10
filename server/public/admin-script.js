// Admin client: login and manage grid
const socketAdmin = (typeof io === 'function') ? io() : null;

const loginPanel = document.getElementById('loginPanel');
const adminControls = document.getElementById('adminControls');
const gridAdmin = document.getElementById('grid-container-admin');

async function loginAdmin() {
  const user = document.getElementById('adminUser').value;
  const pass = document.getElementById('adminPass').value;
  const res = await fetch('/admin/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ user, pass }) });
  if (!res.ok) return alert('Login failed');
  loginPanel.style.display = 'none';
  adminControls.style.display = 'flex';
  fetchState();
}

async function logoutAdmin() {
  await fetch('/admin/logout', { method: 'POST' });
  adminControls.style.display = 'none';
  loginPanel.style.display = 'flex';
}

async function fetchState() {
  const r = await fetch('/state');
  const s = await r.json();
  applyState(s);
}

function applyState(state) {
  document.getElementById('rowsInputAdmin').value = state.rows;
  document.getElementById('colsInputAdmin').value = state.cols;
  renderAdminGrid(state);
}

function renderAdminGrid(state) {
  gridAdmin.innerHTML = '';
  gridAdmin.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
  const blockedSet = new Set(state.blocked || []);
  const coordToNumber = {};
  let count = 1;
  for (let c = 0; c < state.cols; c++) {
    if (c % 2 === 0) {
      for (let r = state.rows - 1; r >= 0; r--) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) { coordToNumber[cid] = count; count++; }
      }
    } else {
      for (let r = 0; r < state.rows; r++) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) { coordToNumber[cid] = count; count++; }
      }
    }
  }

  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cid = `${r}-${c}`;
      const box = document.createElement('div');
      box.className = 'grid-box';
      if (blockedSet.has(cid)) { box.classList.add('invisible'); }
      else {
        const num = coordToNumber[cid];
        const name = state.names && state.names[num] ? state.names[num] : '';
        if (name) box.classList.add('has-name');
        box.innerHTML = `<div class="number-text">${num}</div><div class="subtitle-text">${name}</div>`;
        box.addEventListener('click', () => {
          document.getElementById('editBoxNumAdmin').value = num;
          document.getElementById('editSubtitleAdmin').value = name || '';
          document.getElementById('editVisibilityAdmin').value = 'show';
        });
      }
      gridAdmin.appendChild(box);
    }
  }
}

async function generateAdmin() {
  const r = parseInt(document.getElementById('rowsInputAdmin').value);
  const c = parseInt(document.getElementById('colsInputAdmin').value);
  const res = await fetch('/generate', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ rows: r, cols: c }) });
  if (!res.ok) return alert('Generate failed');
}

async function resetAdmin() {
  if (!confirm('Clear all names and gaps?')) return;
  const res = await fetch('/reset', { method: 'POST' });
  if (!res.ok) return alert('Reset failed');
}

async function updateAdmin() {
  const boxNum = parseInt(document.getElementById('editBoxNumAdmin').value);
  const subtitle = document.getElementById('editSubtitleAdmin').value;
  const visibility = document.getElementById('editVisibilityAdmin').value;
  if (!boxNum) return alert('Enter box number');
  const res = await fetch('/update', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ boxNum, subtitle, visibility }) });
  if (!res.ok) {
    const j = await res.json().catch(()=>({}));
    return alert('Update failed: ' + (j.error || 'unknown'));
  }
}

document.getElementById('loginBtn').addEventListener('click', loginAdmin);
document.getElementById('logoutBtn').addEventListener('click', logoutAdmin);
document.getElementById('generateBtnAdmin').addEventListener('click', generateAdmin);
document.getElementById('resetBtnAdmin').addEventListener('click', resetAdmin);
document.getElementById('updateBtnAdmin').addEventListener('click', updateAdmin);

if (socketAdmin) {
  socketAdmin.on('state', (s) => { if (adminControls.style.display === 'flex') applyState(s); else renderAdminGrid(s); });
  socketAdmin.on('stateUpdated', (s) => applyState(s));
}

// initial fetch
fetchState();
