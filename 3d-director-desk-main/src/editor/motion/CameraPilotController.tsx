import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import {
  Euler,
  MathUtils,
  PerspectiveCamera,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import type { CameraMotionSnapshot } from "../schema/cameraMotion";
import {
  DEFAULT_VIEWPORT_ROTATE_SENSITIVITY,
  DEFAULT_VIEWPORT_ZOOM_SENSITIVITY,
  normalizeViewportSensitivity,
} from "../schema/viewportSensitivity";
import { useDirectorStore } from "../store/directorStore";
import { getPilotMovementIntent, isEditablePilotEventTarget, isPilotMovementCode } from "./pilotControls";
import { isPointerLockedTo, requestPointerLockSafely } from "./pointerLock";

const PILOT_MOVE_SPEED = 4;
const PILOT_ORBIT_SPEED = 1.15;
const PILOT_MOUSE_SENSITIVITY = 0.0022;
const PILOT_MIN_FOV = 10;
const PILOT_MAX_FOV = 120;
const PILOT_WHEEL_FOV_SENSITIVITY = 0.006;
const PILOT_WHEEL_MAX_FOV_STEP = 0.6;
const PILOT_SNAPSHOT_INTERVAL_MS = 80;

export function getPilotMouseSensitivity(rotateSensitivity = DEFAULT_VIEWPORT_ROTATE_SENSITIVITY) {
  const normalizedSensitivity = normalizeViewportSensitivity(
    rotateSensitivity,
    DEFAULT_VIEWPORT_ROTATE_SENSITIVITY
  );
  return PILOT_MOUSE_SENSITIVITY * (normalizedSensitivity / DEFAULT_VIEWPORT_ROTATE_SENSITIVITY);
}

export function getPilotFovAfterWheel(
  currentFov: number,
  deltaY: number,
  zoomSensitivity = DEFAULT_VIEWPORT_ZOOM_SENSITIVITY
) {
  const normalizedSensitivity = normalizeViewportSensitivity(
    zoomSensitivity,
    DEFAULT_VIEWPORT_ZOOM_SENSITIVITY
  );
  const sensitivityScale = normalizedSensitivity / DEFAULT_VIEWPORT_ZOOM_SENSITIVITY;
  const step = MathUtils.clamp(
    (Number.isFinite(deltaY) ? deltaY : 0) * PILOT_WHEEL_FOV_SENSITIVITY * sensitivityScale,
    -PILOT_WHEEL_MAX_FOV_STEP * sensitivityScale,
    PILOT_WHEEL_MAX_FOV_STEP * sensitivityScale
  );
  return MathUtils.clamp(currentFov + step, PILOT_MIN_FOV, PILOT_MAX_FOV);
}

function snapshotTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

function findDirectorObjectRoot(object: Object3D | null) {
  let current = object;
  while (current) {
    if (typeof current.userData?.directorObjectId === "string") return current;
    current = current.parent;
  }
  return null;
}

function findDirectorObjectById(scene: Object3D, objectId: string) {
  let result: Object3D | null = null;
  scene.traverse((object) => {
    if (!result && object.userData?.directorObjectId === objectId) result = object;
  });
  return result;
}

function getDirectorObjectTarget(object: Object3D, output: Vector3) {
  object.getWorldPosition(output);
  const offset = object.userData?.directorFocusOffset;
  if (Array.isArray(offset) && offset.length === 3) {
    const worldOffset = new Vector3(Number(offset[0]) || 0, Number(offset[1]) || 0, Number(offset[2]) || 0);
    object.localToWorld(worldOffset);
    output.copy(worldOffset);
  }
  return output;
}

export function CameraPilotController({
  active,
  onExit,
  onRecord,
  onSnapshotCommit,
  onToggleActionPlayback,
  snapshotRef,
}: {
  active: boolean;
  onExit: () => void;
  onRecord: (snapshot: CameraMotionSnapshot) => void;
  onSnapshotCommit: (snapshot: CameraMotionSnapshot) => void;
  onToggleActionPlayback: () => void;
  snapshotRef: MutableRefObject<CameraMotionSnapshot>;
}) {
  const { camera, gl, scene } = useThree();
  const pressedCodesRef = useRef(new Set<string>());
  const orientationRef = useRef(new Euler(0, 0, 0, "YXZ"));
  const pendingLockedMouseRef = useRef({ x: 0, y: 0 });
  const focusDistanceRef = useRef(6);
  const lastSnapshotAtRef = useRef(0);
  const raycasterRef = useRef(new Raycaster());
  const screenCenterRef = useRef(new Vector2(0, 0));
  const hoveredTargetId = useDirectorStore((state) => state.cameraPilotHoveredTargetId);
  const lockedTargetId = useDirectorStore((state) => state.cameraPilotLockedTargetId);
  const followTarget = useDirectorStore((state) => state.cameraPilotFollowTarget);
  const viewportRotateSensitivity = useDirectorStore((state) => state.viewportRotateSensitivity);
  const viewportZoomSensitivity = useDirectorStore((state) => state.viewportZoomSensitivity);
  const setHoveredTarget = useDirectorStore((state) => state.setCameraPilotHoveredTarget);
  const setLockedTarget = useDirectorStore((state) => state.setCameraPilotLockedTarget);
  const hoveredTargetIdRef = useRef(hoveredTargetId);
  const lockedTargetIdRef = useRef(lockedTargetId);
  const lastLockedTargetPositionRef = useRef<Vector3 | null>(null);
  const onExitRef = useRef(onExit);
  const onRecordRef = useRef(onRecord);
  const onSnapshotCommitRef = useRef(onSnapshotCommit);
  const onToggleActionPlaybackRef = useRef(onToggleActionPlayback);
  const hadPointerLockRef = useRef(false);
  const pilotMouseSensitivity = getPilotMouseSensitivity(viewportRotateSensitivity);

  useEffect(() => {
    hoveredTargetIdRef.current = hoveredTargetId;
  }, [hoveredTargetId]);

  useEffect(() => {
    lockedTargetIdRef.current = lockedTargetId;
    lastLockedTargetPositionRef.current = null;
  }, [lockedTargetId]);

  useEffect(() => {
    onExitRef.current = onExit;
    onRecordRef.current = onRecord;
    onSnapshotCommitRef.current = onSnapshotCommit;
    onToggleActionPlaybackRef.current = onToggleActionPlayback;
  }, [onExit, onRecord, onSnapshotCommit, onToggleActionPlayback]);

  useEffect(() => {
    if (!active) {
      pressedCodesRef.current.clear();
      return;
    }

    const pilotCamera = camera as PerspectiveCamera;
    pilotCamera.position.set(...snapshotRef.current.position);
    pilotCamera.fov = snapshotRef.current.fov;
    pilotCamera.lookAt(...snapshotRef.current.target);
    pilotCamera.updateProjectionMatrix();
    pilotCamera.updateMatrixWorld();
    orientationRef.current.setFromQuaternion(pilotCamera.quaternion, "YXZ");
    focusDistanceRef.current = Math.max(
      0.5,
      new Vector3(...snapshotRef.current.position).distanceTo(new Vector3(...snapshotRef.current.target))
    );

    const canvas = gl.domElement;
    const canUseCanvasEvents = typeof HTMLElement !== "undefined" && canvas instanceof HTMLElement;
    hadPointerLockRef.current = canUseCanvasEvents && isPointerLockedTo(canvas);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditablePilotEventTarget(event.target)) return;

      if (isPilotMovementCode(event.code)) {
        event.preventDefault();
        pressedCodesRef.current.add(event.code);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) onToggleActionPlaybackRef.current();
        return;
      }

      if (event.repeat) return;
      if (event.code === "KeyF") {
        event.preventDefault();
        const currentLocked = lockedTargetIdRef.current;
        const nextLocked = currentLocked ? null : hoveredTargetIdRef.current;
        lockedTargetIdRef.current = nextLocked;
        setLockedTarget(nextLocked);
        return;
      }

      if (event.code === "Enter") {
        event.preventDefault();
        onRecordRef.current(snapshotRef.current);
        return;
      }

      if (event.code === "Escape") {
        event.preventDefault();
        onExitRef.current();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      pressedCodesRef.current.delete(event.code);
    }

    function handleMouseMove(event: MouseEvent) {
      if (!canUseCanvasEvents || !isPointerLockedTo(canvas)) return;
      if (lockedTargetIdRef.current) {
        pendingLockedMouseRef.current.x += event.movementX;
        pendingLockedMouseRef.current.y += event.movementY;
        return;
      }

      orientationRef.current.y -= event.movementX * pilotMouseSensitivity;
      orientationRef.current.x = MathUtils.clamp(
        orientationRef.current.x - event.movementY * pilotMouseSensitivity,
        -Math.PI / 2 + 0.025,
        Math.PI / 2 - 0.025
      );
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      pilotCamera.fov = getPilotFovAfterWheel(pilotCamera.fov, event.deltaY, viewportZoomSensitivity);
      pilotCamera.updateProjectionMatrix();
    }

    function requestPointerLock() {
      if (!canUseCanvasEvents || isPointerLockedTo(canvas)) return;
      void requestPointerLockSafely(canvas);
    }

    function handlePointerLockChange() {
      if (!canUseCanvasEvents) return;
      if (isPointerLockedTo(canvas)) {
        hadPointerLockRef.current = true;
        return;
      }

      if (hadPointerLockRef.current) {
        hadPointerLockRef.current = false;
        onExitRef.current();
      }
    }

    function clearPressedCodes() {
      pressedCodesRef.current.clear();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", clearPressedCodes);
    window.addEventListener("mousemove", handleMouseMove);
    if (typeof document !== "undefined") {
      document.addEventListener("pointerlockchange", handlePointerLockChange);
    }
    if (canUseCanvasEvents) {
      canvas.addEventListener("click", requestPointerLock);
      canvas.addEventListener("wheel", handleWheel, { passive: false });
    }

    return () => {
      pressedCodesRef.current.clear();
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", clearPressedCodes);
      window.removeEventListener("mousemove", handleMouseMove);
      if (typeof document !== "undefined") {
        document.removeEventListener("pointerlockchange", handlePointerLockChange);
      }
      if (canUseCanvasEvents) {
        canvas.removeEventListener("click", requestPointerLock);
        canvas.removeEventListener("wheel", handleWheel);
      }
    };
  }, [
    active,
    camera,
    gl.domElement,
    pilotMouseSensitivity,
    setLockedTarget,
    snapshotRef,
    viewportZoomSensitivity,
  ]);

  useFrame((_state, delta) => {
    if (!active) return;
    const pilotCamera = camera as PerspectiveCamera;
    const intent = getPilotMovementIntent(pressedCodesRef.current);
    const lockedId = lockedTargetIdRef.current;
    const target = new Vector3();

    if (lockedId) {
      const targetObject = findDirectorObjectById(scene, lockedId);
      if (!targetObject) {
        lockedTargetIdRef.current = null;
        setLockedTarget(null);
      } else {
        getDirectorObjectTarget(targetObject, target);
        if (followTarget && lastLockedTargetPositionRef.current) {
          pilotCamera.position.add(target.clone().sub(lastLockedTargetPositionRef.current));
        }
        lastLockedTargetPositionRef.current = target.clone();

        const offset = pilotCamera.position.clone().sub(target);
        if (offset.lengthSq() < 0.01) offset.set(0, 0, 1);
        const spherical = new Spherical().setFromVector3(offset);
        spherical.theta -= intent.strafe * PILOT_ORBIT_SPEED * delta;
        spherical.theta -= pendingLockedMouseRef.current.x * PILOT_MOUSE_SENSITIVITY;
        spherical.phi = MathUtils.clamp(
          spherical.phi + pendingLockedMouseRef.current.y * PILOT_MOUSE_SENSITIVITY,
          0.08,
          Math.PI - 0.08
        );
        spherical.radius = Math.max(0.35, spherical.radius - intent.forward * PILOT_MOVE_SPEED * delta);
        pendingLockedMouseRef.current.x = 0;
        pendingLockedMouseRef.current.y = 0;

        pilotCamera.position.copy(target).add(new Vector3().setFromSpherical(spherical));
        pilotCamera.position.y += intent.vertical * PILOT_MOVE_SPEED * delta;
        pilotCamera.lookAt(target);
      }
    }

    if (!lockedTargetIdRef.current) {
      lastLockedTargetPositionRef.current = null;
      pilotCamera.quaternion.setFromEuler(orientationRef.current);
      const forward = new Vector3(0, 0, -1).applyQuaternion(pilotCamera.quaternion).normalize();
      const right = new Vector3(1, 0, 0).applyQuaternion(pilotCamera.quaternion).normalize();
      pilotCamera.position.addScaledVector(forward, intent.forward * PILOT_MOVE_SPEED * delta);
      pilotCamera.position.addScaledVector(right, intent.strafe * PILOT_MOVE_SPEED * delta);
      pilotCamera.position.y += intent.vertical * PILOT_MOVE_SPEED * delta;
      target.copy(pilotCamera.position).addScaledVector(forward, focusDistanceRef.current);
    }

    pilotCamera.updateMatrixWorld();

    const sceneChildren = Array.isArray(scene.children) ? scene.children : [];
    raycasterRef.current.setFromCamera(screenCenterRef.current, pilotCamera);
    const pointedRoot = raycasterRef.current
      .intersectObjects(sceneChildren, true)
      .map((intersection) => findDirectorObjectRoot(intersection.object))
      .find((object): object is Object3D => Boolean(object));
    const nextHoveredId = pointedRoot?.userData.directorObjectId ?? null;
    if (nextHoveredId !== hoveredTargetIdRef.current) {
      hoveredTargetIdRef.current = nextHoveredId;
      setHoveredTarget(nextHoveredId);
    }

    const snapshot: CameraMotionSnapshot = {
      fov: Number(pilotCamera.fov.toFixed(3)),
      position: snapshotTuple(pilotCamera.position),
      target: snapshotTuple(target),
    };
    snapshotRef.current = snapshot;

    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    if (now - lastSnapshotAtRef.current >= PILOT_SNAPSHOT_INTERVAL_MS) {
      lastSnapshotAtRef.current = now;
      onSnapshotCommitRef.current(snapshot);
    }
  });

  return null;
}
