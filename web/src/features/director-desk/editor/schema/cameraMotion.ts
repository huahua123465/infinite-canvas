import type {
  CameraMotionEasing,
  CameraMotionInterpolation,
  DirectorCameraMotionKeyframe,
  DirectorCameraMotionPath,
  DirectorCameraShot,
} from "./directorProject";

export interface CameraMotionSnapshot {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

export const DEFAULT_CAMERA_MOTION_PATH: DirectorCameraMotionPath = {
  duration: 6,
  loop: false,
  interpolation: "smooth",
  easing: "ease-in-out",
  keyframes: [],
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tuple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])];
}

export function normalizeCameraMotionPath(
  value: unknown,
  fallbackTarget: [number, number, number] = [0, 1, 0],
  fallbackTracking: Pick<DirectorCameraShot, "targetMode" | "targetObjectId"> = {
    targetMode: "manual",
    targetObjectId: null,
  }
): DirectorCameraMotionPath {
  if (!value || typeof value !== "object") return { ...DEFAULT_CAMERA_MOTION_PATH, keyframes: [] };
  const path = value as Partial<DirectorCameraMotionPath>;
  const keyframes = Array.isArray(path.keyframes)
    ? path.keyframes
        .map((item, index): DirectorCameraMotionKeyframe | null => {
          if (!item || typeof item !== "object") return null;
          const keyframe = item as Partial<DirectorCameraMotionKeyframe>;
          return {
            id: typeof keyframe.id === "string" && keyframe.id ? keyframe.id : `motion_key_${index + 1}`,
            time: clamp(finite(keyframe.time, index)),
            position: tuple(keyframe.position, [0, 2, 8]),
            target: tuple(keyframe.target, fallbackTarget),
            fov: Math.min(120, Math.max(10, finite(keyframe.fov, 50))),
            targetMode:
              keyframe.targetMode === "object" || keyframe.targetMode === "manual"
                ? keyframe.targetMode
                : fallbackTracking.targetMode,
            targetObjectId:
              keyframe.targetMode === "object"
                ? typeof keyframe.targetObjectId === "string" && keyframe.targetObjectId
                  ? keyframe.targetObjectId
                  : null
                : keyframe.targetMode === "manual"
                  ? null
                  : fallbackTracking.targetMode === "object"
                    ? fallbackTracking.targetObjectId ?? null
                    : null,
          };
        })
        .filter((item): item is DirectorCameraMotionKeyframe => Boolean(item))
        .sort((a, b) => a.time - b.time)
    : [];

  return {
    duration: Math.min(30, Math.max(0.5, finite(path.duration, DEFAULT_CAMERA_MOTION_PATH.duration))),
    loop: Boolean(path.loop),
    interpolation: path.interpolation === "linear" ? "linear" : "smooth",
    easing: path.easing === "linear" ? "linear" : "ease-in-out",
    keyframes,
  };
}

export function getCameraMotionPath(camera: DirectorCameraShot) {
  return normalizeCameraMotionPath(camera.motionPath, camera.target, camera);
}

export function retimeCameraMotionKeyframes(keyframes: DirectorCameraMotionKeyframe[]) {
  if (keyframes.length <= 1) {
    return keyframes.map((item) => ({ ...item, time: 0 }));
  }
  return keyframes.map((item, index) => ({ ...item, time: index / (keyframes.length - 1) }));
}

export function createCameraMotionKeyframe(
  camera: DirectorCameraShot,
  id: string,
  snapshot: CameraMotionSnapshot = {
    position: camera.transform.position,
    target: camera.target,
    fov: camera.fov,
  },
): DirectorCameraMotionKeyframe {
  return {
    id,
    time: 0,
    position: [...snapshot.position],
    target: [...snapshot.target],
    fov: snapshot.fov,
    targetMode: camera.targetMode,
    targetObjectId: camera.targetMode === "object" ? camera.targetObjectId ?? null : null,
  };
}

function linear(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function catmullRom(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3
  );
}

function applyEasing(value: number, easing: CameraMotionEasing) {
  if (easing === "linear") return value;
  return value * value * (3 - 2 * value);
}

function interpolateValue(
  values: number[],
  segment: number,
  t: number,
  interpolation: CameraMotionInterpolation
) {
  if (interpolation === "linear") return linear(values[segment], values[segment + 1], t);
  const a = values[Math.max(0, segment - 1)];
  const b = values[segment];
  const c = values[Math.min(values.length - 1, segment + 1)];
  const d = values[Math.min(values.length - 1, segment + 2)];
  return catmullRom(a, b, c, d, t);
}

export function getCameraMotionSnapshot(camera: DirectorCameraShot, progress: number): CameraMotionSnapshot {
  const path = getCameraMotionPath(camera);
  const keyframes = path.keyframes;
  const fallback = {
    fov: camera.fov,
    position: [...camera.transform.position] as [number, number, number],
    target: [...camera.target] as [number, number, number],
  };
  if (keyframes.length < 2) return fallback;

  const p = clamp(progress);
  if (p <= keyframes[0].time) {
    return {
      ...fallback,
      fov: keyframes[0].fov,
      position: [...keyframes[0].position],
      target: [...keyframes[0].target],
    };
  }
  const last = keyframes[keyframes.length - 1];
  if (p >= last.time) {
    return { ...fallback, fov: last.fov, position: [...last.position], target: [...last.target] };
  }

  let segment = 0;
  while (segment < keyframes.length - 2 && p > keyframes[segment + 1].time) segment += 1;
  const from = keyframes[segment];
  const to = keyframes[segment + 1];
  const rawLocal = (p - from.time) / Math.max(0.000001, to.time - from.time);
  const local = applyEasing(rawLocal, path.easing);
  const values = (axis: 0 | 1 | 2) => keyframes.map((item) => item.position[axis]);
  const targetValues = (axis: 0 | 1 | 2) => keyframes.map((item) => item.target[axis]);
  const position: [number, number, number] = [0, 1, 2].map((axis) =>
    interpolateValue(values(axis as 0 | 1 | 2), segment, local, path.interpolation)
  ) as [number, number, number];
  const target: [number, number, number] = [0, 1, 2].map((axis) =>
    interpolateValue(targetValues(axis as 0 | 1 | 2), segment, local, path.interpolation)
  ) as [number, number, number];
  const fov = linear(from.fov, to.fov, local);

  return { fov, position, target };
}

export function sampleCameraMotionPath(camera: DirectorCameraShot, count = 64) {
  if (count < 2) return [getCameraMotionSnapshot(camera, 0).position];
  return Array.from({ length: count }, (_, index) =>
    getCameraMotionSnapshot(camera, index / (count - 1)).position
  );
}
