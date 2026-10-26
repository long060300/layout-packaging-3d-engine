/**
 * Hinged blanks for the QuickPack viewer.
 * A panel is a rectangle unless it sets outlineMm and/or holesMm (dieline cut and openings).
 * UV is the panel rect 1:1 — no separate uvMm. Resting Y stays in pack-rule.js.
 */
import * as THREE_NS from 'three';

const THREE = THREE_NS.MathUtils ? THREE_NS : THREE_NS.default;

const PRINT_COLOR = {
  hero: 0xd7a441,
  text: 0xf3efe6,
  kraft: 0xa98157,
  none: 0x8d7354,
};

function rad(deg) {
  return THREE.MathUtils.degToRad(deg);
}

function smoothstep(t0, t1, t) {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return u * u * (3 - 2 * u);
}

function line(THREE_points, material, kind) {
  const geo = new THREE.BufferGeometry().setFromPoints(THREE_points);
  const ln = new THREE.Line(geo, material);
  if (material.isLineDashedMaterial) ln.computeLineDistances();
  ln.userData.line = kind;
  ln.renderOrder = 2;
  return ln;
}

function makeLineMaterials() {
  return {
    cut: new THREE.LineBasicMaterial({ color: 0x2b4fa1 }),
    crease: new THREE.LineDashedMaterial({ color: 0x1f8a52, dashSize: 4, gapSize: 3 }),
    window: new THREE.LineDashedMaterial({ color: 0xd0157a, dashSize: 2, gapSize: 2 }),
  };
}

function signedArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

/** CCW outline in panel XY so the extruded cap faces +Z (the print). */
function ccwRing(pts) {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts.slice();
}

function shapeFromPanel(panel) {
  const rect = panel.rectMm;
  const outline = panel.outlineMm && panel.outlineMm.length >= 3
    ? ccwRing(panel.outlineMm)
    : [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x + rect.w, rect.y + rect.h],
      [rect.x, rect.y + rect.h],
    ];
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i += 1) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  for (const hole of panel.holesMm || []) {
    const path = new THREE.Path();
    if (hole.circle) {
      const [cx, cy, radius] = hole.circle;
      path.absarc(cx, cy, radius, 0, Math.PI * 2, true);
    } else if (hole.points && hole.points.length >= 3) {
      const ring = signedArea(hole.points) > 0 ? [...hole.points].reverse() : hole.points;
      path.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i += 1) path.lineTo(ring[i][0], ring[i][1]);
      path.closePath();
    }
    shape.holes.push(path);
  }
  return { shape, outline };
}

/**
 * Board in the same frame as BoxGeometry: print on z=0, kraft on z=-1, then mesh.scale.z = caliper.
 * Materials are [print, back, edge] — print is index 0, not the box slot 4.
 */
function boardGeometry(shape, rect) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -1);
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.computeVertexNormals();
  const pos = flat.attributes.position;
  const norm = flat.attributes.normal;
  const faces = pos.count / 3;
  const buckets = { print: [], back: [], edge: [] };
  for (let f = 0; f < faces; f += 1) {
    let nz = 0;
    for (let k = 0; k < 3; k += 1) nz += norm.getZ(f * 3 + k);
    nz /= 3;
    const key = nz > 0.65 ? 'print' : nz < -0.65 ? 'back' : 'edge';
    buckets[key].push(f);
  }
  const order = [...buckets.print, ...buckets.back, ...buckets.edge];
  const np = new Float32Array(order.length * 9);
  const nuv = new Float32Array(order.length * 6);
  let o = 0;
  for (const f of order) {
    for (let k = 0; k < 3; k += 1) {
      const i = f * 3 + k;
      const x = pos.getX(i);
      const y = pos.getY(i);
      np[o * 3] = x;
      np[o * 3 + 1] = y;
      np[o * 3 + 2] = pos.getZ(i);
      nuv[o * 2] = (x - rect.x) / rect.w;
      nuv[o * 2 + 1] = (y - rect.y) / rect.h;
      o += 1;
    }
  }
  flat.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(np, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(nuv, 2));
  out.computeVertexNormals();
  const counts = [buckets.print.length, buckets.back.length, buckets.edge.length];
  let start = 0;
  counts.forEach((n, idx) => {
    if (!n) return;
    out.addGroup(start * 3, n * 3, idx);
    start += n;
  });
  return out;
}

function circleLoop(cx, cy, radius, z, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z));
  }
  return pts;
}

/**
 * Coreless film roll. Axis along local +X (carton length when the pack column is X).
 * idMm 0 is a solid film cylinder — no paper or steel core. A positive idMm is an open tube.
 * The mesh is centered on the assembly origin. thicknessScales stays off so board caliper
 * does not squash the roll.
 */
function buildRoll(asm) {
  const { lengthMm, odMm, idMm } = asm.rollMm;
  const root = new THREE.Group();
  root.name = asm.id;
  const outer = odMm / 2;
  const inner = Math.max(0, idMm) / 2;
  let geo;
  if (inner < 0.05) {
    geo = new THREE.CylinderGeometry(outer, outer, lengthMm, 48, 1, false);
    geo.rotateZ(-Math.PI / 2);
  } else {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    geo = new THREE.ExtrudeGeometry(shape, { depth: lengthMm, bevelEnabled: false, curveSegments: 48 });
    geo.translate(0, 0, -lengthMm / 2);
    geo.rotateY(Math.PI / 2);
  }
  const film = new THREE.MeshStandardMaterial({
    color: 0xc5cdd4,
    roughness: 0.38,
    metalness: 0.02,
  });
  const end = new THREE.MeshStandardMaterial({
    color: 0xe7edf1,
    roughness: 0.5,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, inner < 0.05 ? [film, end, end] : film);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.body = true;
  mesh.userData.panelId = asm.id;
  mesh.userData.role = 'face';
  mesh.userData.printFace = 'none';
  mesh.userData.roll = true;
  root.add(mesh);
  return {
    asm,
    root,
    pivots: [],
    meshes: [mesh],
    lines: [],
    lineMaterials: makeLineMaterials(),
    thickness: asm.thicknessMm,
  };
}

/**
 * @param {object} asm assembly from panels.json
 * @returns built blank. Root quaternion/position are identity until applyPose.
 */
export function buildAssembly(asm) {
  if (asm.rollMm) return buildRoll(asm);
  const panels = new Map(asm.panels.map((p) => [p.id, p]));
  const creaseByChild = new Map();
  for (const crease of asm.creases) {
    if (creaseByChild.has(crease.panelB)) {
      throw new Error(`${asm.id}: panel ${crease.panelB} has two hinges`);
    }
    creaseByChild.set(crease.panelB, crease);
  }
  const roots = asm.panels.filter((p) => !creaseByChild.has(p.id));
  if (roots.length !== 1) {
    throw new Error(`${asm.id}: expected one root panel, found ${roots.length}`);
  }

  const linesMat = makeLineMaterials();
  const pivots = new Map();
  const meshes = [];
  const lines = [];

  function addPanel(panel) {
    const pivot = new THREE.Group();
    pivot.name = panel.id;
    const crease = creaseByChild.get(panel.id) || null;
    pivot.userData.panel = panel;
    pivot.userData.crease = crease;
    if (crease) {
      const dir = new THREE.Vector3(...crease.axis.direction);
      if (dir.lengthSq() < 1e-12) throw new Error(`crease ${crease.id} has a zero axis`);
      dir.normalize();
      pivot.userData.axis = dir;
      pivot.position.set(crease.attachMm[0], crease.attachMm[1], crease.attachMm[2]);
    }
    pivots.set(panel.id, pivot);

    const rect = panel.rectMm;
    const corners = [
      new THREE.Vector3(rect.x, rect.y, 0.4),
      new THREE.Vector3(rect.x + rect.w, rect.y, 0.4),
      new THREE.Vector3(rect.x + rect.w, rect.y + rect.h, 0.4),
      new THREE.Vector3(rect.x, rect.y + rect.h, 0.4),
    ];
    const shaped = (panel.outlineMm && panel.outlineMm.length >= 3)
      || (panel.holesMm && panel.holesMm.length > 0);
    if (panel.role === 'window') {
      const loopGeo = new THREE.BufferGeometry().setFromPoints([...corners, corners[0]]);
      const loop = new THREE.Line(loopGeo, linesMat.window);
      loop.computeLineDistances();
      loop.userData.line = 'window';
      loop.renderOrder = 2;
      pivot.add(loop);
      lines.push(loop);
    } else if (!shaped) {
      const geo = new THREE.BoxGeometry(rect.w, rect.h, 1);
      geo.translate(rect.x + rect.w / 2, rect.y + rect.h / 2, -0.5);
      const printMat = new THREE.MeshStandardMaterial({
        color: PRINT_COLOR[panel.printFace] ?? PRINT_COLOR.none,
        roughness: panel.printFace === 'hero' ? 0.55 : 0.86,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const backMat = new THREE.MeshStandardMaterial({ color: 0xa98157, roughness: 0.95, metalness: 0 });
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8f6b45, roughness: 1, metalness: 0 });
      const mesh = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, printMat, backMat]);
      mesh.scale.z = asm.thicknessMm;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.body = true;
      mesh.userData.panelId = panel.id;
      mesh.userData.role = panel.role;
      mesh.userData.printFace = panel.printFace;
      mesh.userData.textureRef = panel.textureRef || null;
      mesh.userData.thicknessScales = true;
      pivot.add(mesh);
      meshes.push(mesh);
      const cut = line([...corners, corners[0]], linesMat.cut, 'cut');
      pivot.add(cut);
      lines.push(cut);
    } else {
      const { shape, outline } = shapeFromPanel(panel);
      const geo = boardGeometry(shape, rect);
      const printMat = new THREE.MeshStandardMaterial({
        color: PRINT_COLOR[panel.printFace] ?? PRINT_COLOR.none,
        roughness: panel.printFace === 'hero' ? 0.55 : 0.86,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const backMat = new THREE.MeshStandardMaterial({ color: 0xa98157, roughness: 0.95, metalness: 0 });
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8f6b45, roughness: 1, metalness: 0 });
      const mesh = new THREE.Mesh(geo, [printMat, backMat, edgeMat]);
      mesh.scale.z = asm.thicknessMm;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.body = true;
      mesh.userData.panelId = panel.id;
      mesh.userData.role = panel.role;
      mesh.userData.printFace = panel.printFace;
      mesh.userData.textureRef = panel.textureRef || null;
      mesh.userData.thicknessScales = true;
      mesh.userData.printMaterialIndex = 0;
      pivot.add(mesh);
      meshes.push(mesh);
      const cutPts = outline.map((p) => new THREE.Vector3(p[0], p[1], 0.4));
      const cut = line([...cutPts, cutPts[0]], linesMat.cut, 'cut');
      pivot.add(cut);
      lines.push(cut);
      for (const hole of panel.holesMm || []) {
        const loopPts = hole.circle
          ? circleLoop(hole.circle[0], hole.circle[1], hole.circle[2], 0.45)
          : [...hole.points.map((p) => new THREE.Vector3(p[0], p[1], 0.45)), new THREE.Vector3(hole.points[0][0], hole.points[0][1], 0.45)];
        const loop = line(loopPts, linesMat.window, 'window');
        pivot.add(loop);
        lines.push(loop);
      }
    }

    if (crease) {
      const length = crease.lengthMm || Math.max(rect.w, rect.h);
      const dir = pivot.userData.axis;
      const creaseLine = line([
        new THREE.Vector3(0, 0, 0.55),
        new THREE.Vector3(dir.x * length, dir.y * length, dir.z * length + 0.55),
      ], linesMat.crease, 'crease');
      pivot.add(creaseLine);
      lines.push(creaseLine);
    }
    return pivot;
  }

  for (const panel of asm.panels) addPanel(panel);
  for (const panel of asm.panels) {
    const crease = creaseByChild.get(panel.id);
    if (!crease) continue;
    const parent = pivots.get(crease.panelA);
    const child = pivots.get(panel.id);
    if (!parent || !child) throw new Error(`${asm.id}: crease ${crease.id} references a missing panel`);
    parent.add(child);
  }

  const root = pivots.get(roots[0].id);
  return {
    asm,
    root,
    pivots: [...pivots.values()],
    meshes,
    lines,
    lineMaterials: linesMat,
    thickness: asm.thicknessMm,
  };
}

export function applyFold(built, t) {
  for (const pivot of built.pivots) {
    const crease = pivot.userData.crease;
    if (!crease || !pivot.userData.axis) continue;
    const f = smoothstep(crease.foldWindow[0], crease.foldWindow[1], t);
    pivot.quaternion.setFromAxisAngle(pivot.userData.axis, rad(crease.foldDeg) * f);
  }
}

export function setBoardThickness(built, mm) {
  built.thickness = mm;
  for (const mesh of built.meshes) {
    if (mesh.userData.thicknessScales) mesh.scale.z = mm;
  }
}

/** Move the whole blank from the table (print up) to its seat. */
export function applyPose(built, t) {
  const asm = built.asm;
  const o = smoothstep(asm.orientWindow[0], asm.orientWindow[1], t);
  const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const e = asm.uprightEulerDeg;
  const upQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(e[0]), rad(e[1]), rad(e[2])));
  built.root.quaternion.copy(flatQ).slerp(upQ, o);
  const [fx, , fz] = asm.flatPositionMm;
  const [sx, sy, sz] = asm.seatMm;
  const flatY = built.thickness;
  built.root.position.set(
    fx + (sx - fx) * o,
    flatY + (sy - flatY) * o,
    fz + (sz - fz) * o
  );
}

/**
 * Fold asm to t=100, stand it upright, and record the yaw that aims the hero
 * print at +Z plus the post-yaw bounding-box center (for anchor=center).
 * The returned root is parentless and not yet yawed; clones reapply yaw.
 */
export function createPackPrototype(asm, heroTowardDisplay) {
  const built = buildAssembly(asm);
  applyFold(built, 100);
  const e = asm.uprightEulerDeg;
  built.root.quaternion.setFromEuler(new THREE.Euler(rad(e[0]), rad(e[1]), rad(e[2])));
  built.root.position.set(0, 0, 0);
  built.root.updateMatrixWorld(true);

  const spin = new THREE.Group();
  spin.add(built.root);
  let yaw = 0;
  if (heroTowardDisplay) {
    const hero = built.meshes.find((m) => m.userData.printFace === 'hero');
    if (hero) {
      const n = new THREE.Vector3(0, 0, 1).transformDirection(hero.matrixWorld);
      yaw = Math.atan2(n.x, n.z);
    }
  }
  spin.rotation.y = -yaw;
  spin.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  spin.remove(built.root);
  return { built, yaw, center, size };
}

/** Wrap a clone. anchor=center shifts the bbox center onto the wrap origin. */
export function clonePacked(proto, anchor) {
  const wrap = new THREE.Group();
  const spin = new THREE.Group();
  spin.rotation.y = -proto.yaw;
  spin.add(proto.built.root.clone(true));
  if (anchor === 'center') spin.position.copy(proto.center).multiplyScalar(-1);
  wrap.add(spin);
  return wrap;
}

export function worldBox(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}
