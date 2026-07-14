import { useLoader } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { Box3, Euler, Quaternion, Vector3, type Object3D } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterRigState } from "../schema/directorProject";
import { VIEWPORT_OBJECT_LABEL_VERTICAL_GAP } from "../schema/viewportLabels";

interface MixamoCharacterModelProps {
  url: string;
  rigState?: CharacterRigState;
  onLabelAnchorYChange?: (anchorY: number) => void;
}

type RestPose = Record<string, [number, number, number, number]>;

const BONE_MAP = {
  body: "mixamorig:Hips",
  torso: "mixamorig:Spine2",
  head: "mixamorig:Head",
  leftShoulder: "mixamorig:LeftArm",
  rightShoulder: "mixamorig:RightArm",
  leftElbow: "mixamorig:LeftForeArm",
  rightElbow: "mixamorig:RightForeArm",
  leftHand: "mixamorig:LeftHand",
  rightHand: "mixamorig:RightHand",
  leftHip: "mixamorig:LeftUpLeg",
  rightHip: "mixamorig:RightUpLeg",
  leftKnee: "mixamorig:LeftLeg",
  rightKnee: "mixamorig:RightLeg",
} as const;

function degrees(value: number) {
  return value * Math.PI / 180;
}

function captureRestPose(scene: Object3D) {
  const restPose: RestPose = {};
  scene.traverse((object) => {
    if (!("isBone" in object) || object.isBone !== true) return;
    restPose[object.name] = [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w];
  });
  return restPose;
}

function rotationForBone(name: string, controls: Record<string, number>): [number, number, number] | null {
  const joint = Object.entries(BONE_MAP).find(([, bone]) => bone === name)?.[0];
  if (!joint) return null;
  const pitch = degrees(controls[`${joint}.pitch`] ?? controls[`${joint}.bend`] ?? 0);
  const yaw = degrees(controls[`${joint}.yaw`] ?? controls[`${joint}.twist`] ?? 0);
  const roll = degrees(controls[`${joint}.roll`] ?? controls[`${joint}.spread`] ?? 0);

  if (joint === "leftShoulder" || joint === "leftHip") return [yaw, pitch, roll];
  if (joint === "rightShoulder" || joint === "rightHip") return [yaw, pitch, -roll];
  if (joint === "leftElbow" || joint === "leftKnee") return [0, pitch, 0];
  if (joint === "rightElbow" || joint === "rightKnee") return [0, -pitch, 0];
  return [pitch, yaw, roll];
}

export function MixamoCharacterModel({ url, rigState, onLabelAnchorYChange }: MixamoCharacterModelProps) {
  const loaded = useLoader(FBXLoader, url);
  const { scene, restPose, scale, offset } = useMemo(() => {
    const clone = cloneSkeleton(loaded) as Object3D;
    clone.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(clone);
    const size = bounds.getSize(new Vector3());
    const modelScale = size.y > 0 ? 1.8 / size.y : 0.01;
    return {
      scene: clone,
      restPose: captureRestPose(clone),
      scale: modelScale,
      offset: new Vector3(
        -(bounds.min.x + bounds.max.x) * .5 * modelScale,
        -bounds.min.y * modelScale,
        -(bounds.min.z + bounds.max.z) * .5 * modelScale
      ),
    };
  }, [loaded]);

  useLayoutEffect(() => {
    const controls = rigState?.controls ?? {};
    scene.traverse((object) => {
      const rest = restPose[object.name];
      if (!rest) return;
      object.quaternion.set(rest[0], rest[1], rest[2], rest[3]);
      const rotation = rotationForBone(object.name, controls);
      if (rotation) object.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...rotation)));
    });
    onLabelAnchorYChange?.(1.8 + VIEWPORT_OBJECT_LABEL_VERTICAL_GAP + (controls["body.offsetY"] ?? 0));
  }, [onLabelAnchorYChange, restPose, rigState?.controls, scene]);

  const bodyOffsetY = rigState?.controls["body.offsetY"] ?? 0;
  return (
    <group name="mixamo-character" position={[offset.x, offset.y + bodyOffsetY, offset.z]} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}
