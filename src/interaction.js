import * as THREE from "three";
import { FACES, faceFromAxisLayer } from "./movesMeta.js";

const DRAG_THRESHOLD = 6; // px before we commit to a gesture
const ANGLE_PER_PIXEL = (Math.PI / 2) / 90; // ~90px for a full quarter turn
const MAX_DRAG_ANGLE = (Math.PI / 2) * 1.05;
const ORBIT_SPEED = 0.0055;
const ORBIT_FRICTION = 0.94;
const ORBIT_MIN_VELOCITY = 0.00005;

const AXES = ["x", "y", "z"];

function screenPoint(worldPos, camera, rect) {
  const v = worldPos.clone().project(camera);
  return new THREE.Vector2((v.x * 0.5 + 0.5) * rect.width, (1 - (v.y * 0.5 + 0.5)) * rect.height);
}

function worldDirToScreenUnit(worldPos, worldDir, camera, rect) {
  const p1 = screenPoint(worldPos, camera, rect);
  const p2 = screenPoint(worldPos.clone().addScaledVector(worldDir, 0.06), camera, rect);
  return p2.sub(p1).normalize();
}

function dominantAxis(vec) {
  const ax = Math.abs(vec.x);
  const ay = Math.abs(vec.y);
  const az = Math.abs(vec.z);
  if (ax >= ay && ax >= az) return { axis: "x", sign: Math.sign(vec.x) || 1 };
  if (ay >= ax && ay >= az) return { axis: "y", sign: Math.sign(vec.y) || 1 };
  return { axis: "z", sign: Math.sign(vec.z) || 1 };
}

export class CubeInteraction {
  constructor({ canvas, camera, group, engine, raycastTargets, callbacks = {} }) {
    this.canvas = canvas;
    this.camera = camera;
    this.group = group;
    this.engine = engine;
    this.raycastTargets = raycastTargets;
    this.callbacks = callbacks;

    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.mode = "idle";
    this.enabled = true;

    this.orbitVelocity = { x: 0, y: 0 };
    this.orbitInertiaRAF = null;
    this._lastMoveTime = 0;

    this.zoomDistance = camera.position.length();
    this.zoomDir = camera.position.clone().normalize();
    this.minZoom = 4.5;
    this.maxZoom = 11;

    this._bind();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this._cancelInertia();
  }

  _bind() {
    this.canvas.addEventListener("pointerdown", this._onPointerDown.bind(this));
    window.addEventListener("pointermove", this._onPointerMove.bind(this));
    window.addEventListener("pointerup", this._onPointerUp.bind(this));
    window.addEventListener("pointercancel", this._onPointerUp.bind(this));
    this.canvas.addEventListener("wheel", this._onWheel.bind(this), { passive: false });
  }

  _rectNDC(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top) / rect.height) * 2 + 1,
      rect,
    };
  }

  _raycastAt(clientX, clientY) {
    const { x, y } = this._rectNDC(clientX, clientY);
    this.raycaster.setFromCamera({ x, y }, this.camera);
    const hits = this.raycaster.intersectObjects(this.raycastTargets, false);
    return hits.length ? hits[0] : null;
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    if (this.callbacks.onInteractionStart) this.callbacks.onInteractionStart();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      this._beginPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    this._cancelInertia();

    if (this.engine.busy) {
      this.mode = "orbit";
      this._orbitStart(e);
      return;
    }

    const hit = this.engine.busy ? null : this._raycastAt(e.clientX, e.clientY);
    if (hit) {
      this._beginPendingLayer(e, hit);
    } else {
      this.mode = "orbit";
      this._orbitStart(e);
    }
  }

  _orbitStart(e) {
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragLast = { x: e.clientX, y: e.clientY };
    this.orbitVelocity = { x: 0, y: 0 };
    this._lastMoveTime = performance.now();
  }

  _beginPendingLayer(e, hit) {
    this.mode = "pending";
    this.dragStart = { x: e.clientX, y: e.clientY };

    const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const invGroup = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const localNormal = worldNormal.clone().transformDirection(invGroup);
    const { axis: normalAxis, sign: normalSign } = dominantAxis(localNormal);

    this.pending = {
      cubie: hit.object.userData.cubie,
      worldPoint: hit.point.clone(),
      normalAxis,
      normalSign,
    };
  }

  _onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.mode === "pinch") {
      this._updatePinch();
      return;
    }
    if (this.mode === "pending") {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this._commitLayerDrag(dx, dy);
      }
      return;
    }
    if (this.mode === "layer") {
      this._updateLayerDrag(e);
      return;
    }
    if (this.mode === "orbit") {
      this._updateOrbit(e);
    }
  }

  _commitLayerDrag(dx, dy) {
    const { cubie, worldPoint, normalAxis, normalSign } = this.pending;
    const rect = this.canvas.getBoundingClientRect();
    const dragVec = new THREE.Vector2(dx, dy).normalize();

    const candidates = AXES.filter((a) => a !== normalAxis);
    let best = null;
    for (const axis of candidates) {
      const localDir = new THREE.Vector3(
        axis === "x" ? 1 : 0,
        axis === "y" ? 1 : 0,
        axis === "z" ? 1 : 0
      );
      const worldDir = localDir.clone().transformDirection(this.group.matrixWorld);
      const screenDir = worldDirToScreenUnit(worldPoint, worldDir, this.camera, rect);
      const dot = screenDir.dot(dragVec);
      if (!best || Math.abs(dot) > Math.abs(best.dot)) {
        best = { axis, dot, screenDir };
      }
    }

    const dragAxisLocal = new THREE.Vector3(
      best.axis === "x" ? 1 : 0,
      best.axis === "y" ? 1 : 0,
      best.axis === "z" ? 1 : 0
    ).multiplyScalar(Math.sign(best.dot));

    const normalLocal = new THREE.Vector3(
      normalAxis === "x" ? normalSign : 0,
      normalAxis === "y" ? normalSign : 0,
      normalAxis === "z" ? normalSign : 0
    );

    const rotVec = new THREE.Vector3().crossVectors(normalLocal, dragAxisLocal).round();
    const { axis: rotAxis, sign: rotSign } = dominantAxis(rotVec);
    const layerValue = Math.round(cubie.position[rotAxis]);
    const faceKey = faceFromAxisLayer(rotAxis, layerValue);
    const cubieList = this.engine.getLayerCubies(rotAxis, layerValue);
    const pivot = this.engine.createPivot();
    this.engine.attachToPivot(pivot, cubieList);

    this.layer = {
      pivot,
      cubieList,
      rotAxis,
      rotSign,
      faceKey,
      screenDir: best.screenDir,
      angle: 0,
      lastPoint: { x: this.dragStart.x + dx, y: this.dragStart.y + dy },
    };
    this.mode = "layer";
    if (this.callbacks.onGestureStart) this.callbacks.onGestureStart();
  }

  _updateLayerDrag(e) {
    const l = this.layer;
    const deltaX = e.clientX - l.lastPoint.x;
    const deltaY = e.clientY - l.lastPoint.y;
    l.lastPoint = { x: e.clientX, y: e.clientY };
    const projected = l.screenDir.x * deltaX + l.screenDir.y * deltaY;
    l.angle += projected * ANGLE_PER_PIXEL * l.rotSign;
    l.angle = THREE.MathUtils.clamp(l.angle, -MAX_DRAG_ANGLE, MAX_DRAG_ANGLE);
    l.pivot.rotation[l.rotAxis] = l.angle;
  }

  async _finishLayerDrag() {
    const l = this.layer;
    this.layer = null;
    this.mode = "idle";
    const snapUnits = Math.round(l.angle / (Math.PI / 2));
    const target = snapUnits * (Math.PI / 2);
    await this.engine.animateAngle(l.pivot, l.rotAxis, l.angle, target, 140);
    this.engine.settlePivot(l.pivot, l.cubieList);

    if (snapUnits !== 0) {
      const meta = FACES[l.faceKey];
      const prime = Math.sign(target) !== Math.sign(meta.cwSign);
      const token = prime ? `${l.faceKey}'` : l.faceKey;
      this.engine.cube.move(token);
      this.engine.history.push(token);
      if (this.callbacks.onManualMove) this.callbacks.onManualMove(token);
    } else if (this.callbacks.onGestureCancelled) {
      this.callbacks.onGestureCancelled();
    }
  }

  _updateOrbit(e) {
    const dx = e.clientX - this.dragLast.x;
    const dy = e.clientY - this.dragLast.y;
    this.dragLast = { x: e.clientX, y: e.clientY };

    this.group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * ORBIT_SPEED);
    this.group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), dy * ORBIT_SPEED);

    const now = performance.now();
    const dt = Math.max(1, now - this._lastMoveTime);
    this.orbitVelocity = { x: (dx * ORBIT_SPEED * 16) / dt, y: (dy * ORBIT_SPEED * 16) / dt };
    this._lastMoveTime = now;
  }

  _onPointerUp(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.delete(e.pointerId);

    if (this.mode === "pinch") {
      if (this.pointers.size < 2) this.mode = "idle";
      return;
    }
    if (this.mode === "layer") {
      this._finishLayerDrag();
      return;
    }
    if (this.mode === "orbit") {
      this.mode = "idle";
      this._startInertia();
      return;
    }
    this.mode = "idle";
    this.pending = null;
  }

  _startInertia() {
    const speed = Math.hypot(this.orbitVelocity.x, this.orbitVelocity.y);
    if (speed < ORBIT_MIN_VELOCITY) return;
    const step = () => {
      this.group.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.orbitVelocity.x);
      this.group.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), this.orbitVelocity.y);
      this.orbitVelocity.x *= ORBIT_FRICTION;
      this.orbitVelocity.y *= ORBIT_FRICTION;
      const v = Math.hypot(this.orbitVelocity.x, this.orbitVelocity.y);
      if (v > ORBIT_MIN_VELOCITY) {
        this.orbitInertiaRAF = requestAnimationFrame(step);
      } else {
        this.orbitInertiaRAF = null;
      }
    };
    this.orbitInertiaRAF = requestAnimationFrame(step);
  }

  _cancelInertia() {
    if (this.orbitInertiaRAF) {
      cancelAnimationFrame(this.orbitInertiaRAF);
      this.orbitInertiaRAF = null;
    }
  }

  _beginPinch() {
    this.mode = "pinch";
    const pts = [...this.pointers.values()];
    this._pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    this._pinchStartZoom = this.zoomDistance;
  }

  _updatePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ratio = this._pinchStartDist / Math.max(1, dist);
    this.zoomDistance = THREE.MathUtils.clamp(this._pinchStartZoom * ratio, this.minZoom, this.maxZoom);
    this._applyZoom();
  }

  _onWheel(e) {
    e.preventDefault();
    this.zoomDistance = THREE.MathUtils.clamp(
      this.zoomDistance + e.deltaY * 0.0035,
      this.minZoom,
      this.maxZoom
    );
    this._applyZoom();
  }

  _applyZoom() {
    this.camera.position.copy(this.zoomDir).multiplyScalar(this.zoomDistance);
    this.camera.lookAt(0, 0, 0);
  }
}
