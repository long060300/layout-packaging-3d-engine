/**
 * QuickPack viewer. One engine for every jobs/<code>/ folder.
 * Three.js r147 via the import map in index.html.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assertJob, cellPlacement, fitReport, floorMm } from './pack-rule.js';
import {
  applyFold,
  applyPose,
  buildAssembly,
  clonePacked,
  createPackPrototype,
  setBoardThickness,
  worldBox,
} from './assemble.js';

const params = new URLSearchParams(location.search);
const jobHref = new URL(params.get('job') || '../jobs/sample-zosia/panels.json', document.baseURI).href;

const canvas = document.getElementById('c');
const badge = document.getElementById('badge');
const stepsEl = document.getElementById('steps');
const fitEl = document.getElementById('fit');
const specEl = document.getElementById('spec');
const errEl = document.getElementById('err');
const slider = document.getElementById('t');
const playBtn = document.getElementById('play');
const showLid = document.getElementById('showLid');
const showLines = document.getElementById('showLines');
const spin = document.getElementById('spin');
const thick = document.getElementById('thick');
const titleEl = document.getElementById('title');
const codesEl = document.getElementById('codes');
const footEl = document.getElementById('foot');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  t: Number(params.get('t') || 0),
  target: null,
  job: null,
  boardMm: 2,
  carton: null,
  lid: null,
  templates: [],
  packed: [],
  prototypes: [],
};

function showError(err) {
  window.__quickpackFailed = true;
  errEl.hidden = false;
  errEl.textContent = err && err.message ? err.message : String(err);
  console.error(err);
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmt(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    stage: read('--stage', '#e2dfd7'),
    die: read('--die', '#2b4fa1'),
    crease: read('--crease', '#1f8a52'),
    window: read('--window', '#d0157a'),
  };
}

function applyTheme() {
  const colors = themeColors();
  scene.background = new THREE.Color(colors.stage);
  const dark = new THREE.Color(colors.stage).getHSL({}).l < 0.4;
  if (grid) scene.remove(grid);
  grid = new THREE.GridHelper(1000, 20, dark ? 0x3a3f44 : 0xc9c4b8, dark ? 0x2c3034 : 0xd6d2c8);
  grid.position.y = 0.15;
  scene.add(grid);
  ground.material.opacity = dark ? 0.35 : 0.16;
  for (const built of allBuilt()) {
    built.lineMaterials.cut.color.set(colors.die);
    built.lineMaterials.crease.color.set(colors.crease);
    built.lineMaterials.window.color.set(colors.window);
  }
}

function allBuilt() {
  return [state.carton, state.lid, ...state.templates, ...state.prototypes.map((p) => p.built)].filter(Boolean);
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe2dfd7);
const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);
camera.position.set(640, 480, 760);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 70, 0);
controls.maxPolarAngle = Math.PI * 0.98;
controls.minDistance = 80;
controls.maxDistance = 4000;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(280, 640, 360);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, near: 50, far: 1800 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.28);
fill.position.set(-420, 260, -280);
scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.16 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
let grid = null;

const loader = new THREE.TextureLoader();
const texCache = new Map();

function textureFor(url) {
  let entry = texCache.get(url);
  if (entry) return entry;
  entry = { mats: [] };
  const tex = loader.load(url, () => {
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    for (const mat of entry.mats) {
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
  }, undefined, (err) => console.warn('Texture failed', url, err));
  tex.encoding = THREE.sRGBEncoding;
  entry.tex = tex;
  texCache.set(url, entry);
  return entry;
}

function bindTextures(roots) {
  for (const root of roots) {
    root.traverse((obj) => {
      const ref = obj.userData && obj.userData.textureRef;
      const mats = Array.isArray(obj.material) ? obj.material : null;
      if (!ref || !mats) return;
      const idx = obj.userData.printMaterialIndex != null
        ? obj.userData.printMaterialIndex
        : 4;
      const mat = mats[idx];
      if (!mat) return;
      if (String(ref).startsWith('data:')) throw new Error('textureRef must be a file, not base64');
      const url = new URL(ref, jobHref).href;
      const entry = textureFor(url);
      entry.mats.push(mat);
      mat.map = entry.tex;
    });
  }
}

function pose(t) {
  const job = state.job;
  if (!job || !state.carton) return;
  if (state.carton) {
    applyFold(state.carton, t);
    applyPose(state.carton, t);
  }
  if (state.lid) {
    applyFold(state.lid, t);
    applyPose(state.lid, t);
    state.lid.root.visible = showLid.checked;
  }
  for (const built of state.templates) {
    applyFold(built, t);
    applyPose(built, t);
  }
  const floor = floorMm(state.boardMm, job.pack.floorBoardLayers);
  state.packed.forEach((item, index) => {
    const place = cellPlacement(job.pack, index, floor);
    const start = job.pack.dropWindow[0] + index * job.pack.stagger;
    const f = smooth((start), start + job.pack.dropDuration, t);
    item.expectedY = place.y;
    item.wrap.visible = t + 1e-6 >= start;
    item.wrap.position.set(place.x, place.y + (1 - f) * 280, place.z);
  });
  updateBadge(t);
}

function smooth(t0, t1, t) {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return u * u * (3 - 2 * u);
}

function currentStep(t) {
  let step = state.job.steps[0];
  for (const s of state.job.steps) if (t + 1e-6 >= s.t) step = s;
  return step;
}

function updateBadge(t) {
  const step = currentStep(t);
  badge.replaceChildren(el('span', String(Math.round(t))), document.createTextNode(step.label));
  for (const btn of stepsEl.querySelectorAll('button')) {
    if (Number(btn.dataset.t) === step.t) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  }
  slider.value = String(t);
}

function renderSpec(job, report) {
  specEl.replaceChildren();
  specEl.append(el('div', 'Job / phiếu', 'label'));
  const dl = document.createElement('dl');
  dl.className = 'spec';
  const row = (dt, dd) => {
    dl.append(el('dt', dt), el('dd', dd));
  };
  row('Code', job.meta.productCode);
  row('Sources', job.meta.sources.join(' · '));
  const nom = job.carton.nominalOutsideMm;
  row('Carton outside', `${nom.l} × ${nom.w} × ${nom.h} mm`);
  row('Board t', `${fmt(state.boardMm)} mm  ×  ${job.pack.floorBoardLayers} floor layers`);
  const g = job.pack.grid;
  row('Grid', `${g.cols} × ${g.rows}  ·  ${g.colMm} × ${g.rowMm} mm  ·  ${job.pack.eb}`);
  row('H', `${job.pack.itemHeightMm} mm`);
  const roll = (job.rolls || []).find((item) => item && item.rollMm);
  if (roll) {
    const m = roll.rollMm;
    row('Roll', `axis ${m.lengthMm} mm along L · OD ${m.odMm} mm estimate · ID ${m.idMm} mm · ×${job.pack.grid.cells.length}`);
    if (m.bags && m.pitchMm && m.filmThicknessMm) {
      row('OD', `sqrt(${m.idMm}² + 4×${m.bags}×${m.pitchMm}×${m.filmThicknessMm}/π) = ${m.odMm} mm`);
    }
  }
  row('Anchor', `${job.pack.anchor} → ${job.pack.restingYRule}`);
  row('Resting Y', `${fmt(report.restingY)} mm   (floor ${fmt(report.floor)} + rule)`);
  row('Hero → +Z', job.pack.heroTowardDisplay ? 'yes' : 'no');
  const textures = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.textureRef === 'string') textures.add(node.textureRef);
    Object.values(node).forEach(walk);
  };
  walk(job);
  row('Textures', textures.size ? [...textures].join(', ') : '(none)');
  specEl.append(dl);
  if (job.meta.notes) specEl.append(el('p', job.meta.notes, 'notes'));
  if (Array.isArray(job.meta.todo) && job.meta.todo.length) {
    const ul = document.createElement('ul');
    ul.className = 'notes';
    for (const item of job.meta.todo) ul.append(el('li', item));
    specEl.append(ul);
  }
}

function renderFit(report, measured) {
  fitEl.replaceChildren();
  const pending = report.packedCount === 0;
  const verdict = el('div', '', 'verdict ' + (pending ? '' : (report.fit ? 'ok' : 'bad')));
  verdict.textContent = pending ? 'NO PACK' : (report.fit ? 'FIT' : 'NOT FIT');
  fitEl.append(verdict);
  const rule = el('p', '', 'mono');
  if (report.anchor === 'center') {
    rule.textContent = `anchor center → Y = floor + H/2 = ${fmt(report.floor)} + ${fmt(report.H)}/2 = ${fmt(report.restingY)} mm`;
  } else {
    rule.textContent = `anchor pivot → Y = floor = ${fmt(report.restingY)} mm`;
  }
  fitEl.append(rule);
  const table = document.createElement('table');
  table.className = 'fitt';
  for (const row of report.rows) {
    const tr = document.createElement('tr');
    const ok = row.clearance >= -1e-6;
    tr.append(el('td', row.label));
    const td = el('td', (ok ? '+' : '') + fmt(row.clearance) + ' mm', ok ? 'ok' : 'bad');
    tr.append(td);
    table.append(tr);
  }
  fitEl.append(table);
  const cavity = el('p', '', 'mono');
  cavity.textContent =
    `Cavity ${fmt(report.cavityL)} × ${fmt(report.cavityW)} × ${fmt(report.cavityH)} mm` +
    ` · grid ${fmt(report.gridL)} × ${fmt(report.gridW)} · H ${fmt(report.H)} · t ${fmt(report.t)}`;
  fitEl.append(cavity);
  fitEl.append(el('p', 'Hood lips hang outside the walls. Height clearance uses the carton wall minus the floor, then H.', 'mono'));
  if (measured) {
    const m = el('p', '', 'mono');
    const [x, y, z] = measured.carton.map(fmt);
    m.textContent =
      `3D @ t=100: carton AABB ${x} × ${y} × ${z} mm` +
      ` · packed ${measured.packed} · max |Y − resting Y| ${fmt(measured.yError)} mm`;
    fitEl.append(m);
  }
}

function measureAtRest() {
  const prev = state.t;
  pose(100);
  const cartonBox = worldBox(state.carton.root);
  const size = cartonBox.getSize(new THREE.Vector3());
  let yError = 0;
  for (const item of state.packed) {
    if (!item.wrap.visible) continue;
    yError = Math.max(yError, Math.abs(item.wrap.position.y - item.expectedY));
  }
  pose(prev);
  return {
    carton: [size.x, size.y, size.z],
    packed: state.packed.length,
    yError,
  };
}

function refreshFit() {
  const report = fitReport(state.job, state.boardMm);
  const measured = state.carton ? measureAtRest() : null;
  renderSpec(state.job, report);
  renderFit(report, measured);
  return report;
}

function updatePlay() {
  const playing = state.target !== null;
  if (playing) playBtn.textContent = '❚❚ Dừng / Pause';
  else if (state.t >= 99.99) playBtn.textContent = '↺ Mở lại / Replay';
  else playBtn.textContent = '▶ Gấp / Fold';
}

function goTo(v) {
  if (reduceMotion) {
    state.t = v;
    state.target = null;
    pose(state.t);
    refreshFit();
  } else {
    state.target = v;
  }
  updatePlay();
}

function applyFrame(frame) {
  if (!frame) return;
  camera.position.set(frame.position[0], frame.position[1], frame.position[2]);
  controls.target.set(frame.target[0], frame.target[1], frame.target[2]);
  const reach = Math.max(1400, camera.position.distanceTo(controls.target) * 1.4);
  Object.assign(sun.shadow.camera, {
    left: -reach, right: reach, top: reach, bottom: -reach, far: reach * 3,
  });
  sun.shadow.camera.updateProjectionMatrix();
  controls.update();
}

function view(dir) {
  const frame = state.job && state.job.meta && state.job.meta.frameMm;
  if (dir === 'iso' && frame) {
    applyFrame(frame);
    return;
  }
  const d = dir === 'top'
    ? new THREE.Vector3(0.01, 1, 0.14)
    : dir === 'bottom'
      ? new THREE.Vector3(0.32, -0.78, 0.5)
      : new THREE.Vector3(0.7, 0.5, 0.82);
  const dist = state.t < 8 ? 1200 : 900;
  camera.position.copy(controls.target).addScaledVector(d.normalize(), dist);
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function wireUi(job) {
  titleEl.textContent = job.meta.title || job.meta.productCode;
  codesEl.replaceChildren();
  codesEl.append(el('span', job.meta.productCode));
  const src = el('span', job.meta.sources.join(' · '));
  codesEl.append(src);
  if (!job.lid) showLid.parentElement.hidden = true;
  stepsEl.replaceChildren();
  job.steps.forEach((step, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.t = String(step.t);
    btn.append(el('span', String(i), 'n'), el('span', step.label));
    btn.addEventListener('click', () => goTo(step.t));
    li.append(btn);
    stepsEl.append(li);
  });
  const match = [...thick.options].some((o) => Number(o.value) === job.carton.thicknessMm);
  if (!match) {
    const opt = document.createElement('option');
    opt.value = String(job.carton.thicknessMm);
    opt.textContent = `${job.carton.thicknessMm} mm (job)`;
    thick.append(opt);
  }
  thick.value = String(job.carton.thicknessMm);
  footEl.textContent = 'Three.js r147 · job JSON + texture files · one engine, no per-product fork';
}

function setLinesVisible(on) {
  scene.traverse((obj) => {
    if (obj.userData && obj.userData.line) obj.visible = on;
  });
}

async function main() {
  if (!THREE.REVISION || String(THREE.REVISION) !== '147') {
    console.warn('Expected Three.js r147, loaded r' + THREE.REVISION);
  }
  const res = await fetch(jobHref);
  if (!res.ok) throw new Error(`Job HTTP ${res.status} for ${jobHref}. Serve the repo over HTTP so the viewer can fetch JSON.`);
  const job = assertJob(await res.json());
  state.job = job;
  state.boardMm = job.carton.thicknessMm;
  wireUi(job);

  state.carton = buildAssembly(job.carton);
  setBoardThickness(state.carton, state.boardMm);
  scene.add(state.carton.root);
  if (job.lid) {
    state.lid = buildAssembly(job.lid);
    setBoardThickness(state.lid, state.boardMm);
    scene.add(state.lid.root);
  }
  const parts = [...(job.inners || []), ...(job.rolls || [])];
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const part of parts) {
    const built = buildAssembly(part);
    state.templates.push(built);
    scene.add(built.root);
  }
  const protoById = new Map();
  for (const id of new Set(job.pack.grid.cells)) {
    const part = byId.get(id);
    const proto = createPackPrototype(part, job.pack.heroTowardDisplay);
    protoById.set(id, proto);
    state.prototypes.push(proto);
  }
  bindTextures([
    state.carton.root,
    state.lid && state.lid.root,
    ...state.templates.map((b) => b.root),
    ...state.prototypes.map((p) => p.built.root),
  ].filter(Boolean));

  job.pack.grid.cells.forEach((id, index) => {
    const wrap = clonePacked(protoById.get(id), job.pack.anchor);
    wrap.userData.packed = true;
    scene.add(wrap);
    state.packed.push({ index, id, wrap, expectedY: 0 });
  });

  applyTheme();
  applyFrame(job.meta.frameMm);
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();
  state.t = Math.min(100, Math.max(0, state.t));
  pose(state.t);
  refreshFit();
  updatePlay();

  const api = {
    ready: true,
    revision: THREE.REVISION,
    jobHref,
    setT(v) {
      state.t = Number(v);
      state.target = null;
      pose(state.t);
      updatePlay();
      refreshFit();
      return api.snapshot();
    },
    setFrame(position, target) {
      applyFrame({ position, target });
      return api.snapshot();
    },
    snapshot() {
      const report = fitReport(state.job, state.boardMm);
      return {
        t: state.t,
        productCode: state.job.meta.productCode,
        anchor: state.job.pack.anchor,
        restingYRule: state.job.pack.restingYRule,
        restingY: report.restingY,
        fit: report.fit,
        clearances: report.rows.map((r) => r.clearance),
        packed: state.packed.map((item) => ({
          index: item.index,
          y: item.wrap.position.y,
          expected: item.expectedY,
          visible: item.wrap.visible,
        })),
      };
    },
  };
  window.__quickpackReady = true;
  window.__quickpack = api;
}

playBtn.addEventListener('click', () => {
  if (!state.job) return;
  if (state.target !== null) state.target = null;
  else if (state.t >= 99.99) goTo(0);
  else goTo(100);
  updatePlay();
});
slider.addEventListener('input', () => {
  if (!state.job) return;
  state.target = null;
  state.t = Number(slider.value);
  pose(state.t);
  refreshFit();
  updatePlay();
});
showLid.addEventListener('change', () => pose(state.t));
showLines.addEventListener('change', () => setLinesVisible(showLines.checked));
thick.addEventListener('change', () => {
  state.boardMm = Number(thick.value);
  if (state.carton) setBoardThickness(state.carton, state.boardMm);
  if (state.lid) setBoardThickness(state.lid, state.boardMm);
  pose(state.t);
  refreshFit();
});
document.getElementById('flat').addEventListener('click', () => goTo(0));
document.getElementById('reset').addEventListener('click', () => view('iso'));
document.getElementById('viewTop').addEventListener('click', () => view('top'));
document.getElementById('viewBottom').addEventListener('click', () => view('bottom'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.target !== null) {
    const dir = Math.sign(state.target - state.t);
    const step = 10 * dt;
    if (Math.abs(state.target - state.t) <= step) {
      state.t = state.target;
      state.target = null;
      updatePlay();
      refreshFit();
    } else {
      state.t += dir * step;
    }
    pose(state.t);
  }
  const below = camera.position.y < -2;
  ground.visible = !below;
  if (grid) grid.visible = !below;
  if (spin.checked) {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.35);
    camera.position.copy(controls.target).add(offset);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

main().catch(showError);
requestAnimationFrame(loop);
