const { BrowserQRCodeReader } = window.ZXingBrowser;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { secret: localStorage.getItem('copi-yum-card'), card: null, ticket: null, ticketTimer: null, poller: null, staff: localStorage.getItem('copi-yum-staff') || '', cloud: false, scanner: null, controls: null, busy: false, entryKind: 'sale' };
const money = cents => cents == null ? '' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
const when = iso => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};
const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });
const staffPath = suffix => `${state.cloud ? '/staff/api' : '/api'}${suffix}`;
function show(el, yes) { el.classList.toggle('hidden', !yes); }
function toast(el, message, error = false) {
  el.textContent = message;
  el.classList.toggle('error', error);
  show(el, true);
}

function setView(staff) {
  show($('#customer-view'), !staff);
  show($('#staff-view'), staff);
  $('#role-switch').innerHTML = staff ? 'My card <span aria-hidden="true">↗</span>' : 'Staff view <span aria-hidden="true">↗</span>';
  if (!state.cloud) {
    const url = new URL(location.href);
    if (staff) url.searchParams.set('staff', '1'); else url.searchParams.delete('staff');
    history.replaceState(null, '', url);
  }
  if (staff) stopTicketPoll();
  else if (state.ticket) startTicketPoll();
}

function showStaffLogin(message = '') {
  show($('#staff-login'), true);
  show($('#staff-dashboard'), false);
  if (message) toast($('#login-result'), message, true);
}
function showStaffDashboard(staff) {
  state.staff = staff.name;
  $('#staff-name').innerHTML = `<option value="${escapeHtml(staff.name)}">${escapeHtml(staff.name)}</option>`;
  $('#staff-name').disabled = true;
  $('.identity-note').textContent = 'Email code sign-in';
  show($('.staff-caution'), false);
  show($('#staff-signout'), true);
  show($('#staff-login'), false);
  show($('#staff-dashboard'), true);
}

function renderCard(card) {
  state.card = card;
  show($('#welcome'), false);
  show($('#card-area'), true);
  $('#card-name').textContent = card.name;
  $('#stamp-count').textContent = card.progress.stamps;
  $('#stamp-grid').innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="stamp ${i < card.progress.stamps ? 'filled' : ''}" aria-label="${i < card.progress.stamps ? 'Earned stamp' : 'Empty stamp'}">${i < card.progress.stamps ? '★' : '✳'}</span>`).join('');
  show($('#reward-banner'), card.progress.rewards > 0);
  if (card.progress.rewards > 0) $('#reward-banner strong').textContent = `${card.progress.rewards} free ${card.progress.rewards === 1 ? 'coffee' : 'coffees'} unlocked!`;
  $('#card-history').innerHTML = card.history.length ? card.history.map(item => {
    const title = item.kind === 'stamp' ? 'Coffee stamp earned' : item.kind === 'reward' ? 'Free coffee redeemed' : 'Stamp reversed';
    const icon = item.kind === 'stamp' ? '★' : item.kind === 'reward' ? '✦' : '↶';
    return `<div class="history-item"><span class="history-icon">${icon}</span><span class="history-main"><strong>${title}</strong><small>${escapeHtml(when(item.created_at))} · ${escapeHtml(item.staff)}</small></span><span class="history-value">${item.kind === 'stamp' ? '+1' : item.kind === 'reversal' ? '−1' : ''}</span></div>`;
  }).join('') : '<div class="empty-state">Your coffee story starts here. Show a QR at your next visit!</div>';
}

async function loadCard() {
  if (!state.secret) return;
  try {
    const { card } = await api(`/api/cards/${state.secret}`);
    renderCard(card);
  } catch {
    localStorage.removeItem('copi-yum-card');
    state.secret = null;
    show($('#welcome'), true);
    show($('#card-area'), false);
  }
}

function stopTicketPoll() {
  clearInterval(state.poller);
  state.poller = null;
}
function startTicketPoll() {
  stopTicketPoll();
  if (!state.ticket) return;
  state.poller = setInterval(checkTicket, 2000);
}
function updateTimer() {
  if (!state.ticket) return;
  const seconds = Math.max(0, Math.ceil((Date.parse(state.ticket.expiresAt) - Date.now()) / 1000));
  $('#ticket-timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (seconds === 0) ticketFinished('expired');
}
function ticketFinished(status, card, action) {
  clearInterval(state.ticketTimer);
  stopTicketPoll();
  const area = $('#ticket-area');
  area.classList.toggle('success', status === 'used');
  area.classList.toggle('error', status !== 'used');
  $('#ticket-status').textContent = status === 'used' ? action === 'reward' ? 'Scanned! Your free coffee was redeemed.' : 'Scanned! 1 stamp was added to your card.' : 'This QR expired. Make a fresh one for staff.';
  $('#ticket-timer').textContent = status === 'used' ? 'DONE' : 'EXPIRED';
  show($('#refresh-qr'), true);
  if (card) renderCard(card); else if (status === 'used') loadCard();
}
async function checkTicket() {
  if (!state.ticket) return;
  try {
    const { status, card, action } = await api(`/api/tickets/${state.ticket.token}/status`);
    if (status !== 'active') ticketFinished(status, card, action);
  } catch { /* A temporary network error should not erase the displayed QR. */ }
}
async function issueTicket() {
  const button = $('#show-qr');
  button.disabled = true;
  try {
    const ticket = await post(`/api/cards/${state.secret}/tickets`, {});
    state.ticket = ticket;
    const area = $('#ticket-area');
    area.classList.remove('success', 'error');
    $('#qr-image').src = ticket.qr;
    $('#short-code').textContent = ticket.shortCode;
    $('#ticket-status').textContent = 'Ready for staff to scan. One scan = one stamp.';
    show($('#refresh-qr'), false);
    show(area, true);
    area.scrollIntoView({ behavior: 'smooth', block: 'center' });
    clearInterval(state.ticketTimer);
    state.ticketTimer = setInterval(updateTimer, 1000);
    updateTimer();
    startTicketPoll();
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
}

function selectedStaff() {
  if (!state.staff) throw new Error('Choose a staff name first.');
  return state.staff;
}
function stopCamera() {
  state.controls?.stop();
  state.controls = null;
  show($('#camera-area'), false);
}
async function redeem(code) {
  if (state.busy) return;
  state.busy = true;
  stopCamera();
  const result = $('#scan-result');
  try {
    const action = $('#scan-action').value;
    const data = await post(staffPath('/redeem'), { code, staff: selectedStaff(), action, item: $('#scan-item').value.trim() || 'Coffee', amount: $('#scan-amount').value });
    const { card } = data;
    result.classList.remove('error');
    result.innerHTML = action === 'reward'
      ? `<strong>✦ Free coffee redeemed.</strong><small>${escapeHtml(card.name)}'s reward was recorded. This free coffee does not earn a stamp.</small>`
      : `<strong>✓ Scanned! 1 stamp added.</strong><small>${escapeHtml(card.name)} now has ${card.progress.stamps} of 5 stamps. ${card.progress.rewards > 0 ? 'A free coffee is ready!' : ''}</small>${card.progress.rewards > 0 ? `<button type="button" class="button dark" id="redeem-reward" data-card="${escapeHtml(card.id)}">Redeem free coffee</button>` : ''}`;
    show(result, true);
    $('#manual-code').value = '';
    $('#scan-amount').value = '';
    if (action === 'stamp' && card.progress.rewards > 0) $('#redeem-reward').addEventListener('click', () => redeemReward(card.id));
  } catch (error) {
    result.innerHTML = `<strong>Could not add a stamp</strong><small>${escapeHtml(error.message)}</small>`;
    result.classList.add('error');
    show(result, true);
  } finally { state.busy = false; }
}
async function redeemReward(cardId) {
  try {
    const data = await post(staffPath('/rewards'), { cardId, staff: selectedStaff() });
    $('#scan-result').innerHTML = `<strong>✦ Free coffee redeemed.</strong><small>${escapeHtml(data.card.name)}'s reward was recorded. The free coffee does not earn a stamp.</small>`;
  } catch (error) { toast($('#scan-result'), error.message, true); }
}
async function startCamera() {
  if (state.busy) return;
  show($('#camera-area'), true);
  try {
    state.scanner ||= new BrowserQRCodeReader();
    state.controls = await state.scanner.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, $('#scan-video'), result => {
      if (result && !state.busy) redeem(result.getText());
    });
  } catch {
    stopCamera();
    toast($('#scan-result'), 'Camera unavailable here. Use Take or upload a QR photo, or type the code.', true);
  }
}

function manilaDay(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = type => parts.find(x => x.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
async function loadLedger() {
  try {
    const { sales, expenses } = await api(staffPath('/ledger'));
    const today = manilaDay(new Date().toISOString());
    const todaySales = sales.filter(row => manilaDay(row.created_at) === today);
    const todayExpenses = expenses.filter(row => manilaDay(row.created_at) === today);
    $('#today-sales').textContent = money(todaySales.reduce((sum, row) => sum + (row.amount_cents || 0), 0));
    $('#today-expenses').textContent = money(todayExpenses.reduce((sum, row) => sum + row.amount_cents, 0));
    const rows = [...todaySales.map(x => ({ ...x, kind: 'sale' })), ...todayExpenses.map(x => ({ ...x, kind: 'expense' }))].sort((a, b) => b.created_at.localeCompare(a.created_at));
    $('#ledger-list').innerHTML = rows.length ? rows.map(row => `<div class="history-item"><span class="history-icon ${row.kind === 'expense' ? 'expense' : ''}">${row.kind === 'expense' ? '−' : '+'}</span><span class="history-main"><strong>${escapeHtml(row.item)}</strong><small>${escapeHtml(when(row.created_at))} · ${escapeHtml(row.staff)}${row.ticket_id ? ' · QR stamp' : ''}</small></span><span class="history-value">${row.amount_cents == null ? 'No price' : money(row.amount_cents)}</span></div>`).join('') : '<div class="empty-state">No entries yet today.</div>';
  } catch (error) { $('#ledger-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

function setTab(tab) {
  $$('.staff-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  for (const name of ['scan', 'ledger', 'entry']) show($(`#${name}-panel`), name === tab);
  if (tab !== 'scan') stopCamera();
  if (tab === 'ledger') loadLedger();
}
function setEntryKind(kind) {
  state.entryKind = kind;
  $$('.entry-toggle button').forEach(button => button.classList.toggle('active', button.dataset.entry === kind));
  show($('#category-field'), kind === 'expense');
  show($('#note-field'), kind === 'expense');
  $('#entry-category').required = kind === 'expense';
}

async function init() {
  const params = new URLSearchParams(location.search);
  const linkSecret = params.get('card');
  if (linkSecret && /^[a-f0-9]{48}$/.test(linkSecret)) {
    state.secret = linkSecret;
    localStorage.setItem('copi-yum-card', linkSecret);
  }
  let config = { cloud: false, staffNames: [] };
  try {
    config = await api('/api/config');
  } catch { /* The page can still show saved card data when temporarily offline. */ }
  state.cloud = !!config.cloud;
  const staffView = state.cloud ? location.pathname.startsWith('/staff') : params.get('staff') === '1';
  setView(staffView);
  await loadCard();
  if (state.cloud && staffView) {
    try {
      const { staff } = await api('/staff/api/config');
      showStaffDashboard(staff);
    } catch { showStaffLogin(); }
  } else {
    $('#staff-name').innerHTML = '<option value="">Choose staff</option>' + (config.staffNames || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    $('#staff-name').value = state.staff;
  }
  if (state.cloud) $$('.export-row a').forEach(link => link.href = link.href.replace('/api/export', '/staff/api/export'));
  $('#email-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const email = $('#staff-email').value.trim().toLowerCase();
      await post('/api/auth/start', { email });
      show($('#code-form'), true);
      toast($('#login-result'), 'Email code sent. Check your inbox.');
      $('#staff-code').focus();
    } catch (error) { toast($('#login-result'), error.message, true); }
    finally { button.disabled = false; }
  });
  $('#code-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await post('/api/auth/verify', { email: $('#staff-email').value.trim().toLowerCase(), token: $('#staff-code').value.trim() });
      const { staff } = await api('/staff/api/config');
      showStaffDashboard(staff);
      $('#staff-code').value = '';
    } catch (error) { toast($('#login-result'), error.message, true); }
    finally { button.disabled = false; }
  });
  $('#staff-signout').addEventListener('click', async () => {
    try { await post('/api/auth/logout', {}); } catch { /* Hide the dashboard even if the request fails. */ }
    state.staff = '';
    showStaffLogin('Signed out.');
  });
  $('#role-switch').addEventListener('click', () => {
    if (state.cloud) location.href = staffView ? `/${state.secret ? `?card=${state.secret}` : ''}` : '/staff/';
    else setView($('#staff-view').classList.contains('hidden'));
  });
  $('#create-card-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const { secret, card } = await post('/api/cards', { name: $('#customer-name').value });
      state.secret = secret;
      localStorage.setItem('copi-yum-card', secret);
      const url = new URL(location.href);
      url.searchParams.set('card', secret);
      history.replaceState(null, '', url);
      renderCard(card);
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  });
  $('#show-qr').addEventListener('click', issueTicket);
  $('#refresh-qr').addEventListener('click', issueTicket);
  $('#copy-link').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.searchParams.set('card', state.secret);
    url.searchParams.delete('staff');
    try { await navigator.clipboard.writeText(url.toString()); $('#copy-link').textContent = 'Copied!'; }
    catch { prompt('Copy your card link:', url.toString()); }
    setTimeout(() => $('#copy-link').textContent = 'Copy my card link', 2500);
  });
  $('#staff-name').addEventListener('change', event => { state.staff = event.target.value; localStorage.setItem('copi-yum-staff', state.staff); });
  $('#scan-action').addEventListener('change', event => {
    const reward = event.target.value === 'reward';
    show($('#scan-sale-fields'), !reward);
    $('#manual-submit').textContent = reward ? 'Redeem' : 'Add stamp';
  });
  $$('.staff-tabs button').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#start-scan').addEventListener('click', startCamera);
  $('#stop-scan').addEventListener('click', stopCamera);
  $('#scan-photo').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      state.scanner ||= new BrowserQRCodeReader();
      const result = await state.scanner.decodeFromImageUrl(url);
      await redeem(result.getText());
    } catch { toast($('#scan-result'), 'No readable QR found in that photo. Try again or type the code.', true); }
    finally { URL.revokeObjectURL(url); event.target.value = ''; }
  });
  $('#manual-form').addEventListener('submit', event => { event.preventDefault(); redeem($('#manual-code').value); });
  $$('.entry-toggle button').forEach(button => button.addEventListener('click', () => setEntryKind(button.dataset.entry)));
  $('#entry-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = { staff: selectedStaff(), item: $('#entry-item').value, amount: $('#entry-amount').value, category: $('#entry-category').value, note: $('#entry-note').value };
      await post(staffPath(state.entryKind === 'sale' ? '/sales' : '/expenses'), payload);
      toast($('#entry-result'), `${state.entryKind === 'sale' ? 'Sale' : 'Expense'} saved.`);
      event.target.reset();
    } catch (error) { toast($('#entry-result'), error.message, true); }
  });
  window.addEventListener('beforeunload', stopCamera);
}
init();
