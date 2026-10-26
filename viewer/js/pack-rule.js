/**
 * Packing rules for every QuickPack job.
 * This is the only implementation of resting Y — the viewer and verify_pack.mjs both import it.
 *
 *   anchor "center" + restingYRule "floor+H/2" → geometric center at floor + H/2
 *   anchor "pivot"  + restingYRule "floor"     → assembly origin at floor
 *
 *   H     = pack.itemHeightMm
 *   floor = carton.thicknessMm × pack.floorBoardLayers
 *           (board layers under the goods; not the inner's own caliper)
 *
 * Panel local space: +X across the face, +Y up the upright face, +Z toward the print.
 * A panel hinges only as crease.panelB. The crease axis passes through the child origin
 * and axis.direction is expressed in that child panel's local space.
 */

export const ANCHOR_RULE = {
  center: 'floor+H/2',
  pivot: 'floor',
};

export const SOURCE_ENUM = ['dieline', 'ProductMaster', 'estimate'];
export const ROLE_ENUM = ['face', 'glue', 'flap', 'window'];
export const PRINT_ENUM = ['hero', 'text', 'kraft', 'none'];

const TEXTURE_REF = /^textures\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|webp|jpe?g)$/;

export function restingY(anchor, floor, height) {
  if (anchor === 'center') return floor + height / 2;
  if (anchor === 'pivot') return floor;
  throw new Error(`Unknown pack.anchor "${anchor}" (expected center or pivot)`);
}

export function floorMm(boardThicknessMm, floorBoardLayers) {
  return boardThicknessMm * floorBoardLayers;
}

export function assertPackRule(pack) {
  const expected = ANCHOR_RULE[pack.anchor];
  if (!expected) throw new Error(`Unknown pack.anchor "${pack.anchor}"`);
  if (pack.restingYRule !== expected) {
    throw new Error(
      `pack.restingYRule "${pack.restingYRule}" does not match anchor "${pack.anchor}" ` +
      `(expected "${expected}"). center → floor+H/2; pivot → floor.`
    );
  }
}

/**
 * Cell anchor in pack coordinates (mm). Row 0 is toward +Z (the display / hero side).
 * center: cell center, Y = floor + H/2.
 * pivot:  minimum XZ corner of the cell, Y = floor.
 */
export function cellPlacement(pack, index, floor) {
  const { cols, rows, colMm, rowMm, cells } = pack.grid;
  const n = cols * rows;
  if (index < 0 || index >= n) throw new Error(`pack cell index ${index} out of range 0..${n - 1}`);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const gridL = cols * colMm;
  const gridW = rows * rowMm;
  const y = restingY(pack.anchor, floor, pack.itemHeightMm);
  const x0 = -gridL / 2;
  const zHi = gridW / 2;
  if (pack.anchor === 'center') {
    return {
      index, col, row, id: cells[index],
      x: x0 + (col + 0.5) * colMm,
      y,
      z: zHi - (row + 0.5) * rowMm,
    };
  }
  return {
    index, col, row, id: cells[index],
    x: x0 + col * colMm,
    y,
    z: zHi - (row + 1) * rowMm,
  };
}

export function fitReport(job, boardMm = job.carton.thicknessMm) {
  const pack = job.pack;
  assertPackRule(pack);
  const t = boardMm;
  const floor = floorMm(t, pack.floorBoardLayers);
  const H = pack.itemHeightMm;
  const y = restingY(pack.anchor, floor, H);
  const nom = job.carton.nominalOutsideMm;
  const cavityL = nom.l - 2 * t;
  const cavityW = nom.w - 2 * t;
  const cavityH = nom.h - floor;
  const { cols, rows, colMm, rowMm, cells } = pack.grid;
  const packed = cells.length > 0;
  const gridL = packed ? cols * colMm : 0;
  const gridW = packed ? rows * rowMm : 0;
  const rowsOut = [
    { key: 'length', label: 'Dài / length  (L − 2t) − grid', clearance: cavityL - gridL },
    { key: 'width', label: 'Rộng / width   (W − 2t) − grid', clearance: cavityW - gridW },
    {
      key: 'height',
      label: 'Cao / height  (Hcarton − floor) − H',
      clearance: packed ? cavityH - H : cavityH,
    },
  ];
  return {
    t, floor, H, restingY: y,
    anchor: pack.anchor,
    restingYRule: pack.restingYRule,
    cavityL, cavityW, cavityH, gridL, gridW,
    rows: rowsOut,
    fit: rowsOut.every((r) => r.clearance >= -1e-6),
    packedCount: cells.length,
  };
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isRing(pts) {
  return Array.isArray(pts) && pts.length >= 3 && pts.every((q) => (
    Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isFinite(n))
  ));
}

function rootPanel(asm) {
  const children = new Set(asm.creases.map((c) => c.panelB));
  const roots = asm.panels.filter((p) => !children.has(p.id));
  return roots.length === 1 ? roots[0] : null;
}

function checkAssembly(asm, label, errors) {
  if (!asm || typeof asm !== 'object') {
    errors.push(`${label} is missing`);
    return;
  }
  if (typeof asm.id !== 'string' || !asm.id) errors.push(`${label} needs an id`);
  if (!(asm.thicknessMm > 0)) errors.push(`${label} thicknessMm must be > 0`);
  if (!isVec3(asm.flatPositionMm)) errors.push(`${label} flatPositionMm must be [x,y,z]`);
  if (!isVec3(asm.seatMm)) errors.push(`${label} seatMm must be [x,y,z]`);
  if (!isVec3(asm.uprightEulerDeg)) errors.push(`${label} uprightEulerDeg must be [x,y,z] degrees`);
  if (!Array.isArray(asm.orientWindow) || asm.orientWindow.length !== 2) {
    errors.push(`${label} orientWindow must be [t0, t1]`);
  }
  if (!Array.isArray(asm.panels) || asm.panels.length < 1) errors.push(`${label} needs at least one panel`);
  if (!Array.isArray(asm.creases)) errors.push(`${label} creases must be an array`);
  const ids = new Set();
  for (const p of asm.panels || []) {
    if (!p || typeof p.id !== 'string') {
      errors.push(`${label} panel is missing an id`);
      continue;
    }
    if (ids.has(p.id)) errors.push(`${label} duplicate panel id ${p.id}`);
    ids.add(p.id);
    if (!ROLE_ENUM.includes(p.role)) errors.push(`${label} panel ${p.id} role must be face|glue|flap|window`);
    if (!PRINT_ENUM.includes(p.printFace)) errors.push(`${label} panel ${p.id} printFace must be hero|text|kraft|none`);
    const r = p.rectMm;
    if (!r || !(r.w > 0) || !(r.h > 0) || typeof r.x !== 'number' || typeof r.y !== 'number') {
      errors.push(`${label} panel ${p.id} rectMm needs {x,y,w>0,h>0}`);
    }
    if (p.textureRef !== undefined && !TEXTURE_REF.test(p.textureRef)) {
      errors.push(`${label} panel ${p.id} textureRef must be textures/<file>.png|webp|jpg (no base64, no URLs)`);
    }
    if (p.outlineMm !== undefined && !isRing(p.outlineMm)) {
      errors.push(`${label} panel ${p.id} outlineMm must be a polygon of [x,y] points`);
    }
    if (p.holesMm !== undefined) {
      if (!Array.isArray(p.holesMm) || p.holesMm.some((hole) => !isRing(hole))) {
        errors.push(`${label} panel ${p.id} holesMm must be an array of polygons`);
      }
    }
    if (p.uvMm !== undefined) {
      const u = p.uvMm;
      if (!u || typeof u.x !== 'number' || typeof u.y !== 'number' || !(u.w > 0) || !(u.h > 0)) {
        errors.push(`${label} panel ${p.id} uvMm needs {x,y,w>0,h>0}`);
      }
    }
    if (p.stackLayer !== undefined && (typeof p.stackLayer !== 'number' || p.stackLayer < 0)) {
      errors.push(`${label} panel ${p.id} stackLayer must be a number ≥ 0`);
    }
    if (p.hinge !== undefined) {
      errors.push(`${label} panel ${p.id} must not store its own hinge — attach it only as a crease.panelB`);
    }
  }
  const child = new Map();
  for (const c of asm.creases || []) {
    if (!c || typeof c.id !== 'string') {
      errors.push(`${label} crease is missing an id`);
      continue;
    }
    if (!ids.has(c.panelA) || !ids.has(c.panelB)) {
      errors.push(`${label} crease ${c.id} must join two panels in this assembly`);
    }
    if (c.panelA === c.panelB) errors.push(`${label} crease ${c.id} joins a panel to itself`);
    if (child.has(c.panelB)) errors.push(`${label} panel ${c.panelB} has more than one hinge`);
    child.set(c.panelB, c);
    const dir = c.axis && c.axis.direction;
    if (!isVec3(dir) || dir[0] === 0 && dir[1] === 0 && dir[2] === 0) {
      errors.push(`${label} crease ${c.id} axis.direction must be a non-zero vector in panelB local space`);
    }
    if (!isVec3(c.attachMm)) errors.push(`${label} crease ${c.id} attachMm must be [x,y,z] in panelA local space`);
    if (typeof c.foldDeg !== 'number' || c.foldDeg < -180 || c.foldDeg > 180) {
      errors.push(`${label} crease ${c.id} foldDeg must be within -180..180`);
    }
    if (!Array.isArray(c.foldWindow) || c.foldWindow.length !== 2) {
      errors.push(`${label} crease ${c.id} foldWindow must be [t0, t1]`);
    }
  }
  if ((asm.panels || []).length && rootPanel(asm) === null) {
    errors.push(`${label} must have exactly one root panel (a panel that is not crease.panelB)`);
  }
}

export function assertJob(job) {
  const errors = [];
  if (!job || typeof job !== 'object') throw new Error('Job must be an object');
  const meta = job.meta || {};
  if (typeof meta.productCode !== 'string' || !meta.productCode) errors.push('meta.productCode is required');
  if (!Array.isArray(meta.sources) || meta.sources.length < 1 || meta.sources.some((s) => !SOURCE_ENUM.includes(s))) {
    errors.push('meta.sources must list dieline, ProductMaster, and/or estimate');
  }
  checkAssembly(job.carton, 'carton', errors);
  const nom = job.carton && job.carton.nominalOutsideMm;
  if (!nom || !(nom.l > 0) || !(nom.w > 0) || !(nom.h > 0)) {
    errors.push('carton.nominalOutsideMm {l,w,h} is required (outside size in mm, used by FIT)');
  }
  if (job.lid) checkAssembly(job.lid, 'lid', errors);
  const parts = [...(job.inners || []), ...(job.rolls || [])];
  if (job.inners && !Array.isArray(job.inners)) errors.push('inners must be an array');
  if (job.rolls && !Array.isArray(job.rolls)) errors.push('rolls must be an array');
  const asmIds = new Set();
  if (job.carton && job.carton.id) asmIds.add(job.carton.id);
  if (job.lid && job.lid.id) {
    if (asmIds.has(job.lid.id)) errors.push(`duplicate assembly id ${job.lid.id}`);
    asmIds.add(job.lid.id);
  }
  for (const part of parts) {
    checkAssembly(part, part && part.id ? part.id : 'inner', errors);
    if (part && asmIds.has(part.id)) errors.push(`duplicate assembly id ${part.id}`);
    if (part && part.id) asmIds.add(part.id);
  }
  const pack = job.pack;
  if (!pack) errors.push('pack is required');
  else {
    try { assertPackRule(pack); }
    catch (err) { errors.push(err.message); }
    if (pack.eb !== 'vertical' && pack.eb !== 'horizontal') errors.push('pack.eb must be vertical or horizontal');
    if (typeof pack.heroTowardDisplay !== 'boolean') errors.push('pack.heroTowardDisplay must be boolean');
    if (!(pack.itemHeightMm > 0)) errors.push('pack.itemHeightMm (H) must be > 0');
    if (!Number.isInteger(pack.floorBoardLayers) || pack.floorBoardLayers < 0) {
      errors.push('pack.floorBoardLayers must be an integer ≥ 0');
    }
    const g = pack.grid;
    if (!g || !Number.isInteger(g.cols) || g.cols < 1 || !Number.isInteger(g.rows) || g.rows < 1) {
      errors.push('pack.grid cols and rows must be integers ≥ 1');
    } else if (!(g.colMm > 0) || !(g.rowMm > 0)) {
      errors.push('pack.grid colMm and rowMm must be > 0');
    } else if (!Array.isArray(g.cells)) {
      errors.push('pack.grid.cells must be an array of inner/roll ids (or empty for a draft)');
    } else if (g.cells.length !== 0 && g.cells.length !== g.cols * g.rows) {
      errors.push(`pack.grid.cells length ${g.cells.length} must be 0 or cols×rows (${g.cols * g.rows})`);
    } else {
      const partIds = new Set(parts.map((p) => p && p.id));
      for (const id of g.cells) {
        if (!partIds.has(id)) errors.push(`grid cell "${id}" does not match an inner or roll id`);
      }
    }
    if (!Array.isArray(pack.dropWindow) || pack.dropWindow.length !== 2) errors.push('pack.dropWindow must be [t0, t1]');
    if (typeof pack.stagger !== 'number' || pack.stagger < 0) errors.push('pack.stagger must be ≥ 0');
    if (!(pack.dropDuration > 0)) errors.push('pack.dropDuration must be > 0');
    if (pack.eb === 'vertical') {
      for (const part of parts) {
        const root = part && rootPanel(part);
        if (!root || !root.rectMm) continue;
        if (Math.abs(root.rectMm.h - pack.itemHeightMm) > 0.05) {
          errors.push(`${part.id} root rectMm.h (${root.rectMm.h}) must equal pack.itemHeightMm H (${pack.itemHeightMm}) for vertical packing`);
        }
        if (g && Math.abs(root.rectMm.w - g.colMm) > 0.05) {
          errors.push(`${part.id} root rectMm.w (${root.rectMm.w}) must equal pack.grid.colMm (${g.colMm})`);
        }
      }
    }
  }
  if (!Array.isArray(job.steps) || job.steps.length < 1) errors.push('steps must be a non-empty array of {t, label}');
  else {
    for (const s of job.steps) {
      if (!s || typeof s.t !== 'number' || typeof s.label !== 'string') errors.push('each step needs numeric t and string label');
    }
  }
  if (errors.length) {
    const err = new Error(errors.join('\n'));
    err.errors = errors;
    throw err;
  }
  return job;
}
