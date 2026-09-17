import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// "Ghost Cube" black & blue palette — one distinct shade per logical face
// so the puzzle stays fully solvable while keeping the monochrome-blue look.
export const FACE_COLORS = {
  U: 0xbfe9ff, // top    — ice blue
  D: 0x05070d, // bottom — near black
  F: 0x2f8dff, // front  — electric blue
  B: 0x0d1533, // back   — deep navy
  L: 0x1c3a66, // left   — indigo steel
  R: 0x00e6ff, // right  — cyan
};

const CUBIE_SIZE = 0.94;
const HALF = CUBIE_SIZE / 2;
const STICKER_OFFSET = HALF + 0.015;
const STICKER_SIZE = 0.8;
const STICKER_THICK = 0.045;

// Local-space transform to place a thin sticker box on a given outward face.
const FACE_TRANSFORM = {
  px: { position: [STICKER_OFFSET, 0, 0], rotation: [0, Math.PI / 2, 0] },
  nx: { position: [-STICKER_OFFSET, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  py: { position: [0, STICKER_OFFSET, 0], rotation: [-Math.PI / 2, 0, 0] },
  ny: { position: [0, -STICKER_OFFSET, 0], rotation: [Math.PI / 2, 0, 0] },
  pz: { position: [0, 0, STICKER_OFFSET], rotation: [0, 0, 0] },
  nz: { position: [0, 0, -STICKER_OFFSET], rotation: [0, Math.PI, 0] },
};

// Which outward direction key corresponds to each grid-axis/sign combo.
const AXIS_SIGN_TO_FACEDIR = {
  "x,1": { dir: "px", face: "R" },
  "x,-1": { dir: "nx", face: "L" },
  "y,1": { dir: "py", face: "U" },
  "y,-1": { dir: "ny", face: "D" },
  "z,1": { dir: "pz", face: "F" },
  "z,-1": { dir: "nz", face: "B" },
};

function buildStickerGeometry() {
  return new RoundedBoxGeometry(STICKER_SIZE, STICKER_SIZE, STICKER_THICK, 3, 0.09);
}

function buildBodyGeometry() {
  return new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 3, 0.1);
}

export function createCube3D() {
  const group = new THREE.Group();
  const cubies = [];
  const raycastTargets = [];

  const bodyGeometry = buildBodyGeometry();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x090b13,
    roughness: 0.35,
    metalness: 0.25,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.9,
  });

  const stickerGeometry = buildStickerGeometry();
  const stickerMaterials = {};
  for (const [face, color] of Object.entries(FACE_COLORS)) {
    stickerMaterials[face] = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.32,
      metalness: 0.08,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
      emissive: new THREE.Color(color).multiplyScalar(0.12),
    });
  }

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
          const info = AXIS_SIGN_TO_FACEDIR[`${axis},${sign}`];
          const t = FACE_TRANSFORM[info.dir];
          const sticker = new THREE.Mesh(stickerGeometry, stickerMaterials[info.face]);
          sticker.position.set(...t.position);
          sticker.rotation.set(...t.rotation);
          sticker.userData.cubie = cubie;
          sticker.userData.outwardLocal = new THREE.Vector3(
            axis === "x" ? sign : 0,
            axis === "y" ? sign : 0,
            axis === "z" ? sign : 0
          );
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
