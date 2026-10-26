#!/usr/bin/env node
/**
 * Static checks for the QuickPack scaffold. No browser required.
 *
 *   node scripts/verify_pack.mjs
 *
 * Optional mesh check (hinges, hero normal, resting Y on real bounds) runs
 * when Node can import `three@0.147.0` from this repository:
 *
 *   mkdir -p /tmp/qp-three && cd /tmp/qp-three && npm init -y && npm install three@0.147.0
 *   mkdir -p node_modules && ln -sfn /tmp/qp-three/node_modules/three node_modules/three
 *   node scripts/verify_pack.mjs
 *
 * Optional browser smoke, when puppeteer is installed:
 *
 *   node scripts/verify_pack.mjs --browser
 *
 * That serves the repo, opens /viewer/, runs the fold slider to 100, and
 * checks FIT, resting Y, and that the page has no data:image base64.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertJob, cellPlacement, fitReport, restingY } from '../viewer/js/pack-rule.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error('FAIL', msg);
  process.exitCode = 1;
};
let checks = 0;
const ok = (msg) => {
  checks += 1;
  console.log('ok', msg);
};

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walkFiles(path, out);
    else out.push(path);
  }
  return out;
}

function minimalPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return body + xref;
}

const job = JSON.parse(read('jobs/sample-zosia/panels.json'));
assertJob(job);
ok('sample job passes assertJob');

if (restingY('center', 4, 120) !== 64) fail('center resting Y should be floor + H/2 = 64');
else ok('center → floor + H/2 = 64');
if (restingY('pivot', 4, 120) !== 4) fail('pivot resting Y should be floor = 4');
else ok('pivot → floor = 4');
try {
  restingY('middle', 0, 1);
  fail('unknown anchor should throw');
} catch {
  ok('unknown anchor throws');
}

const report = fitReport(job);
if (report.floor !== 4 || report.H !== 120 || report.restingY !== 64) {
  fail(`sample resting Y ${report.restingY}, floor ${report.floor}, H ${report.H}`);
} else ok('sample floor 4 + H/2 = 64');
if (!report.fit) fail('sample grid should FIT at t=2: ' + JSON.stringify(report.rows));
else ok('sample FIT at board 2 mm');
const wide = fitReport(job, 5);
if (wide.fit) fail('board 5 mm should NOT FIT the 46 mm grid in a 100 mm width');
else ok('board 5 mm is NOT FIT');

const cell = cellPlacement(job.pack, 0, report.floor);
if (cell.x !== -69 || cell.y !== 64 || cell.z !== 23) {
  fail(`cell 0 expected (-69, 64, 23), got (${cell.x}, ${cell.y}, ${cell.z})`);
} else ok('cell 0 center is (-69, 64, 23)');

const zosia = JSON.parse(read('jobs/zosia-slider-mix-1l3l/panels.json'));
assertJob(zosia);
ok('ZOSIA job passes assertJob');
const zReport = fitReport(zosia);
const zClear = zReport.rows.map((r) => r.clearance);
if (zReport.floor !== 4 || zReport.H !== 255 || zReport.restingY !== 131.5) {
  fail(`ZOSIA resting Y ${zReport.restingY}, floor ${zReport.floor}, H ${zReport.H}`);
} else ok('ZOSIA floor 4 + H/2 = 131.5');
if (!zReport.fit || zReport.packedCount !== 14) {
  fail(`ZOSIA FIT ${zReport.fit} count ${zReport.packedCount} clearances ${zClear.join(',')}`);
} else if (zClear[0] !== 13 || zClear[1] !== 1 || zClear[2] !== 0) {
  fail(`ZOSIA clearances expected 13, 1, 0 got ${zClear.join(', ')}`);
} else ok('ZOSIA FIT at board 2 mm: 14 inners, clearances 13 / 1 / 0 mm');
console.log('verify-json measured carton 297.5 × 155 × 259, per-side gaps clrLen 6.5 and clrWid 0.5, innerTop 259, lidCeil 261. This job keeps Product Master 297 × 155 × 259, so the formula gaps above are the ones that must pass.');
const zCell = cellPlacement(zosia.pack, 0, zReport.floor);
if (zCell.x !== -120 || zCell.y !== 131.5 || zCell.z !== 37.5 || zCell.id !== 'inner-1l') {
  fail(`ZOSIA cell 0 expected inner-1l at (-120, 131.5, 37.5), got ${zCell.id} (${zCell.x}, ${zCell.y}, ${zCell.z})`);
} else ok('ZOSIA cell 0 is inner-1l at (-120, 131.5, 37.5)');
const zCells = zosia.pack.grid.cells;
if (zCells.filter((id) => id === 'inner-1l').length !== 7 || zCells.filter((id) => id === 'inner-3l').length !== 7) {
  fail('ZOSIA grid must be 7 × inner-1l then 7 × inner-3l');
} else ok('ZOSIA grid is 7 × 1L + 7 × 3L');
const nom = zosia.carton.nominalOutsideMm;
if (nom.l !== 297 || nom.w !== 155 || nom.h !== 259) fail(`ZOSIA carton nominal ${nom.l}×${nom.w}×${nom.h}`);
else ok('ZOSIA carton nominal is Product Master 297 × 155 × 259');
const lidNom = zosia.lid && zosia.lid.nominalOutsideMm;
if (!lidNom || lidNom.l !== 304 || lidNom.w !== 161 || lidNom.h !== 265) fail('ZOSIA lid nominal should stay the dieline/verify estimate 304 × 161 × 265');
else ok('ZOSIA lid nominal is the dieline/verify estimate 304 × 161 × 265');
const note = zosia.meta.notes || '';
const cited = [
  'Packing_Material_Code_R7d',
  '50ZOAMIX0001568',
  '53ZOAMIX0001569',
  '54ZOA0010001570',
  '54ZOA0030001571',
  '28JMDWSL00101',
  '28JMDWSL00102',
  '0.047',
];
const missingCite = cited.filter((token) => !note.includes(token));
if (missingCite.length) fail('ZOSIA notes missing ' + missingCite.join(', '));
else ok('ZOSIA notes cite Product Master codes and the bag-film thickness');
if (zosia.inners.some((inner) => inner.thicknessMm === 0.047 || inner.thicknessMm < 0.1)) {
  fail('bag film 0.047 must stay meta, not inner board thickness');
} else ok('inner board is not the 0.047 mm bag film');

const refs = new Set();
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (typeof node.textureRef === 'string') refs.add(node.textureRef);
  Object.values(node).forEach(walk);
};
walk(job);
if (refs.size < 1) fail('sample job has no textureRef');
const zosiaRefs = new Set();
const walkZosia = (node) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(walkZosia); return; }
  if (typeof node.textureRef === 'string') zosiaRefs.add(node.textureRef);
  Object.values(node).forEach(walkZosia);
};
walkZosia(zosia);
if (zosiaRefs.size < 1) fail('ZOSIA job has no textureRef');
for (const ref of refs) {
  const path = join(root, 'jobs/sample-zosia', ref);
  if (!existsSync(path)) {
    fail('missing texture ' + ref);
    continue;
  }
  const buf = readFileSync(path);
  const magic = buf.subarray(0, 8).toString('hex');
  const png = magic.startsWith('89504e470d0a1a0a');
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!png && !webp) fail(ref + ' is not a png or webp');
  else if (buf.length > 400_000) fail(ref + ' is unexpectedly large');
  else ok('texture file ' + ref + ` (${buf.length} bytes)`);
}
for (const ref of zosiaRefs) {
  const path = join(root, 'jobs/zosia-slider-mix-1l3l', ref);
  if (!existsSync(path)) {
    fail('missing ZOSIA texture ' + ref);
    continue;
  }
  const buf = readFileSync(path);
  const magic = buf.subarray(0, 8).toString('hex');
  const png = magic.startsWith('89504e470d0a1a0a');
  const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!png && !webp) fail(ref + ' is not a png or webp');
  else if (buf.length > 400_000) fail(ref + ' is unexpectedly large');
  else ok('ZOSIA texture ' + ref + ` (${buf.length} bytes)`);
}

const dataUrl = ['data', 'image/'].join(':');
const b64Payload = [';', 'base64,'].join('');
const banned = [];
for (const file of walkFiles(root)) {
  if (/\.(png|webp|jpe?g)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (text.includes(dataUrl) || text.includes(b64Payload)) banned.push(relative(root, file));
}
if (banned.length) fail('embedded image data in ' + banned.join(', '));
else ok('no data:image / base64 payloads in text files');

const tmp = mkdtempSync(join(tmpdir(), 'qp-dieline-'));
const pdfPath = join(tmp, 'blank.pdf');
const outPath = join(tmp, 'panels.json');
writeFileSync(pdfPath, minimalPdf());
const parsed = spawnSync('python3', [
  join(root, 'parser/parse_dieline.py'), pdfPath, outPath, '--product-code', 'DRAFT-TEST',
], { encoding: 'utf8' });
if (parsed.status !== 0) fail('parser exit ' + parsed.status + '\n' + parsed.stderr);
else {
  const draft = JSON.parse(readFileSync(outPath, 'utf8'));
  assertJob(draft);
  const todo = (draft.meta.todo || []).join('\n');
  if (!todo.includes('TODO')) fail('parser skeleton is missing TODO markers');
  else ok('parser writes a valid draft with TODOs');
  const info = spawnSync('pdfinfo', ['-v'], { encoding: 'utf8' });
  if (info.error && info.error.code === 'ENOENT') {
    ok('pdfinfo not installed — skeleton uses the placeholder page size');
  } else if (draft.meta.pageSizeMm[0] === 148.2 && draft.meta.pageSizeMm[1] === 209.9) {
    ok('pdfinfo page size 420×595 pt → 148.2 × 209.9 mm');
  } else {
    fail('pdfinfo is installed but page size was ' + draft.meta.pageSizeMm.join('×'));
  }
}

const missing = spawnSync('python3', [
  join(root, 'parser/parse_dieline.py'), join(tmp, 'nope.pdf'), join(tmp, 'nope.json'),
], { encoding: 'utf8' });
if (missing.status !== 2) fail('parser should exit 2 when the PDF is missing, got ' + missing.status);
else ok('parser exit 2 on a missing PDF');

if (!read('viewer/index.html').includes('three@0.147.0')) fail('viewer must load Three.js r147 from the CDN');
else ok('viewer pins Three.js r147');

async function meshCheck() {
  let assemble;
  try {
    assemble = await import('../viewer/js/assemble.js');
  } catch (err) {
    console.log('SKIP mesh check — ' + err.message);
    console.log('Install three@0.147.0 so Node resolves "three", then re-run. See the header of this file.');
    return;
  }
  const { buildAssembly, applyFold, applyPose, createPackPrototype, clonePacked, worldBox } = assemble;
  const inner = job.inners[0];
  const proto = createPackPrototype(inner, true);
  const size = proto.size;
  console.log('inner AABB', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
  if (size.y < 115 || size.y > 125) fail(`inner height ${size.y.toFixed(2)} is not H=120`);
  if (size.x < 44 || size.x > 55 || size.z < 44 || size.z > 55) {
    fail(`inner footprint ${size.x.toFixed(2)} × ${size.z.toFixed(2)} is not about 46 × 46`);
  } else ok('folded inner is about 46 × 120 × 46');

  const wrap = clonePacked(proto, 'center');
  wrap.position.set(cell.x, cell.y, cell.z);
  const box = worldBox(wrap);
  const midY = (box.min.y + box.max.y) / 2;
  if (Math.abs(midY - 64) > 0.2) fail(`packed center Y ${midY.toFixed(2)} is not 64`);
  else ok('packed geometric center Y is floor + H/2');
  if (Math.abs(box.min.y - 4) > 1) fail(`packed bottom Y ${box.min.y.toFixed(2)} is not floor 4`);
  else ok('packed bottom sits on the floor');

  let hero = null;
  wrap.traverse((obj) => {
    if (obj.userData && obj.userData.printFace === 'hero') hero = obj;
  });
  if (!hero) fail('packed clone has no hero face');
  else {
    const e = hero.matrixWorld.elements;
    const len = Math.hypot(e[8], e[9], e[10]) || 1;
    const zz = e[10] / len;
    if (zz < 0.9) fail(`hero normal not toward +Z (${(e[8] / len).toFixed(2)}, ${(e[9] / len).toFixed(2)}, ${zz.toFixed(2)})`);
    else ok('hero print faces +Z');
  }

  const carton = buildAssembly(job.carton);
  applyFold(carton, 100);
  applyPose(carton, 100);
  const cbox = worldBox(carton.root);
  const csize = { x: cbox.max.x - cbox.min.x, y: cbox.max.y - cbox.min.y, z: cbox.max.z - cbox.min.z };
  console.log('carton AABB', csize.x.toFixed(2), csize.y.toFixed(2), csize.z.toFixed(2));
  if (csize.y < 150 || csize.y > 180) fail(`carton height ${csize.y.toFixed(2)}`);
  if (csize.x < 190 || csize.x > 240) fail(`carton length ${csize.x.toFixed(2)}`);
  if (csize.z < 95 || csize.z > 120) fail(`carton depth ${csize.z.toFixed(2)}`);
  else ok('folded carton is about 200 × 160 × 100');

  const lid = buildAssembly(job.lid);
  applyFold(lid, 100);
  applyPose(lid, 100);
  const lbox = worldBox(lid.root);
  const lidH = lbox.max.y - lbox.min.y;
  console.log('lid AABB y', lbox.min.y.toFixed(2), '→', lbox.max.y.toFixed(2));
  if (lidH > 80) fail(`lid lips look unfolded, vertical extent ${lidH.toFixed(2)}`);
  else ok('lid folds into a shallow hood');

  function bodyBox(obj) {
    obj.updateMatrixWorld(true);
    let box = null;
    obj.traverse((c) => {
      if (!c.isMesh || !c.userData || !c.userData.body || !c.geometry) return;
      c.geometry.computeBoundingBox();
      const bb = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
      if (!box) box = bb;
      else box.union(bb);
    });
    return box;
  }

  const protoById = new Map(zosia.inners.map((inner) => [inner.id, createPackPrototype(inner, zosia.pack.heroTowardDisplay)]));
  let underFloor = 0;
  const counts = { 'inner-1l': 0, 'inner-3l': 0 };
  for (let index = 0; index < zosia.pack.grid.cells.length; index += 1) {
    const id = zosia.pack.grid.cells[index];
    counts[id] += 1;
    const place = cellPlacement(zosia.pack, index, zReport.floor);
    const wrap = clonePacked(protoById.get(id), zosia.pack.anchor);
    wrap.position.set(place.x, place.y, place.z);
    const boards = bodyBox(wrap);
    if (!boards || boards.min.y < zReport.floor - 1e-6) underFloor += 1;
    if (index === 0) {
      const sx = boards.max.x - boards.min.x;
      const sy = boards.max.y - boards.min.y;
      const sz = boards.max.z - boards.min.z;
      console.log('ZOSIA inner boards', sx.toFixed(2), sy.toFixed(2), sz.toFixed(2), 'bottom', boards.min.y.toFixed(2));
      if (sx < 39 || sx > 42 || sz < 74 || sz > 78 || sy < 254 || sy > 257) {
        fail(`ZOSIA packed footprint ${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)} is not 40 × 255 × 75`);
      } else ok('ZOSIA packed boards are 40 × 255 × 75');
      let hero = null;
      wrap.traverse((obj) => {
        if (obj.userData && obj.userData.printFace === 'hero') hero = obj;
      });
      if (!hero) fail('ZOSIA packed clone has no hero face');
      else {
        const e = hero.matrixWorld.elements;
        const len = Math.hypot(e[8], e[9], e[10]) || 1;
        const zz = e[10] / len;
        if (zz < 0.9) fail(`ZOSIA hero normal not toward +Z (${(e[8] / len).toFixed(2)}, ${(e[9] / len).toFixed(2)}, ${zz.toFixed(2)})`);
        else ok('ZOSIA 40 mm hero faces the window (+Z); 75 mm panels stay along the row');
      }
    }
  }
  if (zosia.pack.grid.cells.length !== 14) fail('ZOSIA packed count ' + zosia.pack.grid.cells.length);
  else ok('ZOSIA packs 14 inners at fold 100');
  if (counts['inner-1l'] !== 7 || counts['inner-3l'] !== 7) fail('ZOSIA packed mix ' + JSON.stringify(counts));
  else ok('ZOSIA packed mix is 7 × 1L + 7 × 3L');
  if (underFloor) fail(`${underFloor} ZOSIA inners have board min.y under floor ${zReport.floor}`);
  else ok('ZOSIA board bottoms sit on or above the floor');

  const zCarton = buildAssembly(zosia.carton);
  applyFold(zCarton, 100);
  applyPose(zCarton, 100);
  const zc = bodyBox(zCarton.root);
  const zcSize = { x: zc.max.x - zc.min.x, y: zc.max.y - zc.min.y, z: zc.max.z - zc.min.z };
  console.log('ZOSIA carton boards', zcSize.x.toFixed(2), zcSize.y.toFixed(2), zcSize.z.toFixed(2));
  if (zcSize.x < 296 || zcSize.x > 302 || zcSize.y < 258 || zcSize.y > 262 || zcSize.z < 154 || zcSize.z > 158) {
    fail(`ZOSIA carton boards ${zcSize.x.toFixed(2)} × ${zcSize.y.toFixed(2)} × ${zcSize.z.toFixed(2)}`);
  } else ok('ZOSIA folded carton boards are 297 × 259 × 155');

  const zLid = buildAssembly(zosia.lid);
  applyFold(zLid, 100);
  applyPose(zLid, 100);
  const zl = bodyBox(zLid.root);
  console.log('ZOSIA lid boards y', zl.min.y.toFixed(2), '→', zl.max.y.toFixed(2));
  const zlX = zl.max.x - zl.min.x;
  const zlZ = zl.max.z - zl.min.z;
  if (zl.max.y < 260 || zl.max.y > 270 || zl.min.y < 0 || zl.min.y > 8 || zlX < 300 || zlX > 310 || zlZ < 158 || zlZ > 166) {
    fail(`ZOSIA lid boards x ${zlX.toFixed(2)} z ${zlZ.toFixed(2)} y ${zl.min.y.toFixed(2)}→${zl.max.y.toFixed(2)}`);
  } else ok('ZOSIA lid folds into a 304 × 161 hood, top at 265 mm');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browserSmoke() {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch (err) {
    fail('puppeteer is not installed (' + err.message + '). npm install puppeteer, then re-run with --browser.');
    return;
  }
  const launch = puppeteer.default?.launch || puppeteer.launch;
  const port = 18000 + Math.floor(Math.random() * 2000);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}/viewer/`;
  try {
    let up = false;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(url);
        if (res.ok) { up = true; break; }
      } catch { /* server still binding */ }
      await sleep(150);
    }
    if (!up) {
      fail('static server did not start for the browser smoke');
      return;
    }
    const browser = await launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      page.on('pageerror', (err) => console.log('pageerror', err.message));
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForFunction(() => window.__quickpack && window.__quickpack.ready, { timeout: 20000 });
      const snap = await page.evaluate(() => window.__quickpack.setT(100));
      if (!snap.fit) fail('browser FIT at t=100 was false');
      else ok('browser FIT at t=100');
      if (Math.abs(snap.restingY - 64) > 0.01) fail('browser resting Y ' + snap.restingY);
      else ok('browser resting Y is 64');
      const off = snap.packed.filter((p) => !p.visible || Math.abs(p.y - p.expected) > 0.2);
      if (off.length) fail('packed items not at resting Y: ' + JSON.stringify(off));
      else ok('browser packed items sit on resting Y');
      const html = await page.content();
      if (html.includes(dataUrl) || html.includes(b64Payload)) fail('viewer DOM contains an embedded image');
      else ok('viewer DOM has no embedded image');
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

await meshCheck();

if (process.argv.includes('--browser')) {
  await browserSmoke();
} else {
  console.log('SKIP browser smoke — re-run with --browser when puppeteer is installed.');
}

if (process.exitCode) {
  console.error(`\n${checks} checks passed, with failures above.`);
  process.exit(process.exitCode);
}
console.log(`\n${checks} checks passed.`);
