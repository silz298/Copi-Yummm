import { randomBytes, createHash } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

let database;
let authClient;
const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const randomHex = count => randomBytes(count).toString('hex');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers }
});
function db() {
  if (!process.env.DATABASE_URL) throw fail(503, 'Database is not configured.');
  database ||= postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require' });
  return database;
}
function auth() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw fail(503, 'Staff email sign-in is not configured.');
  authClient ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return authClient;
}
function staffMap() {
  return new Map((process.env.STAFF_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean).map(pair => {
    const index = pair.indexOf('=');
    return index < 1 ? [pair.toLowerCase(), pair] : [pair.slice(0, index).trim().toLowerCase(), pair.slice(index + 1).trim()];
  }));
}
function required(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(400, `${label} is required (up to ${max} characters).`);
  return value.trim();
}
function amountCents(value, must = false) {
  if ((value === '' || value == null) && !must) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000 || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) throw fail(400, 'Enter a valid amount in PHP.');
  return Math.round(number * 100);
}
async function body(request) {
  const raw = await request.text();
  if (raw.length > 10000) throw fail(413, 'Request is too large.');
  try { return JSON.parse(raw || '{}'); } catch { throw fail(400, 'Invalid JSON.'); }
}
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw fail(403, 'This request must come from this website.');
}
function sessionToken(request) {
  return request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('cy_staff='))?.slice(9) || '';
}
async function staffFromRequest(request) {
  const token = sessionToken(request);
  if (!token) throw fail(401, 'Staff sign-in required. Enter the code sent to your email.');
  const { data, error } = await auth().auth.getUser(token);
  if (error || !data.user?.email) throw fail(401, 'Staff sign-in expired. Please sign in again.');
  const email = data.user.email.toLowerCase();
  const name = staffMap().get(email);
  if (!name) throw fail(403, 'This email is not listed as staff.');
  return { name, email };
}
async function cardBySecret(sql, secret) {
  const [card] = await sql`select * from public.cards where secret=${secret}`;
  if (!card) throw fail(404, 'Card not found. Save your card link to keep your stamps.');
  return card;
}
async function cardView(sql, card) {
  const [counts, history] = await Promise.all([
    sql`select kind, count(*)::integer as total from public.loyalty_events where card_id=${card.id} group by kind`,
    sql`select e.id,e.kind,e.staff,e.note,e.created_at,s.item,s.amount_cents
      from public.loyalty_events e left join public.sales s on e.sale_id=s.id
      where e.card_id=${card.id} order by e.created_at desc limit 30`
  ]);
  const byKind = Object.fromEntries(counts.map(row => [row.kind, row.total]));
  const paid = Math.max(0, (byKind.stamp || 0) - (byKind.reversal || 0));
  const redeemed = byKind.reward || 0;
  return { id: card.id, name: card.name, createdAt: card.created_at, progress: { paid, stamps: paid % 5, rewards: Math.max(0, Math.floor(paid / 5) - redeemed), redeemed }, history };
}
function tokenParts(value) {
  let key = required(value, 'QR or short code', 150).toUpperCase();
  if (key.startsWith('CY1:')) {
    const raw = key.slice(4).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(raw)) throw fail(400, 'That is not a Copi-Yum QR.');
    return { tokenHash: hash(raw), shortCode: null };
  }
  key = key.replace(/[\s-]/g, '');
  if (!/^[A-F0-9]{10}$/.test(key)) throw fail(400, 'Enter the 10-character code shown below the QR.');
  return { tokenHash: null, shortCode: key };
}
function csv(rows, columns) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(col => quote(row[col] instanceof Date ? row[col].toISOString() : row[col])).join(','))].join('\r\n');
}

async function handleAuth(request, path) {
  if (request.method === 'POST' && path === '/api/auth/start') {
    const email = required((await body(request)).email, 'Email', 254).toLowerCase();
    if (!staffMap().has(email)) throw fail(403, 'This email is not listed as staff.');
    const { error } = await auth().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw fail(400, error.message);
    return json({ message: 'Email code sent. Check your inbox.' });
  }
  if (request.method === 'POST' && path === '/api/auth/verify') {
    const input = await body(request);
    const email = required(input.email, 'Email', 254).toLowerCase();
    const token = required(input.token, 'Email code', 20);
    if (!staffMap().has(email)) throw fail(403, 'This email is not listed as staff.');
    const { data, error } = await auth().auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data.session?.access_token || data.user?.email?.toLowerCase() !== email) throw fail(401, 'Invalid or expired email code.');
    return json({ staff: { name: staffMap().get(email), email } }, 200, {
      'Set-Cookie': `cy_staff=${data.session.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.min(data.session.expires_in || 3600, 3600)}`
    });
  }
  if (request.method === 'POST' && path === '/api/auth/logout') return json({ message: 'Signed out.' }, 200, {
    'Set-Cookie': 'cy_staff=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  });
  if (request.method === 'GET' && path === '/api/auth/me') return json({ staff: await staffFromRequest(request) });
  throw fail(404, 'Not found.');
}

async function customerApi(request, sql, path) {
  if (request.method === 'GET' && path === '/api/config') return json({ cloud: true, provider: 'vercel', promotion: 'Buy 5 paid coffees, get 1 free.' });
  if (request.method === 'POST' && path === '/api/cards') {
    const name = required((await body(request)).name, 'Name', 50);
    const secret = randomHex(24);
    const [card] = await sql`insert into public.cards(secret,name) values (${secret},${name}) returning *`;
    return json({ secret, card: await cardView(sql, card) }, 201);
  }
  const cardMatch = path.match(/^\/api\/cards\/([a-f0-9]{48})$/);
  if (request.method === 'GET' && cardMatch) return json({ card: await cardView(sql, await cardBySecret(sql, cardMatch[1])) });
  const issueMatch = path.match(/^\/api\/cards\/([a-f0-9]{48})\/tickets$/);
  if (request.method === 'POST' && issueMatch) {
    const token = randomHex(32);
    const shortCode = randomHex(5).toUpperCase();
    let rows;
    try { rows = await sql`select * from private.issue_ticket(${issueMatch[1]},${hash(token)},${shortCode})`; }
    catch (error) { if (error.code === 'P0001') throw fail(404, error.message); throw error; }
    const qr = await QRCode.toDataURL(`CY1:${token}`, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    return json({ token, shortCode, expiresAt: rows[0].expires_at, qr }, 201);
  }
  const statusMatch = path.match(/^\/api\/tickets\/([a-f0-9]{64})\/status$/);
  if (request.method === 'GET' && statusMatch) {
    const [ticket] = await sql`select * from public.tickets where token_hash=${hash(statusMatch[1])}`;
    if (!ticket) throw fail(404, 'QR not found.');
    const status = ticket.used_at ? 'used' : new Date(ticket.expires_at).getTime() <= Date.now() ? 'expired' : 'active';
    const [card] = ticket.used_at ? await sql`select * from public.cards where id=${ticket.card_id}` : [];
    return json({ status, action: ticket.use_kind, card: card ? await cardView(sql, card) : undefined });
  }
  throw fail(404, 'Not found.');
}

async function staffApi(request, sql, path, staff) {
  if (request.method === 'GET' && path === '/staff/api/config') return json({ staff });
  if (request.method === 'POST' && path === '/staff/api/redeem') {
    const input = await body(request);
    const { tokenHash, shortCode } = tokenParts(input.code);
    const action = input.action === 'reward' ? 'reward' : 'stamp';
    const item = typeof input.item === 'string' && input.item.trim() ? required(input.item, 'Item', 80) : 'Coffee';
    const amount = amountCents(input.amount);
    let result;
    try { [result] = await sql`select * from private.redeem_ticket(${tokenHash},${shortCode},${staff.name},${action},${item},${amount})`; }
    catch (error) { if (error.code === 'P0001') throw fail(/expired/i.test(error.message) ? 410 : 409, error.message); throw error; }
    const [card] = await sql`select * from public.cards where id=${result.card_id}`;
    return json({ message: action === 'reward' ? 'Scanned! Free coffee redeemed.' : 'Scanned! 1 stamp added.', action, card: await cardView(sql, card), saleId: result.sale_id });
  }
  if (request.method === 'POST' && path === '/staff/api/rewards') {
    const cardId = required((await body(request)).cardId, 'Card ID', 36);
    if (!/^[a-f0-9-]{36}$/i.test(cardId)) throw fail(400, 'Invalid card ID.');
    try { await sql`select private.redeem_reward(${cardId}::uuid,${staff.name})`; }
    catch (error) { if (error.code === 'P0001') throw fail(409, error.message); throw error; }
    const [card] = await sql`select * from public.cards where id=${cardId}`;
    return json({ message: 'Free coffee redeemed.', card: await cardView(sql, card) });
  }
  if (request.method === 'POST' && path === '/staff/api/sales') {
    const input = await body(request);
    const item = required(input.item, 'Item', 80);
    const amount = amountCents(input.amount, true);
    const [sale] = await sql`insert into public.sales(item,amount_cents,staff) values (${item},${amount},${staff.name}) returning *`;
    return json({ sale }, 201);
  }
  if (request.method === 'POST' && path === '/staff/api/expenses') {
    const input = await body(request);
    const item = required(input.item, 'Item', 80);
    const category = required(input.category, 'Category', 50);
    const amount = amountCents(input.amount, true);
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
    const [expense] = await sql`insert into public.expenses(item,category,amount_cents,staff,note) values (${item},${category},${amount},${staff.name},${note}) returning *`;
    return json({ expense }, 201);
  }
  if (request.method === 'GET' && path === '/staff/api/ledger') {
    const [sales, expenses] = await Promise.all([
      sql`select * from public.sales order by created_at desc limit 100`,
      sql`select * from public.expenses order by created_at desc limit 100`
    ]);
    return json({ sales, expenses });
  }
  if (request.method === 'GET' && path === '/staff/api/export') {
    const kind = new URL(request.url).searchParams.get('kind');
    const columns = {
      sales: ['id','card_id','ticket_id','item','amount_cents','staff','created_at'],
      expenses: ['id','item','category','amount_cents','staff','note','created_at'],
      loyalty_events: ['id','card_id','sale_id','kind','staff','note','created_at']
    }[kind];
    if (!columns) throw fail(400, 'Choose sales, expenses, or loyalty_events.');
    const rows = kind === 'sales' ? await sql`select * from public.sales order by created_at` :
      kind === 'expenses' ? await sql`select * from public.expenses order by created_at` :
        await sql`select * from public.loyalty_events order by created_at`;
    return new Response('\uFEFF' + csv(rows, columns), { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="copi-yum-${kind}.csv"`, 'Cache-Control': 'no-store'
    } });
  }
  throw fail(404, 'Not found.');
}

export async function handle(request) {
  try {
    const url = new URL(request.url);
    const route = url.searchParams.get('path') || '';
    const staff = url.searchParams.get('staff') === '1';
    const path = `${staff ? '/staff' : ''}/api/${route}`;
    if (request.method !== 'GET') sameOrigin(request);
    if (path.startsWith('/api/auth/')) return await handleAuth(request, path);
    if (request.method === 'GET' && path === '/api/config') return json({ cloud: true, provider: 'vercel', promotion: 'Buy 5 paid coffees, get 1 free.' });
    if (staff) return await staffApi(request, db(), path, await staffFromRequest(request));
    return await customerApi(request, db(), path);
  } catch (error) {
    if (!error.status) console.error(error);
    return json({ error: error.status ? error.message : 'Server error.' }, error.status || 500);
  }
}

export default { fetch: handle };
