import * as THREE from "three";
import Cube from "./cubeSolver.js";
import { FACES, parseMoveToken, expandMove } from "./movesMeta.js";

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

const SCRAMBLE_FACES = ["U", "D", "L", "R", "F", "B"];
const OPPOSITE_FACE = { U: "D", D: "U", L: "R", R: "L", F: "B", B: "F" };

export class MoveEngine {
  constructor(group, cubies) {
    this.group = group;
    this.cubies = cubies;
    this.cube = new Cube();
    this.solverReady = false;
    this.history = [];
    this.busy = false;
    this.stopRequested = false;
    this.onMove = null;
  }

  requestStop() {
    this.stopRequested = true;
  }

  // Runs the (CPU heavy, ~2s) solver table initialization without freezing
  // the first paint: the caller should show a loading state first.
  initSolver() {
    return new Promise((resolve) => {
      setTimeout(() => {
        Cube.initSolver();
        this.solverReady = true;
        resolve();
      }, 30);
    });
  }

  isSolved() {
    return this.cube.isSolved();
  }

  getLayerCubies(axis, layer) {
    return this.cubies.filter((c) => Math.round(c.position[axis]) === layer);
  }

  createPivot() {
    const pivot = new THREE.Group();
    this.group.add(pivot);
    return pivot;
  }

  attachToPivot(pivot, cubieList) {
    for (const cubie of cubieList) pivot.attach(cubie);
  }

  settlePivot(pivot, cubieList) {
    for (const cubie of cubieList) {
      this.group.attach(cubie);
      cubie.position.set(
        Math.round(cubie.position.x),
        Math.round(cubie.position.y),
        Math.round(cubie.position.z)
      );
    }
    this.group.remove(pivot);
  }

  animateAngle(pivot, axis, from, to, duration) {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const angle = from + (to - from) * easeInOutQuad(t);
        pivot.rotation[axis] = angle;
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  // Applies a single quarter-turn token (e.g. "R", "R'") both visually and
  // in the logical cube model, animated over `duration` ms.
  async applyScriptedMove(token, duration = 260) {
    const { face, prime } = parseMoveToken(token);
    const meta = FACES[face];
    const angle = (prime ? -1 : 1) * meta.cwSign * (Math.PI / 2);
    const cubieList = this.getLayerCubies(meta.axis, meta.layer);
    const pivot = this.createPivot();
    this.attachToPivot(pivot, cubieList);
    await this.animateAngle(pivot, meta.axis, 0, angle, duration);
    this.settlePivot(pivot, cubieList);
    this.cube.move(prime ? `${face}'` : face);
    this.history.push(token);
    if (this.onMove) this.onMove(token);
    return token;
  }

  // Runs a full move sequence (tokens may include "2" doubles), sequentially,
  // calling onStep(token, index, total) right before each unit turn animates.
  async runSequence(tokens, { duration = 260, onStep = null } = {}) {
    this.busy = true;
    this.stopRequested = false;
    try {
      let stepIndex = 0;
      const totalUnits = tokens.reduce((n, t) => n + expandMove(t).length, 0);
      for (const token of tokens) {
        if (this.stopRequested) break;
        const units = expandMove(token);
        for (const unit of units) {
          if (this.stopRequested) break;
          if (onStep) onStep({ token, unit, stepIndex, totalUnits });
          await this.applyScriptedMove(unit, duration);
          stepIndex++;
        }
      }
    } finally {
      this.busy = false;
      this.stopRequested = false;
    }
  }

  generateScramble(length = 22) {
    const tokens = [];
    let lastFace = null;
    let secondLastFace = null;
    for (let i = 0; i < length; i++) {
      let face;
      do {
        face = SCRAMBLE_FACES[Math.floor(Math.random() * SCRAMBLE_FACES.length)];
      } while (
        face === lastFace ||
        (face === OPPOSITE_FACE[lastFace] && lastFace === secondLastFace)
      );
      const modRoll = Math.random();
      const mod = modRoll < 0.34 ? "'" : modRoll < 0.67 ? "2" : "";
      tokens.push(`${face}${mod}`);
      secondLastFace = lastFace;
      lastFace = face;
    }
    return tokens;
  }

  async scramble({ duration = 130 } = {}) {
    const tokens = this.generateScramble();
    await this.runSequence(tokens, { duration });
    return tokens;
  }

  solve({ duration = 380, onStep = null } = {}) {
    if (!this.solverReady) throw new Error("El solucionador todavía no está listo");
    if (this.cube.isSolved()) return Promise.resolve([]);
    const solution = this.cube.solve().trim();
    const tokens = solution.length ? solution.split(/\s+/) : [];
    return this.runSequence(tokens, { duration, onStep }).then(() => tokens);
  }

  resetHistory() {
    this.history = [];
  }
}
