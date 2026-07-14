import { Euler, Vector3 } from "three";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import { getUE4GroundedLabelY } from "../runtime/ue4Mannequin/ue4MannequinRig";
import type { DirectorCameraShot, DirectorObject, GeometryPrimitiveType } from "./directorProject";
import { getCameraMotionPath } from "./cameraMotion";
import { getObjectMotionSnapshot } from "./objectMotion";

const IMPORTED_MODEL_FOCUS_OFFSET_Y = 1;

const GEOMETRY_FOCUS_OFFSET_Y: Record<GeometryPrimitiveType, number> = {
  box: 0.5,
  sphere: 0.55,
  cylinder: 0.6,
  torus: 0.14,
  cone: 0.55,
  pyramid: 0.55,
};

function roundTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

export function isCameraFocusableObject(object: DirectorObject) {
  return object.visible && object.kind !== "camera" && object.kind !== "panorama";
}

export function getDirectorObjectFocusOffsetY(object: DirectorObject) {
  if (object.assetRefId) {
    return IMPORTED_MODEL_FOCUS_OFFSET_Y;
  }

  if (object.kind === "character") {
    const labelY =
      object.characterRig?.rigType === "ue4-mannequin"
        ? getUE4GroundedLabelY(object.bodyType)
        : getGroundedLabelY(object.bodyType);

    return labelY / 2;
  }

  if (object.geometryType) {
    return GEOMETRY_FOCUS_OFFSET_Y[object.geometryType];
  }

  return IMPORTED_MODEL_FOCUS_OFFSET_Y;
}

export function getDirectorObjectFocusTarget(object: DirectorObject): [number, number, number] {
  const [scaleX, scaleY, scaleZ] = object.transform.scale;
  const offset = new Vector3(0, getDirectorObjectFocusOffsetY(object), 0)
    .multiply(new Vector3(scaleX, scaleY, scaleZ))
    .applyEuler(new Euler(...object.transform.rotation));
  const target = new Vector3(...object.transform.position).add(offset);

  return roundTuple(target);
}

export function getAnimatedCameraFocusTarget(
  camera: DirectorCameraShot,
  objects: DirectorObject[],
  progress: number
): [number, number, number] | null {
  const getAnimatedObjectTarget = (objectId: string | null | undefined) => {
    if (!objectId) return null;
    const targetObject = objects.find((object) => object.id === objectId);
    if (!targetObject) return null;

    return getDirectorObjectFocusTarget({
      ...targetObject,
      transform: getObjectMotionSnapshot(targetObject, progress),
    });
  };

  const path = getCameraMotionPath(camera);
  const keyframes = path.keyframes;

  if (keyframes.length === 0) {
    return camera.targetMode === "object"
      ? getAnimatedObjectTarget(camera.targetObjectId)
      : null;
  }

  const resolveWaypointTarget = (index: number) => {
    const keyframe = keyframes[index];
    const animatedTarget = keyframe.targetMode === "object"
      ? getAnimatedObjectTarget(keyframe.targetObjectId)
      : null;

    return {
      target: animatedTarget ?? keyframe.target,
      tracked: Boolean(animatedTarget),
    };
  };

  const p = Math.min(1, Math.max(0, progress));
  if (keyframes.length === 1 || p <= keyframes[0].time) {
    const resolved = resolveWaypointTarget(0);
    return resolved.tracked ? [...resolved.target] : null;
  }

  const lastIndex = keyframes.length - 1;
  if (p >= keyframes[lastIndex].time) {
    const resolved = resolveWaypointTarget(lastIndex);
    return resolved.tracked ? [...resolved.target] : null;
  }

  let segment = 0;
  while (segment < keyframes.length - 2 && p > keyframes[segment + 1].time) segment += 1;
  const from = resolveWaypointTarget(segment);
  const to = resolveWaypointTarget(segment + 1);
  if (!from.tracked && !to.tracked) return null;

  const fromTime = keyframes[segment].time;
  const toTime = keyframes[segment + 1].time;
  const rawLocal = (p - fromTime) / Math.max(0.000001, toTime - fromTime);
  const local = path.easing === "linear"
    ? rawLocal
    : rawLocal * rawLocal * (3 - 2 * rawLocal);
  const blended = new Vector3(...from.target).lerp(new Vector3(...to.target), local);

  return roundTuple(blended);
}
