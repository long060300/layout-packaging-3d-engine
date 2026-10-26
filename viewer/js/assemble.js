/**
 * Hinged blanks for the QuickPack viewer.
 * A panel is a rectangle unless it carries outlineMm (dieline contour, optional holes).
 * Contours extrude with the print as its own sheet so a hole stays open and the
 * texture maps that face only. Resting Y stays in pack-rule.js.
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

function bounds2(pts) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) };
}

function makeShape(panel) {
  const shape = new THREE.Shape(panel.outlineMm.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of panel.holesMm || []) {
    shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  }
  return shape;
}

/** Kraft carton, slightly paler kraft hood, duplex inner. Text faces mark an inner. */
function boardColors(asm) {
  if (asm.id === 'lid') return { inside: 0xb8946a, edge: 0x9c7a52 };
  const inner = (asm.panels || []).some((p) => p.printFace === 'text');
  if (inner) return { inside: 0xdcd8cf, edge: 0xcfcac0 };
  return { inside: 0xa98157, edge: 0x8f6b45 };
}

/**
 * @param {object} asm assembly from panels.json
 * @returns built blank. Root quaternion/position are identity until applyPose.
 */
export function buildAssembly(asm) {
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
    const corners = panel.outlineMm
      ? panel.outlineMm.map(([x, y]) => new THREE.Vector3(x, y, 0.4))
      : [
        new THREE.Vector3(rect.x, rect.y, 0.4),
        new THREE.Vector3(rect.x + rect.w, rect.y, 0.4),
        new THREE.Vector3(rect.x + rect.w, rect.y + rect.h, 0.4),
        new THREE.Vector3(rect.x, rect.y + rect.h, 0.4),
      ];
    if (panel.role === 'window' && !panel.outlineMm) {
      const loopGeo = new THREE.BufferGeometry().setFromPoints([...corners, corners[0]]);
      const loop = new THREE.Line(loopGeo, linesMat.window);
      loop.computeLineDistances();
      loop.userData.line = 'window';
      loop.renderOrder = 2;
      pivot.add(loop);
      lines.push(loop);
    } else if (panel.outlineMm) {
      const shape = makeShape(panel);
      const colors = boardColors(asm);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, -1);
      const backMat = new THREE.MeshStandardMaterial({ color: colors.inside, roughness: 0.95, metalness: 0 });
      const edgeMat = new THREE.MeshStandardMaterial({ color: colors.edge, roughness: 1, metalness: 0 });
      const body = new THREE.Mesh(geo, [backMat, edgeMat]);
      body.scale.z = asm.thicknessMm;
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.body = true;
      body.userData.panelId = panel.id;
      body.userData.role = panel.role;
      body.userData.printFace = panel.printFace;
      body.userData.thicknessScales = true;

      const fg = new THREE.ShapeGeometry(shape);
      const uv = panel.uvMm || bounds2(panel.outlineMm);
      const pos = fg.attributes.position;
      const a = new Float32Array(pos.count * 2);
      for (let k = 0; k < pos.count; k += 1) {
        a[2 * k] = (pos.getX(k) - uv.x) / uv.w;
        a[2 * k + 1] = (pos.getY(k) - uv.y) / uv.h;
      }
      fg.setAttribute('uv', new THREE.BufferAttribute(a, 2));
      fg.translate(0, 0, 0.06);
      const printMat = new THREE.MeshStandardMaterial({
        color: PRINT_COLOR[panel.printFace] ?? PRINT_COLOR.none,
        roughness: panel.printFace === 'hero' ? 0.55 : panel.printFace === 'kraft' ? 0.9 : 0.72,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const face = new THREE.Mesh(fg, printMat);
      face.receiveShadow = true;
      face.userData.panelId = panel.id;
      face.userData.role = panel.role;
      face.userData.printFace = panel.printFace;
      face.userData.textureRef = panel.textureRef || null;

      const panelG = new THREE.Group();
      panelG.add(body, face);
      const cut = line([...corners, corners[0]], linesMat.cut, 'cut');
      panelG.add(cut);
      lines.push(cut);
      for (const hole of panel.holesMm || []) {
        const ring = hole.map(([x, y]) => new THREE.Vector3(x, y, 0.45));
        const mark = line([...ring, ring[0]], linesMat.window, 'window');
        panelG.add(mark);
        lines.push(mark);
      }
      pivot.add(panelG);
      pivot.userData.stackLayer = panel.stackLayer || 0;
      meshes.push(body);
    } else {
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
    }

    if (crease) {
      const dir = pivot.userData.axis.clone().normalize();
      const pts = panel.outlineMm
        ? panel.outlineMm.map(([x, y]) => new THREE.Vector3(x, y, 0))
        : [
          new THREE.Vector3(rect.x, rect.y, 0),
          new THREE.Vector3(rect.x + rect.w, rect.y, 0),
          new THREE.Vector3(rect.x + rect.w, rect.y + rect.h, 0),
          new THREE.Vector3(rect.x, rect.y + rect.h, 0),
        ];
      const onHinge = pts.filter((p) => p.clone().addScaledVector(dir, -p.dot(dir)).length() < 1.5);
      const use = onHinge.length >= 2 ? onHinge : pts;
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of use) {
        const t = p.dot(dir);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      if (!(hi > lo)) {
        const length = crease.lengthMm || Math.max(rect.w, rect.h);
        lo = 0;
        hi = length;
      }
      const creaseLine = line([
        new THREE.Vector3(dir.x * lo, dir.y * lo, dir.z * lo + 0.55),
        new THREE.Vector3(dir.x * hi, dir.y * hi, dir.z * hi + 0.55),
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
    const f = crease && pivot.userData.axis
      ? smoothstep(crease.foldWindow[0], crease.foldWindow[1], t)
      : 0;
    if (crease && pivot.userData.axis) {
      const axis = pivot.userData.axis;
      pivot.quaternion.setFromAxisAngle(axis, rad(crease.foldDeg) * f);
    }
    const layer = pivot.userData.stackLayer || 0;
    if (layer) {
      const panelG = pivot.children.find((child) => child.isGroup);
      if (panelG) panelG.position.z = -layer * built.thickness * f;
    }
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
  // Lines sit a fraction off the board. Center on the boards so that offset
  // cannot walk the resting Y, then the full object still has to contain them.
  const boards = bodyBounds(built.root);
  const center = boards.getCenter(new THREE.Vector3());
  const size = boards.getSize(new THREE.Vector3());
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

/** Board meshes only, so a crease mark cannot move the pack center. */
export function bodyBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.userData || !obj.userData.body || !obj.geometry) return;
    obj.geometry.computeBoundingBox();
    box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
    any = true;
  });
  if (!any) box.setFromObject(root);
  return box;
}

export function worldBox(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}
