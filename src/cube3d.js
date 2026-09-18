import * as THREE from "three";

// ---------------------------------------------------------------------------
// Ghost Cube geometry
//
// A real Ghost Cube turns exactly like a normal 3x3x3 (same layers, same
// permutations) but its 26 pieces are NOT simple cubes: each of the 4
// boundary planes per axis (the two outer faces and the two internal layer
// splits) is a flat plane tilted by its own amount instead of a plain
// axis-aligned plane — as if every layer had been frozen mid-turn at a
// slightly different angle. Every piece is the solid bounded by 6 such
// tilted planes (2 per axis), so its faces are irregular quadrilaterals,
// not squares.
//
// Because a boundary plane is literally shared, continuous geometry between
// the two layers it separates, pieces that are correctly placed AND
// correctly oriented butt up against their neighbours with no seam at all —
// the whole assembly reads as a perfect cube. A piece carries its own
// tilted faces wherever it goes, though: once scrambled into the wrong slot
// or orientation, its faces are tilted the "wrong way" relative to its new
// neighbours, so the surface stops lining up and the cube reads as an
// irregular, jagged solid — exactly the reference photos' look.
//
// This geometry is baked per piece once, at creation time; moveEngine.js and
// interaction.js don't need to know about any of it — they only ever
// reposition/rotate the resulting cubie groups, exactly as for a normal cube.
// ---------------------------------------------------------------------------

const GAP_SCALE = 0.93; // shrink each piece toward its own center for visible seams
const PANEL_INSET = 0.72; // sticker size relative to its full facet
const PANEL_LIFT = 0.014; // sticker sits just above the plastic facet

// The 4 boundary planes per axis, at nominal positions -1.5, -0.5, 0.5, 1.5
// (outer, inner, inner, outer). Each is tilted by (t, s) against the other
// two axes' coordinates — e.g. for an X boundary, x = NOMINAL + t*y + s*z.
// Every axis reuses this same table (with its own cyclic argument order),
// so the four "arms" of the puzzle twist in a consistent, distinguishable way.
const NOMINAL = [-1.5, -0.5, 0.5, 1.5];
const BOUNDARY_TILT = [
  { t: 0.09, s: 0.03 },
  { t: -0.06, s: 0.08 },
  { t: 0.06, s: -0.08 },
  { t: -0.09, s: -0.03 },
];

const BODY_COLOR = 0x1f5fe0; // ghost-cube blue plastic body/frame
const PANEL_COLOR = 0x0a0a0d; // near-black carbon-fiber sticker

function det3(a1, b1, c1, a2, b2, c2, a3, b3, c3) {
  return a1 * (b2 * c3 - c2 * b3) - b1 * (a2 * c3 - c2 * a3) + c1 * (a2 * b3 - b2 * a3);
}

// Solves the 3x3 linear system given by three plane rows [a, b, c, d] each
// meaning a*x + b*y + c*z = d, i.e. finds the point where 3 planes meet.
function intersectPlanes(r1, r2, r3) {
  const [a1, b1, c1, d1] = r1;
  const [a2, b2, c2, d2] = r2;
  const [a3, b3, c3, d3] = r3;
  const D = det3(a1, b1, c1, a2, b2, c2, a3, b3, c3);
  const Dx = det3(d1, b1, c1, d2, b2, c2, d3, b3, c3);
  const Dy = det3(a1, d1, c1, a2, d2, c2, a3, d3, c3);
  const Dz = det3(a1, b1, d1, a2, b2, d2, a3, b3, d3);
  return new THREE.Vector3(Dx / D, Dy / D, Dz / D);
}

// x = NOMINAL[k] + t*y + s*z  ->  1*x - t*y - s*z = NOMINAL[k]
function xRow(k) {
  const { t, s } = BOUNDARY_TILT[k];
  return [1, -t, -s, NOMINAL[k]];
}
// y = NOMINAL[k] + t*z + s*x
function yRow(k) {
  const { t, s } = BOUNDARY_TILT[k];
  return [-s, 1, -t, NOMINAL[k]];
}
// z = NOMINAL[k] + t*x + s*y
function zRow(k) {
  const { t, s } = BOUNDARY_TILT[k];
  return [-t, -s, 1, NOMINAL[k]];
}

// The 8 corners of the solid bounded by the piece's 6 tilted boundary
// planes, expressed in the cubie's own local space (i.e. already shifted
// back by its grid position), keyed "abc" with a/b/c = 0 (low side) or 1
// (high side) along x/y/z respectively.
function pieceCorners(ix, iy, iz) {
  const kx = [ix + 1, ix + 2];
  const ky = [iy + 1, iy + 2];
  const kz = [iz + 1, iz + 2];
  const corners = {};
  for (const a of [0, 1]) {
    for (const b of [0, 1]) {
      for (const c of [0, 1]) {
        const p = intersectPlanes(xRow(kx[a]), yRow(ky[b]), zRow(kz[c]));
        p.sub(new THREE.Vector3(ix, iy, iz));
        corners[`${a}${b}${c}`] = p;
      }
    }
  }
  return corners;
}

// Winds 4 (assumed coplanar) points so the face normal points away from
// `centroid`, then appends the two triangles to positions/uvs.
function pushOutwardQuad(positions, uvs, p0, p1, p2, p3, centroid) {
  const normal = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
  const faceCenter = new THREE.Vector3().add(p0).add(p1).add(p2).add(p3).multiplyScalar(0.25);
  const outward = new THREE.Vector3().subVectors(faceCenter, centroid);
  const order = normal.dot(outward) < 0 ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
  const [q0, q1, q2, q3] = order;
  positions.push(
    q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, q2.x, q2.y, q2.z,
    q0.x, q0.y, q0.z, q2.x, q2.y, q2.z, q3.x, q3.y, q3.z
  );
  uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  return { order, faceCenter, normal: normal.normalize() };
}

const FACE_DEFS = [
  { axis: "x", side: "lo", pts: ["000", "010", "011", "001"] },
  { axis: "x", side: "hi", pts: ["100", "101", "111", "110"] },
  { axis: "y", side: "lo", pts: ["000", "001", "101", "100"] },
  { axis: "y", side: "hi", pts: ["010", "110", "111", "011"] },
  { axis: "z", side: "lo", pts: ["000", "100", "110", "010"] },
  { axis: "z", side: "hi", pts: ["001", "011", "111", "101"] },
];

function buildPieceGeometry(ix, iy, iz) {
  const raw = pieceCorners(ix, iy, iz);
  const keys = Object.keys(raw);
  const centroid = new THREE.Vector3();
  for (const k of keys) centroid.add(raw[k]);
  centroid.multiplyScalar(1 / keys.length);

  const shrunk = {};
  for (const k of keys) {
    shrunk[k] = raw[k].clone().sub(centroid).multiplyScalar(GAP_SCALE).add(centroid);
  }

  const positions = [];
  const uvs = [];
  const groups = [];

  const grid = { x: ix, y: iy, z: iz };
  for (const def of FACE_DEFS) {
    const exterior = grid[def.axis] === (def.side === "lo" ? -1 : 1);
    const pts = def.pts.map((k) => shrunk[k]);
    const bodyStart = positions.length / 3;
    const { faceCenter, normal } = pushOutwardQuad(positions, uvs, pts[0], pts[1], pts[2], pts[3], centroid);
    groups.push({ start: bodyStart, count: 6, materialIndex: 0 });

    if (exterior) {
      const inset = pts.map((p) =>
        p.clone().sub(faceCenter).multiplyScalar(PANEL_INSET).add(faceCenter).addScaledVector(normal, PANEL_LIFT)
      );
      const panelStart = positions.length / 3;
      pushOutwardQuad(positions, uvs, inset[0], inset[1], inset[2], inset[3], centroid);
      groups.push({ start: panelStart, count: 6, materialIndex: 1 });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeVertexNormals();
  return geometry;
}

// Procedural carbon-fiber-style weave so the stickers read as the reference
// photos' material instead of flat plastic.
function buildCarbonTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0d";
  ctx.fillRect(0, 0, size, size);
  const weave = 8;
  for (let gy = 0; gy < size; gy += weave) {
    for (let gx = 0; gx < size; gx += weave) {
      const alt = (gx / weave) % 2 === (gy / weave) % 2;
      ctx.fillStyle = alt ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.3)";
      ctx.fillRect(gx, gy, weave, weave);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCube3D() {
  const group = new THREE.Group();
  const cubies = [];
  const raycastTargets = [];

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: BODY_COLOR,
    roughness: 0.4,
    metalness: 0.12,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.0,
  });
  const panelMaterial = new THREE.MeshPhysicalMaterial({
    color: PANEL_COLOR,
    map: buildCarbonTexture(),
    roughness: 0.5,
    metalness: 0.15,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue; // hidden core, skip

        const cubie = new THREE.Group();
        cubie.position.set(x, y, z);
        cubie.userData.gridPos = new THREE.Vector3(x, y, z);

        const geometry = buildPieceGeometry(x, y, z);
        const mesh = new THREE.Mesh(geometry, [bodyMaterial, panelMaterial]);
        mesh.userData.cubie = cubie;
        cubie.add(mesh);
        raycastTargets.push(mesh);

        group.add(cubie);
        cubies.push(cubie);
      }
    }
  }

  return { group, cubies, raycastTargets };
}
