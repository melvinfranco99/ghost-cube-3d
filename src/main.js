import "./style.css";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createCube3D } from "./cube3d.js";
import { MoveEngine } from "./moveEngine.js";
import { CubeInteraction } from "./interaction.js";
import { describeMove, parseMoveToken } from "./movesMeta.js";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const canvas = document.getElementById("cube-canvas");
const sceneContainer = document.getElementById("scene-container");
const loadingScreen = document.getElementById("loading-screen");
const loadingText = document.getElementById("loading-text");
const solverStatusEl = document.getElementById("solver-status");
const statusBadge = document.getElementById("status-badge");
const hintText = document.getElementById("hint-text");
const statMoves = document.getElementById("stat-moves");
const statTimer = document.getElementById("stat-timer");
const logEmpty = document.getElementById("log-empty");
const moveLog = document.getElementById("move-log");
const btnScramble = document.getElementById("btn-scramble");
const btnSolve = document.getElementById("btn-solve");
const btnReset = document.getElementById("btn-reset");
const btnStop = document.getElementById("btn-stop");
const togglePanelBtn = document.getElementById("toggle-panel");
const sidePanel = document.getElementById("side-panel");

// ---------------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.05);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
const CAMERA_START = new THREE.Vector3(4.4, 3.6, 5.6);
camera.position.copy(CAMERA_START);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;

// Lighting: cool key light + blue rim lights to sell the "ghost" look.
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(5, 7, 4);
scene.add(keyLight);

const rimBlue = new THREE.PointLight(0x2f8dff, 18, 20, 2);
rimBlue.position.set(-5, -3, -4);
scene.add(rimBlue);

const rimCyan = new THREE.PointLight(0x00e5ff, 10, 20, 2);
rimCyan.position.set(4, -4, 3);
scene.add(rimCyan);

scene.add(new THREE.AmbientLight(0x1a2340, 0.6));

// A faint ground disc to anchor the cube visually.
const groundGeo = new THREE.CircleGeometry(6, 64);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x070a14,
  roughness: 0.9,
  metalness: 0.1,
  transparent: true,
  opacity: 0.6,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -2.15;
scene.add(ground);

// ---------------------------------------------------------------------------
// Cube + engine + interaction
// ---------------------------------------------------------------------------
let cube3D = createCube3D();
scene.add(cube3D.group);

let engine = new MoveEngine(cube3D.group, cube3D.cubies);
engine.onMove = (token) => handleMoveApplied(token, false);

let interaction = new CubeInteraction({
  canvas,
  camera,
  group: cube3D.group,
  engine,
  raycastTargets: cube3D.raycastTargets,
  callbacks: {
    onManualMove: (token) => handleMoveApplied(token, true),
    onGestureStart: hideHintForever,
    onInteractionStart: () => (lastInteractionAt = performance.now()),
  },
});

// slight initial tilt so all three axes read as 3D immediately
cube3D.group.rotation.set(-0.35, 0.55, 0);

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------
function resize() {
  const w = sceneContainer.clientWidth;
  const h = sceneContainer.clientHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Idle auto-rotate showcase
// ---------------------------------------------------------------------------
let lastInteractionAt = performance.now();
const IDLE_DELAY = 3200;
const IDLE_SPEED = 0.12; // rad/s

let lastFrame = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const idleFor = now - lastInteractionAt;
  const isIdle =
    interaction.mode === "idle" &&
    !interaction.orbitInertiaRAF &&
    idleFor > IDLE_DELAY &&
    !engine.busy;
  if (isIdle) {
    cube3D.group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), IDLE_SPEED * dt);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// Hint fade-out
// ---------------------------------------------------------------------------
let hintHidden = false;
function hideHintForever() {
  if (hintHidden) return;
  hintHidden = true;
  hintText.style.opacity = "0";
  setTimeout(() => (hintText.style.display = "none"), 450);
}
setTimeout(hideHintForever, 9000);

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
let timerInterval = null;
let elapsedMs = 0;
let timerStartedAt = 0;

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  if (timerInterval) return;
  timerStartedAt = performance.now() - elapsedMs;
  timerInterval = setInterval(() => {
    elapsedMs = performance.now() - timerStartedAt;
    statTimer.textContent = formatTime(elapsedMs);
  }, 250);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function resetTimer() {
  stopTimer();
  elapsedMs = 0;
  statTimer.textContent = "00:00";
}

// ---------------------------------------------------------------------------
// Move counter + solved badge + shared move handler
// ---------------------------------------------------------------------------
let moveCount = 0;

function setSolvedBadge(solved) {
  statusBadge.textContent = solved ? "Resuelto" : "Mezclado";
  statusBadge.classList.toggle("solved", solved);
}

function handleMoveApplied(token, isManual) {
  moveCount++;
  statMoves.textContent = String(moveCount);

  const solved = engine.isSolved();
  setSolvedBadge(solved);

  if (isManual) {
    hideHintForever();
    if (!solved) startTimer();
    else stopTimer();
  }
}

// ---------------------------------------------------------------------------
// Solver init (heavy, ~1-3s) — show loading screen while it runs, but the
// cube itself is already rendered and interactive underneath.
// ---------------------------------------------------------------------------
engine.initSolver().then(() => {
  solverStatusEl.textContent = "Solucionador listo ✓";
  btnSolve.disabled = false;
  loadingScreen.classList.add("hidden");
});

// ---------------------------------------------------------------------------
// UI: move log panel
// ---------------------------------------------------------------------------
function clearLog() {
  moveLog.innerHTML = "";
  logEmpty.style.display = "";
}

function buildLogFromTokens(tokens) {
  moveLog.innerHTML = "";
  logEmpty.style.display = tokens.length ? "none" : "";
  tokens.forEach((token, i) => {
    const li = document.createElement("li");
    li.dataset.index = String(i);
    li.style.animationDelay = `${Math.min(i, 20) * 15}ms`;
    li.innerHTML = `
      <span class="move-index">${i + 1}</span>
      <span class="move-tag">${token}</span>
      <span class="move-desc">${describeMove(token)}</span>
    `;
    moveLog.appendChild(li);
  });
  moveLog.scrollTop = 0;
}

function setLogStepActive(index) {
  const items = moveLog.children;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", i === index);
    items[i].classList.toggle("done", i < index);
  }
  if (items[index]) {
    items[index].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ---------------------------------------------------------------------------
// Busy-state UI (disables controls while cube animates a scramble/solve)
// ---------------------------------------------------------------------------
function setBusyUI(busy) {
  btnScramble.disabled = busy;
  btnSolve.disabled = busy || !engine.solverReady;
  btnReset.disabled = busy;
  btnStop.hidden = !busy;
}

// ---------------------------------------------------------------------------
// Button wiring
// ---------------------------------------------------------------------------
btnScramble.addEventListener("click", async () => {
  hideHintForever();
  setBusyUI(true);
  clearLog();
  resetTimer();
  moveCount = 0;
  statMoves.textContent = "0";
  try {
    await engine.scramble();
  } finally {
    setSolvedBadge(engine.isSolved());
    setBusyUI(false);
  }
});

btnSolve.addEventListener("click", async () => {
  if (!engine.solverReady || engine.busy) return;
  if (engine.isSolved()) return;

  setBusyUI(true);
  stopTimer();

  const solution = engine.cube.solve().trim();
  const tokens = solution.length ? solution.split(/\s+/) : [];
  buildLogFromTokens(tokens);

  let lastTokenIndex = -1;
  try {
    await engine.runSequence(tokens, {
      duration: 380,
      onStep: ({ token }) => {
        const tokenIndex = tokens.indexOf(token, lastTokenIndex);
        if (tokenIndex !== lastTokenIndex) {
          lastTokenIndex = tokenIndex;
          setLogStepActive(tokenIndex);
        }
      },
    });
    setLogStepActive(tokens.length); // mark all as done
  } finally {
    setSolvedBadge(engine.isSolved());
    setBusyUI(false);
  }
});

btnStop.addEventListener("click", () => {
  engine.requestStop?.();
});

btnReset.addEventListener("click", () => {
  rebuildCube();
});

togglePanelBtn.addEventListener("click", () => {
  const collapsed = sidePanel.classList.toggle("collapsed");
  togglePanelBtn.setAttribute("aria-expanded", String(!collapsed));
});

if (window.matchMedia("(max-width: 860px)").matches) {
  sidePanel.classList.add("collapsed");
  togglePanelBtn.setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------------------
// Full reset: rebuild a fresh solved cube (avoids any float drift over a
// long session) while keeping the already-initialized solver tables.
// ---------------------------------------------------------------------------
function disposeCube3D(c3d) {
  const seenGeo = new Set();
  const seenMat = new Set();
  c3d.group.traverse((obj) => {
    if (obj.geometry && !seenGeo.has(obj.geometry)) {
      seenGeo.add(obj.geometry);
      obj.geometry.dispose();
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!seenMat.has(m)) {
          seenMat.add(m);
          m.dispose();
        }
      }
    }
  });
  scene.remove(c3d.group);
}

function rebuildCube() {
  const wasSolverReady = engine.solverReady;

  disposeCube3D(cube3D);
  cube3D = createCube3D();
  cube3D.group.rotation.set(-0.35, 0.55, 0);
  scene.add(cube3D.group);

  engine = new MoveEngine(cube3D.group, cube3D.cubies);
  engine.solverReady = wasSolverReady;
  engine.onMove = (token) => handleMoveApplied(token, false);

  interaction = new CubeInteraction({
    canvas,
    camera,
    group: cube3D.group,
    engine,
    raycastTargets: cube3D.raycastTargets,
    callbacks: {
      onManualMove: (token) => handleMoveApplied(token, true),
      onGestureStart: hideHintForever,
    },
  });
  const origDown = interaction._onPointerDown.bind(interaction);
  interaction._onPointerDown = (e) => {
    lastInteractionAt = performance.now();
    origDown(e);
  };

  camera.position.copy(CAMERA_START);
  camera.lookAt(0, 0, 0);
  interaction.zoomDistance = camera.position.length();
  interaction.zoomDir = camera.position.clone().normalize();

  moveCount = 0;
  statMoves.textContent = "0";
  resetTimer();
  clearLog();
  setSolvedBadge(true);
  setBusyUI(false);
}
