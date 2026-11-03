// Speed check of the task bank on a LOCAL database: fills it with synthetic tasks and times the
// listings the editor asks for, showing EXPLAIN for each. It refuses any database that is not on
// this computer or whose name does not end in _bench, _dev or _test, so it never touches the live one.
//   node scripts/bench_bank.js --local [--items=200000] [--reuse] [--out=results.json]
const fs = require('fs');
const pool = require('../src/backend/db.js');
const core = require('../src/backend/bank-core.js');
const { ensureBankSchema, loadMeta, listItems, contextFor } = require('../src/backend/bank.js');

const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const host = process.env.DB_HOST || '127.0.0.1';
if (!process.argv.includes('--local') || !['127.0.0.1', 'localhost', '::1'].includes(host) || !/_(bench|dev|test)$/.test(process.env.DB_NAME || '')) {
    console.error('Refusing to run: pass --local, with DB_HOST on this computer and a DB_NAME ending in _bench, _dev or _test.');
    process.exit(1);
}
const ITEMS = Number(option('items') || 200000);
const OLD_TOPIC_TASKS = 3000;
const BATCH = 1000;
const RUNS = 15;

// Deterministic randomness, so two runs fill the same bank
function mulberry32(seed) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = mulberry32(42);
const pick = list => list[Math.floor(rng() * list.length)];
const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
function weighted(list, weights) {
    let roll = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) {
        roll -= weights[i];
        if (roll < 0) return list[i];
    }
    return list[list.length - 1];
}

const NAMES = ['Ieva', 'Mikas', 'Agnė', 'Rokas', 'Vaida', 'Tomas', 'Greta', 'Benas', 'Živilė', 'Lukas'];
const PLACES = ['Vilniuje', 'Kaune', 'Klaipėdoje', 'Šiauliuose', 'Panevėžyje', 'mokykloje', 'parduotuvėje', 'sporto salėje'];
const MATH = [
    (a, b, c) => `Išspręskite lygtį \\(${a}x + ${b} = ${c}\\).`,
    (a, b) => `Apskaičiuokite stačiakampio plotą, kai jo ilgis ${a} cm, o plotis ${b} cm.`,
    (a, b) => `Kiek procentų sudaro ${a} nuo ${a + b}?`,
    (a, b) => `Raskite skaičių ${a * 6} ir ${b * 4} didžiausią bendrą daliklį.`,
    (a, b) => `Trikampio du kampai lygūs ${a + 20}° ir ${b + 30}°. Raskite trečiąjį kampą.`,
    (a, b, c) => `Supaprastinkite reiškinį \\(${a}(x + ${b}) - ${c}x\\).`,
    a => `Metamas lošimo kauliukas. Kokia tikimybė, kad atvirs daugiau nei ${a % 6} akutės?`,
    (a, b) => `Traukinys važiavo ${a * 10} km/h greičiu ${b} val. Kokį atstumą jis nuvažiavo?`,
    (a, b) => `Nubraižykite funkcijos \\(y = ${a}x + ${b}\\) grafiką ir raskite jo susikirtimo su ašimis taškus.`,
    (a, b, c) => `Duomenys: ${a}, ${b}, ${c}, ${a + b}. Raskite jų vidurkį ir medianą.`,
    (a, b) => `Prekė kainavo ${a * 10} eurų, jai pritaikyta ${b}% nuolaida. Kiek dabar kainuoja prekė?`,
    a => `Apskaičiuokite \\(\\sqrt{${a * a}}\\) ir paaiškinkite, kodėl tai racionalusis skaičius.`,
    (a, b) => `Išspręskite nelygybę \\(${a}x - ${b} > 0\\) ir pavaizduokite sprendinius skaičių tiesėje.`,
    a => `Kvadrato perimetras lygus ${a * 4} cm. Raskite jo plotą.`,
    (a, b) => `Išspręskite lygčių sistemą: \\(x + y = ${a}\\), \\(x - y = ${b}\\).`
];
const GENERAL = [
    () => 'Kuris teiginys apie fotosintezę yra teisingas?',
    () => 'Kuriais metais įvyko Žalgirio mūšis?',
    () => 'Paaiškinkite, kodėl vanduo kalnuose verda žemesnėje temperatūroje.',
    () => 'Kuri iš šių valstybių ribojasi su Lietuva?',
    () => 'Nurodykite veiksmažodžio laiką ir asmenį pabrauktame sakinyje.',
    () => 'Kokios cheminės reakcijos metu išsiskiria anglies dioksidas?',
    a => `Perskaitykite tekstą ir atsakykite į ${a % 5 + 1} klausimus apie pagrindinę jo mintį.`,
    () => 'Kas yra paklausa ir pasiūla rinkos ekonomikoje?',
    () => 'Kuris algoritmas surikiuoja sąrašą greičiausiai vidutiniu atveju?',
    a => `Apskaičiuokite kūno greitį, jei per ${a} s jis nuvažiavo ${a * 12} m.`,
    () => 'Išvardykite pagrindines ląstelės dalis ir jų funkcijas.',
    () => 'Kuriame žemyne gyvena daugiausia žmonių?'
];

function makeQuestion(qtype, isMath) {
    const [a, b, c] = [int(2, 40), int(1, 30), int(3, 90)];
    const prompt = `${pick(NAMES)} ${pick(PLACES)}: ${pick(isMath ? MATH : GENERAL)(a, b, c)}`;
    switch (qtype) {
        case 'multiple-choice':
            return { type: qtype, prompt, choices: [a, b, c, a + b].map((n, i) => ({ id: 'abcd'[i], text: String(n), isCorrect: i === 0 })) };
        case 'numeric':
        case 'fill-blank':
            return { type: qtype, prompt, choices: [{ id: 'a', text: String(a + b), isCorrect: true }] };
        case 'true-false':
            return { type: qtype, prompt, isTrue: rng() < 0.5 };
        case 'text':
            return { type: qtype, prompt, isLongAnswer: rng() < 0.5 };
        default:
            return { type: qtype, prompt };
    }
}

async function addSyntheticTopics(meta) {
    // Subjects without a seeded curriculum get 5 areas × 6 topics × 3 subtopics, each in two neighbouring grades
    for (const subject of meta.subjects.values()) {
        if ([...meta.topics.values()].some(t => t.subject_id === subject.id)) continue;
        for (let a = 0; a < 5; a++) {
            const [area] = await pool.query('INSERT INTO bank_topics (subject_id, parent_id, name, sort_order) VALUES (?, NULL, ?, ?)', [subject.id, `${subject.name}: sritis ${a + 1}`, a]);
            for (let t = 0; t < 6; t++) {
                const [topic] = await pool.query('INSERT INTO bank_topics (subject_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)', [subject.id, area.insertId, `Tema ${a + 1}.${t + 1}`, t]);
                for (let s = 0; s < 3; s++) {
                    const [sub] = await pool.query('INSERT INTO bank_topics (subject_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)', [subject.id, topic.insertId, `Potemė ${a + 1}.${t + 1}.${s + 1}`, s]);
                    const grade = int(1, 11);
                    await pool.query('INSERT INTO bank_topic_grades (grade_id, topic_id, hours) VALUES ?', [[[grade, sub.insertId, 5], [grade + 1, sub.insertId, 5]]]);
                }
            }
        }
    }
}

async function fill() {
    // A fresh set of bank tables in this local test database (see the guard at the top)
    // Children before parents: the foreign keys would refuse it the other way round
    for (const table of ['bank_item_media', 'bank_item_values', 'bank_item_content', 'bank_items', 'bank_media', 'bank_topic_grades',
        'bank_values', 'bank_dimensions', 'bank_topics', 'bank_subjects', 'bank_difficulties', 'bank_grades', 'bank_settings']) {
        await pool.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await ensureBankSchema(pool);
    await addSyntheticTopics(await loadMeta(pool));
    const meta = await loadMeta(pool);
    const mathId = [...meta.subjects.values()].find(s => s.name === 'Matematika').id;
    const gradesOf = new Map();
    for (const topic of meta.adminData.topics) if (topic.grades.length) gradesOf.set(topic.id, topic.grades.map(([g]) => g));
    const leaves = [...gradesOf.keys()].map(id => ({ id, subjectId: meta.topics.get(id).subject_id, grades: gradesOf.get(id) }));
    // The worst case for a newest-first listing: one topic imported first and never again, so all
    // its tasks are the oldest rows (real imports come topic by topic)
    const oldTopic = leaves.find(l => meta.topics.get(l.id).name === 'Skaičių aibės');
    const mathLeaves = leaves.filter(l => l.subjectId === mathId && l !== oldTopic);
    const otherLeaves = leaves.filter(l => l.subjectId !== mathId);
    const valueIds = name => meta.adminData.dimensions.find(d => d.name === name).values.filter(v => v.parentId !== null || name !== 'Pasiekimas').map(v => v.id);
    const contexts = valueIds('Kontekstas');
    const achievements = valueIds('Pasiekimas');
    const levels = meta.levelIds;

    const started = Date.now();
    for (let first = 0; first < ITEMS; first += BATCH) {
        const items = [];
        const contents = [];
        const links = [];
        for (let n = first; n < Math.min(ITEMS, first + BATCH); n++) {
            const id = n + 1;
            const old = n < OLD_TOPIC_TASKS;
            const isMath = old || rng() < 0.4;
            const leaf = old ? oldTopic : pick(isMath ? mathLeaves : otherLeaves);
            const qtype = weighted(core.QTYPES, [50, 20, 8, 10, 10, 2]);
            const content = makeQuestion(qtype, isMath);
            items.push([
                id, old || rng() < 0.85 ? 0 : int(1, 300), rng() < 0.08 ? 'template' : 'problem', qtype,
                leaf.subjectId, pick(leaf.grades), old || rng() >= 0.05 ? leaf.id : null,
                rng() < 0.05 ? null : weighted(levels, [20, 35, 30, 15]),
                old ? 'published' : weighted(['published', 'draft', 'archived'], [95, 4, 1]),
                core.previewText(content), core.searchText(content), rng() < 0.15 ? 1 : 0,
                core.contentHash({ ...content, n }), Math.floor(Math.exp(rng() * 6)) - 1
            ]);
            contents.push([id, JSON.stringify(content)]);
            if (rng() < 0.4) links.push([pick(contexts), id]);
            if (isMath && rng() < 0.3) links.push([pick(achievements), id]);
        }
        await pool.query(`INSERT INTO bank_items (id, owner_id, kind, qtype, subject_id, grade_id, topic_id, difficulty_id, status,
                                                  preview, search_text, has_image, content_hash, uses) VALUES ?`, [items]);
        await pool.query('INSERT INTO bank_item_content (item_id, content) VALUES ?', [contents]);
        if (links.length) await pool.query('INSERT IGNORE INTO bank_item_values (value_id, item_id) VALUES ?', [links]);
        if ((first + BATCH) % 20000 === 0) console.log(`  ${first + BATCH} tasks, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    await pool.query('ANALYZE TABLE bank_items, bank_item_values');
    console.log(`Filled ${ITEMS} tasks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

async function timeIt(work) {
    for (let i = 0; i < 3; i++) await work();
    const times = [];
    for (let i = 0; i < RUNS; i++) {
        const t = process.hrtime.bigint();
        await work();
        times.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    times.sort((x, y) => x - y);
    return { median: times[Math.floor(RUNS / 2)], p95: times[Math.ceil(RUNS * 0.95) - 1] };
}

async function explain(params, ctx) {
    const page = core.buildListQuery(params, ctx);
    const [rows] = await pool.query(`EXPLAIN ${page.sql}`, page.args);
    return rows.map(r => `${r.table}:${r.type}/${r.key || '-'} rows≈${r.rows}${r.Extra ? ` (${r.Extra})` : ''}`).join(' | ');
}

async function bench() {
    const meta = await loadMeta(pool);
    const subject = [...meta.subjects.values()].find(s => s.name === 'Matematika').id;
    const topic = name => [...meta.topics.values()].find(t => t.name === name && t.subject_id === subject).id;
    const value = name => [...meta.values.values()].find(v => v.name === name).id;
    const shared = contextFor(0, 'published');
    const scenarios = [
        ['Klasė + dalykas', { subject, grade: 7 }],
        ['Temos šaka (Algebra, 8 kl.)', { subject, grade: 8, topic: topic('Algebra') }],
        ['Sena tema (3000 seniausių), 8 kl.', { subject, grade: 8, topic: topic('Skaičių aibės') }],
        ['Sena tema be klasės', { subject, topic: topic('Skaičių aibės') }],
        ['Sena sritis (Skaičiai ir skaičiavimai)', { subject, topic: topic('Skaičiai ir skaičiavimai') }],
        ['+ lygiai 2 ir 3', { subject, grade: 8, topic: topic('Algebra'), difficulty: '2,3' }],
        ['Populiariausi', { subject, grade: 7, sort: 'popular' }],
        ['Pagal sunkumą', { subject, grade: 7, sort: 'level' }],
        ['Paieška klasėje „lygt“', { subject, grade: 8, q: 'lygt' }],
        ['Paieška visame banke „trikampio kampai“', { q: 'trikampio kampai' }],
        ['Trumpas žodis „x“', { subject, grade: 7, q: 'x' }],
        ['Klasifikatorius „Asmeninis“', { subject, values: String(value('Asmeninis')) }],
        ['Visas bankas, naujausi', {}],
        ['Nepriskirti (adminui)', { topic: 'none' }],
        ['Mano užduotys (savininkas 7)', {}, contextFor(7, 'published')]
    ];
    const results = [];
    for (const [name, params, ctx = shared] of scenarios) {
        let total = 0;
        const first = await timeIt(async () => { total = (await listItems(pool, params, ctx)).total; });
        const next = await listItems(pool, params, ctx);
        const later = next.nextCursor ? await timeIt(() => listItems(pool, { ...params, cursor: next.nextCursor }, ctx)) : null;
        results.push({ name, total, first, later, plan: await explain(params, ctx) });
    }
    // A deep page: walk 40 pages of all maths tasks, then time the 41st
    let cursor = null;
    for (let i = 0; i < 40; i++) cursor = (await listItems(pool, { subject, cursor }, shared)).nextCursor;
    results.push({ name: '41-as puslapis (visa matematika)', total: null, first: null, later: await timeIt(() => listItems(pool, { subject, cursor }, shared)), plan: await explain({ subject, cursor }, shared) });

    const [sizes] = await pool.query(`SELECT table_name AS t, ROUND(data_length / 1048576, 1) AS data_mb, ROUND(index_length / 1048576, 1) AS index_mb
                                      FROM information_schema.TABLES WHERE table_schema = DATABASE() AND table_name LIKE 'bank\\_%' ORDER BY table_name`);
    const [[{ version }]] = await pool.query('SELECT VERSION() AS version');
    const ms = value => (value == null ? '—' : `${value.toFixed(1)} ms`);
    console.log(`\n${version}, ${ITEMS} tasks\n`);
    for (const r of results) {
        console.log(`${r.name.padEnd(42)} ${r.total == null ? ''.padEnd(9) : String(r.total).padStart(7) + '  '}` +
            `1-as psl. ${ms(r.first?.median).padStart(9)} (p95 ${ms(r.first?.p95)})   tolesnis ${ms(r.later?.median).padStart(9)} (p95 ${ms(r.later?.p95)})`);
        console.log(`    ${r.plan}`);
    }
    console.log('\nLentelės:', sizes.map(s => `${s.t} ${s.data_mb}+${s.index_mb} MB`).join(', '));
    const out = option('out');
    if (out) fs.writeFileSync(out, JSON.stringify({ version, items: ITEMS, results, sizes }, null, 2));
}

(async () => {
    try {
        if (!process.argv.includes('--reuse')) await fill();
        await bench();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
