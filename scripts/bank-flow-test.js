// Walks the creators' system through the real API (run: npm run test:bank-flow). It needs a running
// server on a local database, and it writes test accounts and tasks there. Settings come from the
// named configuration in .claude/launch.json, which is not in git; the script never reads .env, which
// points at the live database, and stops if the database is not on this computer.
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { sweepPictures, ensureBankSchema } = require('../src/backend/bank.js');
const quizTrash = require('../src/backend/quiz-trash.js');
const quizVersions = require('../src/backend/quiz-versions.js');
const quizLinks = require('../src/backend/quiz-links.js');

const CONFIG = process.argv[2] || 'quizleris-studio';
const launch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'launch.json'), 'utf8'));
const cfg = launch.configurations.find(c => c.name === CONFIG)?.env;
if (!cfg) throw new Error(`No configuration "${CONFIG}" with settings in .claude/launch.json`);
if (!['127.0.0.1', 'localhost'].includes(cfg.DB_HOST)) throw new Error('This test writes to the database: local databases only');
const BASE = `http://127.0.0.1:${cfg.PORT}/api/bank`;
const stamp = Date.now();

let failures = 0;
const check = (name, ok, extra) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(extra)}`}`);
    if (!ok) failures++;
};

(async () => {
    const db = await mysql.createConnection({ host: cfg.DB_HOST, port: Number(cfg.DB_PORT), user: cfg.DB_USER, password: cfg.DB_PASS || '', database: cfg.DB_NAME });
    const ensure = async (username, role) => {
        await db.query("INSERT IGNORE INTO users (username, email, password_hash, role) VALUES (?, ?, 'x', ?)", [username, `${username}@local.test`, role]);
        const [[row]] = await db.query('SELECT id, username, role, subscription_tier FROM users WHERE username = ?', [username]);
        return { ...row, token: jwt.sign({ id: row.id, username: row.username, role: row.role, subscription_tier: row.subscription_tier }, cfg.JWT_SECRET, { expiresIn: '1d' }) };
    };
    const admin = await ensure('flow_admin', 'admin');
    const creator = await ensure('flow_creator', 'creator');
    const creator2 = await ensure('flow_creator2', 'creator');
    const teacher = await ensure('flow_teacher', 'teacher');

    const api = async (who, method, url, body) => {
        const res = await fetch(`${BASE}${url}`, {
            method,
            headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    const task = text => ({ content: { type: 'numeric', prompt: `${text} ${stamp}`, correctAnswerNumber: 4 } });

    const [[version]] = await db.query("SELECT value FROM bank_settings WHERE name = 'schema_version'");
    check('migrations ran', Number(version.value) === 3, version);
    const [[col]] = await db.query("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_items' AND COLUMN_NAME = 'status'");
    check('status has pool', String(col.t).includes("'pool'"), col);

    const meta = (await api(admin, 'GET', '/meta')).data;
    const topic = meta.topics.find(t => t.parentId && !t.archived);
    const c = { topicId: topic.id, gradeId: 6, difficultyId: meta.difficulties[0].id };

    // --- rules for creators ---
    let r = await api(creator, 'POST', '/items', { items: [task('Tiesiai')], scope: 'shared' });
    check('a creator cannot import straight into the bank', r.status === 403, r);
    r = await api(teacher, 'POST', '/items', { items: [task('Mokytojas')], scope: 'pool' });
    check('a teacher cannot add unsorted tasks', r.status === 403, r);

    // --- a creator's own tasks, tagged and sent together ---
    r = await api(creator, 'POST', '/items', { items: [task('Pirma'), task('Antra'), task('Trecia')], scope: 'mine' });
    check('creator saves own tasks', r.status === 200 && r.data.created === 3, r);
    const own = r.data.results.map(x => x.id);
    r = await api(creator, 'POST', '/labels/tags', { ids: own, add: ['algebra6'] });
    check('tags them', r.status === 200, r);
    r = await api(creator, 'GET', '/items?scope=tagged&tag=algebra6&limit=100&facets=none');
    check('the tag lists them', r.status === 200 && own.every(id => r.data.items.some(item => item.id === id)), r);

    r = await api(creator, 'POST', '/submissions', { tag: 'algebra6', note: 'Pirma partija', items: [{ id: own[0], ...c }, { id: own[1], ...c, gradeId: 7 }, { id: own[2] }] });
    check('send: two go, the unclassified one is held back', r.data.submitted === 2 && r.data.incomplete === 1, r);
    const batchId = r.data.batchId;
    const copies = r.data.results.filter(x => x.submitted).map(x => x.itemId);
    const [[copy]] = await db.query('SELECT status, grade_id, topic_id, subject_id FROM bank_items WHERE id = ?', [copies[1]]);
    check('the copy waits as a draft with the chosen classification', copy.status === 'draft' && copy.grade_id === 7 && copy.topic_id === topic.id && copy.subject_id === topic.subjectId, copy);
    const [[ownRow]] = await db.query('SELECT topic_id FROM bank_items WHERE id = ?', [own[0]]);
    check('the own task keeps the classification', ownRow.topic_id === topic.id, ownRow);
    r = await api(creator, 'POST', '/submissions', { items: [{ id: own[0], ...c }] });
    check('sending again says it already waits', r.data.pending === 1, r);

    r = await api(creator, 'GET', '/batches');
    const mineBatch = r.data.batches.find(b => b.id === batchId);
    check('the creator sees the send', mineBatch && mineBatch.pending === 2 && mineBatch.tag === 'algebra6', r);
    r = await api(creator, 'GET', '/batches/pending');
    check('a creator cannot see the admin queue', r.status === 403, r);
    r = await api(admin, 'GET', '/batches/pending');
    const pending = r.data.batches.find(b => b.id === batchId);
    check('the admin sees it as one send', pending && pending.count === 2 && pending.topics.includes(topic.id) && pending.grades.length === 2, r);
    r = await api(admin, 'GET', `/batches/${batchId}/items`);
    check('and its tasks', r.status === 200 && r.data.items.length === 2, r);
    r = await api(creator, 'PATCH', `/batches/${batchId}`, { action: 'approve' });
    check('a creator cannot approve', r.status === 403, r);
    r = await api(admin, 'PATCH', `/batches/${batchId}`, { action: 'approve' });
    check('one click approves the whole send', r.data.approved === 2, r);
    const [[published]] = await db.query('SELECT status FROM bank_items WHERE id = ?', [copies[0]]);
    check('and publishes it', published.status === 'published', published);

    // --- rejected, nothing is deleted, and it can come back ---
    r = await api(creator, 'POST', '/submissions', { tag: 'algebra6', items: [{ id: own[2], ...c }] });
    const third = r.data.results[0].itemId;
    r = await api(admin, 'PATCH', `/submissions/${third}`, { action: 'reject', note: 'Blogas atsakymas' });
    check('reject', r.data.rejected === 1, r);
    const [[rejected]] = await db.query('SELECT status FROM bank_items WHERE id = ?', [third]);
    check('a rejected copy is archived, not deleted', rejected?.status === 'archived', rejected);
    r = await api(creator, 'GET', '/batches');
    check('the creator sees the reason', r.data.batches[0].reason === 'Blogas atsakymas', r.data.batches[0]);
    r = await api(creator, 'POST', '/submissions', { items: [{ id: own[2], ...c, gradeId: 8 }] });
    const [[back]] = await db.query('SELECT status, grade_id FROM bank_items WHERE id = ?', [third]);
    check('sending again brings the same copy back', r.data.submitted === 1 && r.data.results[0].itemId === third && back.status === 'draft' && back.grade_id === 8, { r, back });
    await api(admin, 'PATCH', `/submissions/${third}`, { action: 'approve' });

    // --- an admin's send goes in at once ---
    r = await api(admin, 'POST', '/items', { items: [task('Admino')], scope: 'mine' });
    const adminOwn = r.data.results[0].id;
    r = await api(admin, 'POST', '/submissions', { items: [{ id: adminOwn, ...c }] });
    check('an admin\'s send is published at once', r.data.published === 1, r);

    // --- history and safe delete ---
    r = await api(admin, 'PUT', `/items/${copies[0]}`, { content: { type: 'numeric', prompt: `Pakeista ${stamp}`, correctAnswerNumber: 5 }, gradeId: 8 });
    check('edit', r.status === 200, r);
    r = await api(creator, 'GET', `/items/${copies[0]}/history`);
    const edit = r.data.entries.find(e => e.action === 'edited');
    check('the log holds both sides of the edit', edit && edit.changes.content.prompt[1].startsWith('Pakeista') && edit.changes.content.correctAnswerNumber[0] === 4 && edit.changes.gradeId[1] === 8 && edit.username === 'flow_admin', r.data.entries);
    check('and the whole story of the task', ['submitted', 'approved', 'edited'].every(a => r.data.entries.some(e => e.action === a)), r.data.entries.map(e => e.action));
    r = await api(creator, 'POST', `/history/${edit.id}/revert`);
    check('a creator cannot undo', r.status === 403, r);
    r = await api(admin, 'POST', `/history/${edit.id}/revert`);
    check('undo works', r.status === 200, r);
    const [[reverted]] = await db.query('SELECT c.content, i.grade_id FROM bank_item_content c JOIN bank_items i ON i.id = c.item_id WHERE c.item_id = ?', [copies[0]]);
    const content = typeof reverted.content === 'string' ? JSON.parse(reverted.content) : reverted.content;
    check('and puts the old text, answer and grade back', content.prompt.startsWith('Pirma') && content.correctAnswerNumber === 4 && reverted.grade_id === 6, reverted);
    r = await api(admin, 'GET', `/history?item=${copies[0]}&action=reverted`);
    check('the undo is logged too', r.data.entries.length === 1, r);

    r = await api(creator, 'PATCH', '/items', { ids: [copies[0]], set: { gradeId: 9 }, scope: 'shared' });
    check('bulk change', r.data.matched === 1, r);
    r = await api(admin, 'GET', `/history?item=${copies[0]}&action=classified`);
    check('is logged per task', r.data.entries[0]?.changes?.gradeId?.[1] === 9 && r.data.entries[0].username === 'flow_creator', r);
    r = await api(creator, 'PATCH', '/items', { ids: [third], set: { status: 'draft' }, scope: 'shared' });
    check('a creator cannot change a shared task\'s state', r.status === 403, r);

    r = await api(creator, 'DELETE', '/items', { ids: [copies[0]], scope: 'shared' });
    check('archive', r.data.archived === 1, r);
    r = await api(admin, 'DELETE', '/items', { ids: [copies[0]], scope: 'shared', purge: true });
    check('shared tasks cannot be deleted for good, even by an admin', r.status === 403, r);
    r = await api(creator, 'POST', `/items/${copies[0]}/restore`);
    check('a creator cannot restore', r.status === 403, r);
    r = await api(admin, 'POST', `/items/${copies[0]}/restore`);
    check('an admin restores it', r.data.status === 'published', r);

    // --- unsorted tasks ---
    r = await api(admin, 'PUT', '/pool/settings', { likes: 2, dislikes: 2 });
    check('settings', r.data.limits?.likes === 2, r);
    r = await api(creator, 'PUT', '/pool/settings', { likes: 1, dislikes: 1 });
    check('only an admin sets the limits', r.status === 403, r);
    r = await api(creator, 'POST', '/items', { items: ['Baseinas A', 'Baseinas B', 'Baseinas C', 'Baseinas D'].map(task), scope: 'pool' });
    check('a creator adds unsorted tasks', r.data.created === 4, r);
    const [a, b, d, e] = r.data.results.map(x => x.id);

    r = await api(teacher, 'GET', '/pool/feed');
    check('teachers have no feed', r.status === 403, r);
    r = await api(teacher, 'POST', '/items/fetch', { ids: [a] });
    check('teachers cannot open an unsorted task', r.status === 200 && r.data.items.length === 0, r);
    r = await api(teacher, 'GET', `/items?q=${encodeURIComponent('Baseinas')}&limit=100&facets=none`);
    check('nor find it', r.status === 200 && !r.data.items.some(item => [a, b, d, e].includes(item.id)), r);
    r = await api(creator, 'GET', `/items?status=pool&limit=100&facets=none`);
    check('staff can list them', r.data.items.some(item => item.id === a), r.status);

    const seen = [];
    let cursor;
    for (let page = 0; page < 200; page++) {
        const res = await api(creator, 'GET', `/pool/feed?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...res.data.items.map(item => item.id));
        cursor = res.data.nextCursor;
        if (!cursor) break;
    }
    check('the feed shows every task once', [a, b, d, e].every(id => seen.includes(id)) && new Set(seen).size === seen.length, { n: seen.length });

    r = await api(creator, 'POST', `/pool/${a}/vote`, { vote: 1 });
    check('a like counts', r.data.likes === 1 && !r.data.decision, r);
    r = await api(creator, 'POST', `/pool/${a}/vote`, { vote: 1 });
    check('one person, one vote', r.data.likes === 1, r);
    r = await api(creator2, 'POST', `/pool/${a}/vote`, { vote: 1 });
    check('N likes suggest it', r.data.decision === 'suggest', r);
    r = await api(admin, 'GET', '/pool/suggested');
    const suggested = r.data.items.find(item => item.id === a);
    check('the admin sees who liked it', suggested && suggested.fans.includes('flow_creator2') && suggested.likes === 2, r);
    r = await api(creator2, 'POST', `/pool/${a}/vote`, { vote: 0 });
    check('taking a like back takes the suggestion back', r.data.decision === 'unsuggest', r);
    await api(creator2, 'POST', `/pool/${a}/vote`, { vote: 1 });
    r = await api(admin, 'POST', `/pool/${a}/publish`, { topicId: c.topicId, gradeId: c.gradeId });
    check('publishing needs a full classification', r.status === 400, r);
    r = await api(admin, 'POST', `/pool/${a}/publish`, c);
    const [[live]] = await db.query('SELECT status, topic_id FROM bank_items WHERE id = ?', [a]);
    check('the admin sorts it into the bank', r.status === 200 && live.status === 'published' && live.topic_id === c.topicId, { r, live });

    await api(creator, 'POST', `/pool/${b}/vote`, { vote: -1 });
    r = await api(creator2, 'POST', `/pool/${b}/vote`, { vote: -1 });
    check('N dislikes take it out', r.data.decision === 'remove', r);
    const [[out]] = await db.query('SELECT status FROM bank_items WHERE id = ?', [b]);
    check('archived, not deleted', out.status === 'archived', out);
    r = await api(creator, 'POST', '/items', { items: [task('Baseinas B')], scope: 'pool' });
    const [[stillOut]] = await db.query('SELECT status FROM bank_items WHERE id = ?', [b]);
    check('adding it again does not bring it back', r.data.duplicates === 1 && stillOut.status === 'archived', r);
    r = await api(admin, 'POST', `/items/${b}/restore`);
    const [[again]] = await db.query('SELECT likes, dislikes FROM bank_pool WHERE item_id = ?', [b]);
    check('an admin can bring it back with a clean slate', r.data.status === 'pool' && again.dislikes === 0, { r, again });

    r = await api(creator, 'POST', '/labels/tags', { ids: [d], add: ['algebra6'] });
    check('an unsorted task goes straight to a tag', r.status === 200, r);
    r = await api(creator, 'GET', '/items?scope=tagged&tag=algebra6&limit=100&facets=none');
    check('and shows in it', r.data.items.some(item => item.id === d && item.status === 'pool'), r);
    r = await api(creator, 'POST', '/submissions', { tag: 'algebra6', items: [{ id: d, ...c }] });
    const [[moved]] = await db.query('SELECT status, topic_id, owner_id FROM bank_items WHERE id = ?', [d]);
    check('sending it moves it in place', r.data.submitted === 1 && r.data.results[0].itemId === d && moved.status === 'draft' && moved.topic_id === c.topicId, { r, moved });
    r = await api(admin, 'PATCH', `/submissions/${d}`, { action: 'reject', note: 'Dar ne' });
    const [[returned]] = await db.query('SELECT status FROM bank_items WHERE id = ?', [d]);
    check('rejected, it goes back to the unsorted tasks', returned.status === 'pool', returned);

    await api(creator, 'POST', `/pool/${e}/vote`, { vote: 1 });
    await api(creator2, 'POST', `/pool/${e}/vote`, { vote: 1 });
    r = await api(admin, 'POST', `/pool/${e}/dismiss`);
    check('not now', r.status === 200, r);
    r = await api(admin, 'GET', '/pool/suggested');
    check('leaves the suggestions', !r.data.items.some(item => item.id === e), r);
    const first = await api(admin, 'PUT', '/pool/settings', { likes: 1, dislikes: 1 });
    check('lowering the limits applies to votes already cast', first.status === 200, first);
    r = await api(admin, 'GET', '/pool/stats');
    check('stats', r.status === 200 && r.data.limits.likes === 1 && r.data.total >= 1, r);
    await api(admin, 'PUT', '/pool/settings', { likes: 2, dislikes: 2 });

    // --- what the review found ---
    r = await api(admin, 'DELETE', '/items', { ids: [a], scope: 'shared' });
    r = await api(admin, 'POST', `/items/${a}/restore`);
    check('a task sorted out of the pool comes back to the bank, not the pool', r.data.status === 'published', r);

    r = await api(creator, 'POST', '/items', { items: [task('Isimta')], scope: 'mine' });
    const lost = r.data.results[0].id;
    r = await api(creator, 'POST', '/submissions', { tag: 'kita', items: [{ id: lost, ...c }] });
    const lostBatch = r.data.batchId;
    const lostCopy = r.data.results[0].itemId;
    await api(creator, 'DELETE', '/items', { ids: [lostCopy], scope: 'shared' });
    r = await api(admin, 'GET', '/batches/pending');
    check('a waiting task taken out leaves the queue', !r.data.batches.some(batch => batch.id === lostBatch), r);
    r = await api(admin, 'PATCH', `/batches/${lostBatch}`, { action: 'approve' });
    check('and nothing is left to approve', r.status === 404, r);

    r = await api(creator, 'POST', '/items', { items: [task('Abu')], scope: 'mine' });
    const firstCopy = r.data.results[0].id;
    await api(creator, 'POST', '/submissions', { items: [{ id: firstCopy, ...c }] });
    r = await api(admin, 'POST', '/items', { items: [task('Abu')], scope: 'mine' });
    const adminCopy = r.data.results[0].id;
    r = await api(admin, 'POST', '/submissions', { items: [{ id: adminCopy, ...c, gradeId: 11 }] });
    const waitingId = r.data.results[0].itemId;
    const [[settled]] = await db.query('SELECT status, grade_id FROM bank_items WHERE id = ?', [waitingId]);
    check('an admin sending what already waits publishes it as the admin sorted it', settled.status === 'published' && settled.grade_id === 11, settled);
    const [[{ open }]] = await db.query("SELECT COUNT(*) AS open FROM bank_submissions WHERE item_id = ? AND status = 'pending'", [waitingId]);
    check('and settles the creator\'s send', Number(open) === 0, open);

    r = await api(admin, 'PATCH', '/items', { ids: [e], set: { status: 'pool' }, scope: 'shared' });
    check('nothing moves into the pool by hand', r.status === 400, r);
    r = await api(creator, 'PUT', `/items/${copies[1]}`, { content: { type: 'numeric', prompt: 'x', correctAnswerNumber: 1 }, status: 'archived' });
    check('a creator cannot change a state through an edit', r.status === 403, r);

    // --- a send never stays stuck, and nothing reaches teachers without an approval ---
    const statusOf = async id => (await db.query('SELECT status FROM bank_items WHERE id = ?', [id]))[0][0]?.status;
    const waitingOn = async id => Number((await db.query("SELECT COUNT(*) AS n FROM bank_submissions WHERE item_id = ? AND status = 'pending'", [id]))[0][0].n);
    const inPool = async id => (await db.query('SELECT item_id FROM bank_pool WHERE item_id = ?', [id]))[0].length === 1;
    const teacherSees = async id => (await api(teacher, 'POST', '/items/fetch', { ids: [id] })).data.items.length === 1;
    const sendOne = async (text, who = creator) => {
        const saved = await api(who, 'POST', '/items', { items: [task(text)], scope: 'mine' });
        const own = saved.data.results[0].id;
        const sent = await api(who, 'POST', '/submissions', { items: [{ id: own, ...c }] });
        return { own, copy: sent.data.results[0].itemId };
    };
    const ownSubmission = async (who, id) => (await api(who, 'GET', '/items?scope=mine&limit=20&facets=none')).data.items.find(item => item.id === id)?.submission;

    let one = await sendOne('Istraukta');
    await api(creator, 'DELETE', '/items', { ids: [one.copy], scope: 'shared' });
    check('archiving a waiting task settles its send', await waitingOn(one.copy) === 0);
    r = await api(creator, 'POST', '/submissions', { items: [{ id: one.own, ...c }] });
    check('so its creator can send it again', r.data.submitted === 1 && await statusOf(one.copy) === 'draft', r);
    await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'approve' });

    one = await sendOne('Masiskai');
    await api(admin, 'PATCH', '/items', { ids: [one.copy], set: { status: 'published' }, scope: 'shared' });
    check('a bulk publish settles the send as approved', await waitingOn(one.copy) === 0 && (await ownSubmission(creator, one.own))?.status === 'approved', await ownSubmission(creator, one.own));

    one = await sendOne('Redagavimu');
    const [waitingTask] = (await api(admin, 'POST', '/items/fetch', { ids: [one.copy] })).data.items;
    r = await api(admin, 'PUT', `/items/${one.copy}`, { content: waitingTask.content, status: 'published' });
    check('so does publishing through an edit', r.status === 200 && await waitingOn(one.copy) === 0, r);

    r = await api(creator, 'POST', '/items', { items: [task('Tiesiai is baseino')], scope: 'pool' });
    const direct = r.data.results[0].id;
    await api(admin, 'PATCH', '/items', { ids: [direct], set: { status: 'published' }, scope: 'shared' });
    check('a bulk publish of an unsorted task takes it out of the unsorted ones', !(await inPool(direct)));

    one = await sendOne('Atmesta');
    await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'reject', note: 'Blogai' });
    r = await api(admin, 'POST', `/items/${one.copy}/restore`);
    check('restoring a rejected task does not publish it', r.data.status === 'draft' && !(await teacherSees(one.copy)), r);
    check('it waits for an admin again', await waitingOn(one.copy) === 1);
    r = await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'approve' });
    check('and can be approved', r.data.approved === 1 && await teacherSees(one.copy), r);

    one = await sendOne('Laukusi');
    await api(creator, 'DELETE', '/items', { ids: [one.copy], scope: 'shared' });
    r = await api(admin, 'POST', `/items/${one.copy}/restore`);
    check('restoring a task taken out while waiting does not publish it either', r.data.status === 'draft' && await waitingOn(one.copy) === 1, r);
    await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'reject' });

    one = await sendOne('Antras siuntejas');
    await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'reject' });
    const otherOwn = (await api(creator2, 'POST', '/items', { items: [task('Antras siuntejas')], scope: 'mine' })).data.results[0].id;
    await api(creator2, 'POST', '/submissions', { items: [{ id: otherOwn, ...c }] });
    r = await api(admin, 'PATCH', `/submissions/${one.copy}`, { action: 'reject' });
    check('a task rejected twice is archived, not left as a draft', r.data.rejected === 1 && await statusOf(one.copy) === 'archived', r);

    r = await api(creator, 'POST', '/items', { items: [task('Importas')], scope: 'pool' });
    const imported = r.data.results[0].id;
    r = await api(admin, 'POST', '/items', { items: [{ ...task('Importas'), ...c, subjectId: topic.subjectId }], scope: 'shared' });
    const [[importedRow]] = await db.query('SELECT status, topic_id FROM bank_items WHERE id = ?', [imported]);
    check('an admin importing an unsorted task publishes it', r.data.created === 1 && importedRow.status === 'published' && importedRow.topic_id === c.topicId && !(await inPool(imported)), { r, importedRow });

    one = await sendOne('Importuojama laukianti');
    r = await api(admin, 'POST', '/items', { items: [task('Importuojama laukianti')], scope: 'shared' });
    check('an admin importing a waiting task publishes it and settles the send', r.data.created === 1 && await statusOf(one.copy) === 'published' && await waitingOn(one.copy) === 0, r);

    r = await api(creator, 'POST', '/items', { items: [{ content: { type: 'multiple-choice', prompt: `Raktai ${stamp}`, choices: [{ text: 'a', isCorrect: true }, { text: 'b' }] } }], scope: 'pool' });
    const keyed = r.data.results[0].id;
    const [fullTask] = (await api(admin, 'POST', '/items/fetch', { ids: [keyed] })).data.items;
    const reordered = { ...fullTask.content, choices: fullTask.content.choices.map(choice => Object.fromEntries(Object.entries(choice).reverse())) };
    await api(admin, 'PUT', `/items/${keyed}`, { content: reordered });
    r = await api(admin, 'GET', `/history?item=${keyed}&action=edited`);
    check('a save that changes nothing is not logged', r.data.entries.length === 0, r);
    await api(admin, 'PUT', `/items/${keyed}`, { content: { ...reordered, prompt: `Raktai\n${stamp}` } });
    r = await api(admin, 'GET', `/history?item=${keyed}&action=edited`);
    check('a new line in the text is', r.data.entries.length === 1 && r.data.entries[0].revertible === true, r);

    r = await api(creator, 'POST', '/items', { items: [task('zq trumpas')], scope: 'pool' });
    const shortWord = r.data.results[0].id;
    r = await api(admin, 'GET', '/history?q=zq&limit=100');
    check('a short word filters the log', r.data.entries.some(entry => entry.itemId === shortWord) && r.data.entries.every(entry => entry.preview?.includes('zq')), r.data.entries.length);

    r = await api(admin, 'GET', '/history/users');
    check('the log lists its actions', r.data.actions?.includes('pool_removed'), r);
    check('the log knows who', r.data.users.some(u => u.username === 'flow_creator'), r);
    r = await api(admin, 'GET', '/history?limit=5');
    check('the log pages', r.data.entries.length === 5 && r.data.nextBefore, r);
    const next = await api(admin, 'GET', `/history?limit=5&before=${r.data.nextBefore}`);
    check('page two follows page one', next.data.entries[0].id < r.data.entries[4].id, next);
    r = await api(admin, 'GET', `/history?q=${encodeURIComponent('Baseinas')}&limit=5`);
    check('the log searches', r.status === 200 && r.data.entries.length > 0, r);
    r = await api(teacher, 'GET', '/history');
    check('teachers have no log', r.status === 403, r);

    // --- quizzes keep their text, and point at pictures and tasks ---
    const site = async (who, method, url, body) => {
        const res = await fetch(`${BASE.replace('/bank', '')}${url}`, {
            method,
            headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
    };
    const picture = label => `data:image/png;base64,${Buffer.from(`${label} ${stamp}`).toString('base64')}`;
    const shaOf = url => url.slice('/api/media/'.length);
    const exists = async sha => (await db.query('SELECT sha256, unused_since FROM bank_media WHERE sha256 = ?', [sha]))[0][0];
    // Long past the week of waiting, and only for the pictures named: other local pictures stay out of it
    const age = sha => db.query('UPDATE bank_media SET unused_since = NOW() - INTERVAL 30 DAY WHERE sha256 = ?', [sha]);
    await db.query('DELETE FROM quizzes WHERE owner_id = ?', [teacher.id]); // what a failed run left: the free limit counts them

    const quizId = `flow_${stamp}`;
    const choices = [{ id: 'a', text: 'Taip', isCorrect: true }, { id: 'b', text: 'Ne' }];
    r = await site(teacher, 'POST', '/quizzes', {
        id: quizId,
        title: 'Flow',
        questions: [{
            id: 'q1',
            type: 'multiple-choice',
            prompt: 'Su paveikslais',
            image: picture('klausimas'),
            choices: [{ ...choices[0], image: picture('pasirinkimas') }, choices[1]]
        }]
    });
    check('a quiz with pictures saves', r.status === 200 && r.data.pictures, r);
    const questionUrl = r.data.pictures['q1|'];
    const choiceUrl = r.data.pictures['q1|a'];
    check('its pictures got addresses', /^\/api\/media\/[0-9a-f]{64}$/.test(questionUrl) && /^\/api\/media\/[0-9a-f]{64}$/.test(choiceUrl), r.data);
    check('its size no longer counts them', r.data.storage_bytes < 1000, r.data);
    r = await site(teacher, 'GET', `/quizzes/${quizId}`);
    check('the stored quiz holds the addresses', r.data.questions?.[0].image === questionUrl && r.data.questions[0].choices[0].image === choiceUrl, r);
    const media = await fetch(`${BASE.replace('/api/bank', '')}${questionUrl}`);
    check('a picture needs no login and is kept by the browser', media.status === 200 && /immutable/.test(media.headers.get('cache-control')), media.status);
    const [quizMedia] = await db.query('SELECT sha256 FROM quiz_media WHERE quiz_id = ?', [quizId]);
    check('the quiz is recorded as using both', quizMedia.length === 2, quizMedia);

    r = await site(teacher, 'POST', '/quizzes', { id: `${quizId}b`, title: 'Flow 2', questions: [{ id: 'q1', type: 'multiple-choice', prompt: 'Tas pats', image: picture('klausimas'), choices }] });
    check('the same picture in a second quiz is the same stored picture', r.data.pictures?.['q1|'] === questionUrl, r);
    r = await site(teacher, 'POST', '/quizzes', { id: `${quizId}c`, title: 'Flow 3', questions: [{ id: 'q1', type: 'multiple-choice', prompt: 'Keista', image: 'data:image/svg+xml;base64,PHN2Zz4=', choices }] });
    check('a picture the store refuses stays in the quiz, and the save works', r.status === 200 && !r.data.pictures['q1|'], r);
    r = await site(teacher, 'POST', '/quizzes', { id: `${quizId}c`, title: 'Flow 3', questions: [{ id: 'q1', type: 'multiple-choice', prompt: 'Dingęs', image: `/api/media/${'0'.repeat(64)}`, choices }] });
    check('a picture that no longer exists does not stop a save', r.status === 200, r);

    // The cleanup against the rules, on this database
    await age(shaOf(questionUrl));
    await sweepPictures(db);
    let row = await exists(shaOf(questionUrl));
    check('the cleanup leaves a picture a quiz shows, and stops its clock', row && row.unused_since === null, row);
    const refused = await db.query('DELETE FROM bank_media WHERE sha256 = ?', [shaOf(questionUrl)]).catch(error => error);
    check('the database itself refuses to delete it', refused.errno === 1451, refused.errno);

    // Tasks
    const bankTask = { type: 'multiple-choice', prompt: `Banko užduotis ${stamp}`, image: picture('banko'), choices };
    r = await api(admin, 'POST', '/items', { items: [{ content: bankTask, ...c }], scope: 'shared' });
    const shared = r.data.results?.[0].id;
    check('an admin adds a shared task with a picture', Boolean(shared), r);
    r = await api(teacher, 'POST', '/items/fetch', { ids: [shared] });
    const fetched = r.data.items?.[0];
    check('a task comes with its fingerprint', /^[0-9a-f]{40}$/.test(fetched?.hash), r);
    const oldPicture = fetched.content.image;
    const copyOfTask = id => ({ ...fetched.content, id, source: { bankId: shared, hash: fetched.hash } });
    r = await site(teacher, 'POST', '/quizzes', { id: quizId, title: 'Flow', questions: [copyOfTask('q2'), { ...copyOfTask('q3'), prompt: 'Mokytojo pakeista' }] });
    check('a quiz with bank questions saves', r.status === 200, r);
    const [links] = await db.query('SELECT question_id, item_id, origin_hash, question_hash FROM quiz_bank_links WHERE quiz_id = ? ORDER BY question_id', [quizId]);
    check('the server knows which task each came from', links.length === 2 && links.every(link => link.item_id === shared), links);
    check('an unchanged copy matches its task', links[0]?.origin_hash === fetched.hash && links[0]?.question_hash === fetched.hash, links);
    check('a changed one shows it', links[1]?.origin_hash === fetched.hash && links[1]?.question_hash !== fetched.hash, links);
    let [[counted]] = await db.query('SELECT uses FROM bank_items WHERE id = ?', [shared]);
    check('uses counts quizzes, not questions', counted.uses === 1, counted);
    const [pictures] = await db.query('SELECT sha256 FROM quiz_media WHERE quiz_id = ?', [quizId]);
    const counts = new Set(pictures.map(p => p.sha256));
    check('pictures of its earlier version still count as used', counts.size === 3 && [oldPicture, questionUrl, choiceUrl].every(url => counts.has(shaOf(url))), pictures);

    // Versions
    r = await site(teacher, 'GET', `/quizzes/${quizId}/versions`);
    check('each save that changed something is a version, newest first', r.status === 200 && r.data.versions?.map(v => v.version).join() === '2,1', r);
    await site(teacher, 'POST', '/quizzes', { id: quizId, title: 'Flow', questions: [copyOfTask('q2'), { ...copyOfTask('q3'), prompt: 'Mokytojo pakeista' }] });
    r = await site(teacher, 'GET', `/quizzes/${quizId}/versions`);
    check('saving the same again adds none', r.data.versions?.length === 2, r);
    r = await site(teacher, 'GET', `/quizzes/${quizId}/versions/1`);
    check('an earlier version comes back whole, with its pictures', r.status === 200 && r.data.id === quizId && r.data.questions?.[0].id === 'q1'
        && r.data.questions[0].image === questionUrl && r.data.questions[0].choices[0].image === choiceUrl && r.data.title === 'Flow', r);
    r = await site(creator2, 'GET', `/quizzes/${quizId}/versions`);
    check('nobody else sees them', r.status === 404, r);
    for (let i = 1; i <= 6; i++) {
        await site(teacher, 'POST', '/quizzes', { id: `${quizId}c`, title: 'Flow 3', questions: [{ id: 'q1', type: 'numeric', prompt: `Keitimas ${i}`, correctAnswerNumber: i }] });
    }
    const [[kept]] = await db.query(
        'SELECT (SELECT COUNT(*) FROM quiz_versions WHERE quiz_id = ?) AS versions, (SELECT COUNT(*) FROM quiz_version_questions WHERE quiz_id = ?) AS questions',
        [`${quizId}c`, `${quizId}c`]);
    check('the free plan keeps 5 versions, and only the questions they show', Number(kept.versions) === 5 && Number(kept.questions) === 5, kept);
    await db.query("INSERT INTO quizzes (id, owner_id, title, visibility, quiz_data, storage_bytes) VALUES (?, ?, 'Senas', 'private', ?, 0)",
        [`${quizId}d`, teacher.id, JSON.stringify({ id: `${quizId}d`, title: 'Senas', questions: [{ id: 'old', type: 'numeric', prompt: 'Senas klausimas', correctAnswerNumber: 1 }] })]);
    await site(teacher, 'POST', '/quizzes', { id: `${quizId}d`, title: 'Naujas', questions: [{ id: 'new', type: 'numeric', prompt: 'Naujas klausimas', correctAnswerNumber: 2 }] });
    r = await site(teacher, 'GET', `/quizzes/${quizId}d/versions/1`);
    check('a quiz saved before versions existed keeps what it was as version 1', r.data.title === 'Senas' && r.data.questions?.[0].prompt === 'Senas klausimas', r);

    r = await api(creator2, 'POST', '/items', { items: [task('Svetima')], scope: 'mine' });
    const someoneElses = r.data.results[0].id;
    await site(teacher, 'POST', '/quizzes', { id: `${quizId}b`, title: 'Flow 2', questions: [{ id: 'q9', type: 'numeric', prompt: 'Svetima', source: { bankId: someoneElses } }] });
    const [[claimed]] = await db.query('SELECT COUNT(*) AS n FROM quiz_bank_links WHERE item_id = ?', [someoneElses]);
    check('a quiz cannot claim another teacher\'s task', Number(claimed.n) === 0, claimed);

    // An edit and its undo, a week later
    r = await api(admin, 'PUT', `/items/${shared}`, { content: { ...fetched.content, image: picture('naujas') } });
    check('the shared task gets a new picture', r.status === 200, r);
    r = await api(admin, 'GET', `/history?item=${shared}&action=edited`);
    const pictureEdit = r.data.entries?.[0];
    check('the log has the edit', Boolean(pictureEdit), r);
    await db.query('DELETE FROM quiz_media WHERE quiz_id = ?', [quizId]); // so only the task's own link can save the old picture
    await age(shaOf(oldPicture));
    await sweepPictures(db);
    check('the task keeps the picture it had, for its log', Boolean(await exists(shaOf(oldPicture))), oldPicture);
    r = await api(admin, 'POST', `/history/${pictureEdit?.id}/revert`);
    check('so undoing the edit still works', r.status === 200, r);
    r = await api(admin, 'POST', '/items/fetch', { ids: [shared] });
    check('and brings the picture back', r.data.items?.[0].content.image === oldPicture, r);

    // Renewing on the free plan: public or private, a save gives 7 days, then it pauses, then it goes
    const renewed = `${quizId}b`;
    r = await site(teacher, 'POST', '/quizzes', { id: renewed, title: 'Flow 2', visibility: 'public', questions: [{ id: 'q9', type: 'numeric', prompt: 'Vieša', correctAnswerNumber: 1 }] });
    check('a free teacher\'s save says how long the quiz stays', r.status === 200 && r.data.keep_days === 7 && r.data.pause_days === 3 && Boolean(r.data.expires_at), r);
    let [[renewal]] = await db.query('SELECT TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hours FROM quizzes WHERE id = ?', [renewed]);
    check('a new free quiz, public too, is kept its first 30 days', Math.abs(Number(renewal.hours) - 30 * 24) <= 3, renewal);
    r = await site(teacher, 'POST', `/quizzes/${renewed}/keep`);
    [[renewal]] = await db.query('SELECT TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hours FROM quizzes WHERE id = ?', [renewed]);
    check('renewing within them does not shorten them', Math.abs(Number(renewal.hours) - 30 * 24) <= 3, renewal);
    // From day 30 on: the quiz was made 40 days ago, and its date has passed
    await db.query('UPDATE quizzes SET created_at = NOW() - INTERVAL 40 DAY, expires_at = NOW() - INTERVAL 1 HOUR WHERE id = ?', [renewed]);
    await db.query("INSERT INTO quiz_attempts (quiz_id, student_name, score, max_score) VALUES (?, 'Mokinys', 1, 1)", [renewed]);
    r = await site(null, 'GET', `/quizzes/${renewed}`);
    check('not renewed, students are told it is paused', r.status === 404 && r.data.code === 'quiz_paused', r);
    r = await site(teacher, 'GET', `/quizzes/${renewed}`);
    check('its teacher still opens it', r.status === 200, r);
    r = await site(creator2, 'POST', `/quizzes/${renewed}/keep`);
    check('nobody else can renew it', r.status === 404, r);
    r = await site(teacher, 'POST', `/quizzes/${renewed}/keep`);
    [[renewal]] = await db.query('SELECT TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hours FROM quizzes WHERE id = ?', [renewed]);
    check('after day 30, Renew brings it back for 7 days', r.status === 200 && Math.abs(Number(renewal.hours) - 7 * 24) <= 3, renewal);
    r = await site(null, 'GET', `/quizzes/${renewed}`);
    check('and students open it again', r.status === 200, r);
    r = await site(admin, 'POST', `/quizzes/${renewed}/keep`);
    [[renewal]] = await db.query('SELECT expires_at FROM quizzes WHERE id = ?', [renewed]);
    check('an admin renewing a free quiz gives the same 7 days, not forever', r.status === 200 && renewal.expires_at !== null, renewal);

    // Deleting: first among the deleted quizzes, for the plan's days, then for good, by name
    await site(teacher, 'POST', '/quizzes', { id: quizId, title: 'Flow', questions: [copyOfTask('q2'), { ...copyOfTask('q3'), prompt: 'Mokytojo pakeista' }] });
    const stray = `gone_${stamp}`;
    await db.query("INSERT INTO quiz_attempts (quiz_id, student_name, score, max_score) VALUES (?, 'Niekieno', 1, 1)", [stray]);
    await db.query("INSERT INTO quiz_attempts (quiz_id, student_name, score, max_score) VALUES (?, 'Mokinys', 1, 1)", [quizId]);
    const everything = async () => (await db.query(
        `SELECT (SELECT COUNT(*) FROM quizzes WHERE id = ?) AS live, (SELECT COUNT(*) FROM deleted_quizzes WHERE id = ?) AS deleted,
                (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = ?) AS attempts, (SELECT COUNT(*) FROM quiz_media WHERE quiz_id = ?) AS pictures,
                (SELECT COUNT(*) FROM quiz_bank_links WHERE quiz_id = ?) AS links, (SELECT COUNT(*) FROM quiz_versions WHERE quiz_id = ?) AS versions`,
        Array(6).fill(quizId)))[0][0];
    r = await site(teacher, 'DELETE', `/quizzes/${quizId}`);
    check('a teacher deletes a quiz', r.status === 200, r);
    let state = await everything();
    check('it moves to the deleted ones with its results, pictures, links and versions', Number(state.live) === 0 && Number(state.deleted) === 1
        && Number(state.attempts) === 1 && Number(state.pictures) === 3 && Number(state.links) === 2 && Number(state.versions) === 2, state);
    const [[waits]] = await db.query("SELECT reason, DATEDIFF(purge_at, deleted_at) AS days FROM deleted_quizzes WHERE id = ?", [quizId]);
    check('a free teacher\'s waits 14 days', waits.reason === 'deleted' && Number(waits.days) === 14, waits);
    r = await site(null, 'GET', `/quizzes/${quizId}`);
    check('students can no longer open it', r.status === 404, r);
    [[counted]] = await db.query('SELECT uses FROM bank_items WHERE id = ?', [shared]);
    check('a deleted quiz no longer counts as using a task', counted.uses === 0, counted);
    r = await site(teacher, 'GET', '/quiz-trash');
    const listed = r.data.quizzes?.find(q => q.id === quizId);
    check('the teacher sees it among the deleted ones', listed && listed.attempts === 1 && listed.questions === 2 && listed.reason === 'deleted', r);
    r = await site(teacher, 'POST', `/quiz-trash/${quizId}/restore`);
    check('the free plan cannot restore it', r.status === 403 && r.data.code === 'restore_premium', r);
    r = await site(creator2, 'POST', `/quiz-trash/${quizId}/restore`);
    check('nor anyone else', r.status === 404, r);
    r = await site(teacher, 'POST', '/quizzes', { id: quizId, title: 'Iš juodraščio', questions: [] });
    const fromDraft = r.data.id;
    check('saving the old draft makes a new quiz with a new code', r.status === 200 && fromDraft && fromDraft !== quizId, r);
    r = await site(admin, 'POST', `/quiz-trash/${quizId}/restore`);
    check('an admin restores it', r.status === 200 && r.data.id === quizId, r);
    state = await everything();
    check('it comes back with its results', Number(state.live) === 1 && Number(state.deleted) === 0 && Number(state.attempts) === 1, state);
    [[counted]] = await db.query('SELECT uses FROM bank_items WHERE id = ?', [shared]);
    check('and counts as using its task again', counted.uses === 1, counted);

    r = await site(teacher, 'DELETE', `/quizzes/${quizId}`);
    await db.query('UPDATE deleted_quizzes SET purge_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [quizId]);
    await db.query('UPDATE quizzes SET expires_at = NOW() - INTERVAL 4 DAY WHERE id = ?', [renewed]); // paused past its 3 days
    // The hourly job, as the server runs it
    const pool = mysql.createPool({ host: cfg.DB_HOST, port: Number(cfg.DB_PORT), user: cfg.DB_USER, password: cfg.DB_PASS || '', database: cfg.DB_NAME, connectionLimit: 3 });
    await ensureBankSchema(pool);
    await quizTrash.ensureQuizTrash(pool);
    await quizVersions.ensureQuizVersions(pool);
    await quizLinks.ensureQuizLinks(pool);
    await quizTrash.hourly(pool, { attemptsReady: true, pauseDays: 3 });
    await pool.end();
    state = await everything();
    check('after its days everything of that quiz goes, by name', Object.values(state).every(n => Number(n) === 0), state);
    const [[lapsed]] = await db.query(
        `SELECT (SELECT COUNT(*) FROM quizzes WHERE id = ?) AS live, (SELECT COUNT(*) FROM deleted_quizzes WHERE id = ?) AS deleted,
                (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = ?) AS attempts, (SELECT COUNT(*) FROM quiz_versions WHERE quiz_id = ?) AS versions`,
        Array(4).fill(renewed));
    check('a quiz paused past its 3 days goes for good with its results, not to the deleted ones', Object.values(lapsed).every(n => Number(n) === 0), lapsed);
    const [[strayRow]] = await db.query('SELECT COUNT(*) AS n FROM quiz_attempts WHERE quiz_id = ?', [stray]);
    check('and nothing else: a result without a quiz is left alone', Number(strayRow.n) === 1, strayRow);
    await db.query('DELETE FROM quiz_attempts WHERE quiz_id = ?', [stray]);

    await db.query('DELETE FROM quiz_media WHERE sha256 = ? AND quiz_id NOT IN (?)', [shaOf(choiceUrl), [quizId]]); // only this quiz showed it
    await sweepPictures(db);
    row = await exists(shaOf(choiceUrl));
    check('a picture nothing uses waits', row && row.unused_since !== null, row);
    await age(shaOf(choiceUrl));
    await sweepPictures(db);
    check('and goes when its week is over', !(await exists(shaOf(choiceUrl))), choiceUrl);

    r = await site(admin, 'DELETE', `/admin/users/${teacher.id}`);
    check('an admin deletes an account', r.status === 200, r);
    const [[left]] = await db.query(
        `SELECT (SELECT COUNT(*) FROM quizzes WHERE owner_id = ?) AS quizzes, (SELECT COUNT(*) FROM deleted_quizzes WHERE owner_id = ?) AS deleted,
                (SELECT COUNT(*) FROM bank_items WHERE owner_id = ?) AS tasks, (SELECT COUNT(*) FROM quiz_versions WHERE quiz_id = ?) AS versions`,
        [teacher.id, teacher.id, teacher.id, fromDraft]);
    check('its quizzes, deleted ones too, and own tasks go at once, by name', Object.values(left).every(n => Number(n) === 0), left);
    const [[stillShared]] = await db.query('SELECT COUNT(*) AS n FROM bank_items WHERE id = ?', [shared]);
    check('the shared bank is not touched', Number(stillShared.n) === 1, stillShared);

    await db.end();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
