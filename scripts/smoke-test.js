// Smoke test (run: npm run test:smoke). Boots the real server.js with an in-memory fake mysql pool.
const path = require('path');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const ROOT = path.join(__dirname, '..');

const users = [];
const quizzes = new Map();
const fakePool = {
  async query(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'SELECT 1') return [[{ 1: 1 }]];
    if (s.startsWith('INSERT INTO users')) {
      if (users.some(u => u.username === p[0] || u.email === p[1])) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      users.push({ id: users.length + 1, username: p[0], email: p[1], password_hash: p[2], role: 'teacher', subscription_tier: 'free', created_at: new Date() });
      return [{ insertId: users.length }];
    }
    if (s.startsWith('SELECT id, username, role, subscription_tier, password_hash FROM users')) return [users.filter(u => u.username === p[0])];
    if (s === 'SELECT * FROM users WHERE id = ?') return [users.filter(u => u.id === p[0])];
    if (s.startsWith('SELECT id, username, email, role')) return [users.map(({ password_hash, ...u }) => u)];
    if (s.startsWith('SELECT owner_id FROM quizzes')) { const q = quizzes.get(p[0]); return [q ? [{ owner_id: q.owner_id }] : []]; }
    if (s.startsWith('SELECT COUNT(*)')) return [[{ cnt: [...quizzes.values()].filter(q => q.owner_id === p[0]).length }]];
    if (s.startsWith('INSERT INTO quizzes')) { quizzes.set(p[0], { id: p[0], owner_id: p[1], title: p[2], visibility: p[3], quiz_data: JSON.parse(p[4]), expires_at: p[6] }); return [{}]; }
    if (s.startsWith('SELECT owner_id, visibility, expires_at, quiz_data')) { const q = quizzes.get(p[0]); return [q ? [q] : []]; }
    if (s.startsWith('SELECT q.id')) return [[...quizzes.values()]];
    if (s.startsWith('DELETE FROM quizzes WHERE id = ? AND owner_id')) { const q = quizzes.get(p[0]); if (q && q.owner_id === p[1]) { quizzes.delete(p[0]); return [{ affectedRows: 1 }]; } return [{ affectedRows: 0 }]; }
    throw new Error('Unhandled SQL in fake: ' + s);
  }
};
require.cache[require.resolve(path.join(ROOT, 'src/backend/db.js'))] = { exports: fakePool, loaded: true, id: 'db' };

process.env.NODE_ENV = 'test';
Object.assign(process.env, { JWT_SECRET: 'x'.repeat(64), DB_USER: 'u', DB_PASS: 'p', DB_NAME: 'n' });
const app = require(path.join(ROOT, 'server.js'));

(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const j = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data; const t = await r.text(); try { data = JSON.parse(t); } catch { data = t; }
    return { status: r.status, data };
  };
  let r;
  r = await j('GET', '/api/health'); assert.equal(r.status, 200);
  r = await j('GET', '/api/debug/tables'); assert.equal(r.status, 404, 'debug endpoint must be gone');
  r = await j('POST', '/api/auth/register', { username: 'a', email: 'x', password: '1' }); assert.equal(r.status, 400);
  r = await j('POST', '/api/auth/register', { username: 'alice', email: 'alice@ex.lt', password: 'password123' }); assert.equal(r.status, 201);
  r = await j('POST', '/api/auth/register', { username: 'bob', email: 'bob@ex.lt', password: 'password123' }); assert.equal(r.status, 201);
  r = await j('POST', '/api/auth/login', { username: 'alice', password: 'wrong' }); assert.equal(r.status, 401); assert.ok(!r.data.detail);
  r = await j('POST', '/api/auth/login', { username: 'nobody', password: 'wrong' }); assert.equal(r.status, 401);
  r = await j('POST', '/api/auth/login', { username: 'alice', password: 'password123' }); assert.equal(r.status, 200);
  assert.equal(r.data.user.subscription_tier, 'free', 'tier must be in token claims');
  const alice = r.data.token;
  const bob = (await j('POST', '/api/auth/login', { username: 'bob', password: 'password123' })).data.token;

  // forged token with leaked secret rejected
  const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));
  const forged = jwt.sign({ id: 99, role: 'admin' }, 'quizleris_super_secret_jwt_key_2026');
  r = await j('GET', '/api/admin/users', null, forged); assert.equal(r.status, 401);
  r = await j('GET', '/api/admin/users', null, alice); assert.equal(r.status, 403);

  r = await j('POST', '/api/quizzes', { id: 'bad id!', title: 't', questions: [] }, alice); assert.equal(r.status, 400);
  r = await j('POST', '/api/quizzes', { id: 'quiz_priv', title: 'Private', questions: [] }, alice); assert.equal(r.status, 200);
  r = await j('POST', '/api/quizzes', { id: 'quiz_pub', title: 'Public', visibility: 'public', questions: [] }, alice); assert.equal(r.status, 200);
  r = await j('GET', '/api/quizzes/quiz_priv'); assert.equal(r.status, 404, 'private quiz hidden from anon');
  r = await j('GET', '/api/quizzes/quiz_priv', null, bob); assert.equal(r.status, 404, 'private quiz hidden from other user');
  r = await j('GET', '/api/quizzes/quiz_priv', null, alice); assert.equal(r.status, 200);
  r = await j('GET', '/api/quizzes/quiz_pub'); assert.equal(r.status, 200);
  r = await j('POST', '/api/quizzes', { id: 'quiz_priv', title: 'hijack', questions: [] }, bob); assert.equal(r.status, 409);
  r = await j('DELETE', '/api/quizzes/quiz_priv', null, bob); assert.equal(r.status, 404);
  for (let i = 0; i < 3; i++) await j('POST', '/api/quizzes', { id: 'q' + i, title: 't', questions: [] }, alice);
  r = await j('POST', '/api/quizzes', { id: 'q9', title: 't', questions: [] }, alice); assert.equal(r.status, 403, 'free limit 5');
  r = await j('GET', '/api/nope'); assert.equal(r.status, 404); assert.equal(typeof r.data, 'object');
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }); assert.equal(r.status, 400);
  r = await fetch(base + '/'); assert.equal(r.status, 200); assert.ok((await r.text()).includes('<html'));
  r = await fetch(base + '/firebase-service.js'); assert.ok(!(await r.text()).includes('mockAuth'), 'firebase must not be served');
  console.log('SMOKE: all assertions passed');
  srv.close();
})().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
