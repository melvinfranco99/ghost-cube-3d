import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// ---------------------------------------------------------------------------
// Ghost Cube geometry
//
// A Ghost Cube turns exactly like a normal 3x3x3 (same layers, same
// permutations) — what makes it a "ghost" is that every piece's visible
// panel sits on a small raised platform that is pushed outward and twisted
// around the face normal by an amount that depends on which of the 9 cells
// of that face the piece occupies. Assembled correctly the platforms form a
// four-armed spiral relief (see reference photos); once scrambled, pieces
// carry their own platform height/twist to the wrong slot, so neighbouring
// panels no longer line up and the whole cube reads as a jagged, spiky
// shape instead of a cube. Because that platform geometry is baked onto
// each cubie at creation time (not recomputed per move), moveEngine.js and
// interaction.js need no changes: they only ever reposition/rotate the
// existing cubie groups.
// ---------------------------------------------------------------------------

const CUBIE_SIZE = 0.94;
const HALF = CUBIE_SIZE / 2;

const RISER_SIZE = 0.8;
const RISER_THICK = 0.055;
const STICKER_SIZE = 0.7;
const STICKER_THICK = 0.032;

const LEVEL_STEP = 0.095; // extra outward push per pinwheel level
const TWIST_STEP = THREE.MathUtils.degToRad(10); // extra in-plane twist per level

const BODY_COLOR = 0x1f5fe0; // ghost-cube blue plastic body/frame
const PANEL_COLOR = 0x0a0a0d; // near-black carbon-fiber panel

const FACE_TRANSFORM = {
  px: { normal: [1, 0, 0], rotation: [0, Math.PI / 2, 0] },
  nx: { normal: [-1, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  py: { normal: [0, 1, 0], rotation: [-Math.PI / 2, 0, 0] },
  ny: { normal: [0, -1, 0], rotation: [Math.PI / 2, 0, 0] },
  pz: { normal: [0, 0, 1], rotation: [0, 0, 0] },
  nz: { normal: [0, 0, -1], rotation: [0, Math.PI, 0] },
};

const AXIS_SIGN_TO_DIR = {
  "x,1": "px",
  "x,-1": "nx",
  "y,1": "py",
  "y,-1": "ny",
  "z,1": "pz",
  "z,-1": "nz",
};

// Four-armed pinwheel: the center cell and one whole arm (a corner + its
// neighbouring edge cell) sit flush (level 0); the other three arms step
// up around the face in a consistent sweep.
function pinwheelLevel(u, v) {
  if (u === 0 && v === 0) return 0;
  if (u === -1 && v === -1) return 0;
  if (u === 0 && v === -1) return 0;
  if (u === 1 && v === -1) return 1;
  if (u === 1 && v === 0) return 1;
  if (u === 1 && v === 1) return 2;
  if (u === 0 && v === 1) return 2;
  return 3; // (-1, 1) and (-1, 0)
}

// In-face (u, v) grid coordinates for a cubie's face on a given axis — the
// two grid coordinates other than the face's own axis, fixed order per axis.
function faceUV(axis, x, y, z) {
  if (axis === "x") return [y, z];
  if (axis === "y") return [z, x];
  return [x, y];
}

function placeOnFace(mesh, dirKey, distance, twist) {
  const t = FACE_TRANSFORM[dirKey];
  mesh.position.set(t.normal[0] * distance, t.normal[1] * distance, t.normal[2] * distance);
  mesh.rotation.set(...t.rotation);
  mesh.rotateZ(twist);
}

// Procedural carbon-fiber-style weave so the panels read as the reference
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
      const alt = ((gx / weave) % 2) === ((gy / weave) % 2);
      ctx.fillStyle = alt ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.3)";
      ctx.fillRect(gx, gy, weave, weave);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildBodyGeometry() {
  return new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 3, 0.09);
}
function buildRiserGeometry() {
  return new RoundedBoxGeometry(RISER_SIZE, RISER_SIZE, RISER_THICK, 2, 0.05);
}
function buildStickerGeometry() {
  return new RoundedBoxGeometry(STICKER_SIZE, STICKER_SIZE, STICKER_THICK, 2, 0.05);
}

export function createCube3D() {
  const group = new THREE.Group();
  const cubies = [];
  const raycastTargets = [];

  const bodyGeometry = buildBodyGeometry();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: BODY_COLOR,
    roughness: 0.4,
    metalness: 0.12,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.0,
  });

  const riserGeometry = buildRiserGeometry();
  const stickerGeometry = buildStickerGeometry();
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

        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.userData.cubie = cubie;
        cubie.add(body);
        raycastTargets.push(body);

        for (const [axis, sign] of [
          ["x", x],
          ["y", y],
          ["z", z],
        ]) {
          if (sign === 0) continue;
          const dir = AXIS_SIGN_TO_DIR[`${axis},${sign}`];
          const [u, v] = faceUV(axis, x, y, z);
          const level = pinwheelLevel(u, v);
          const twist = level * TWIST_STEP;

          const riser = new THREE.Mesh(riserGeometry, bodyMaterial);
          placeOnFace(riser, dir, HALF + RISER_THICK / 2 + level * LEVEL_STEP, twist);
          riser.userData.cubie = cubie;
          cubie.add(riser);
          raycastTargets.push(riser);

          const sticker = new THREE.Mesh(stickerGeometry, panelMaterial);
          placeOnFace(
            sticker,
            dir,
            HALF + RISER_THICK + STICKER_THICK / 2 + level * LEVEL_STEP,
            twist
          );
          sticker.userData.cubie = cubie;
          cubie.add(sticker);
          raycastTargets.push(sticker);
        }

        group.add(cubie);
        cubies.push(cubie);
      }
    }
  }

  return { group, cubies, raycastTargets };
}
