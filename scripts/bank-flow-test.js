// Walks the creators' system through the real API (run: npm run test:bank-flow). It needs a running
// server on a local database, and it writes test accounts and tasks there. Settings come from the
// named configuration in .claude/launch.json, which is not in git; the script never reads .env, which
// points at the live database, and stops if the database is not on this computer.
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

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
    check('migrations ran', Number(version.value) === 2, version);
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

    await db.end();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
