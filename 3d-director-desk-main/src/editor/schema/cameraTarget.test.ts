import { expect, it } from "vitest";
import type { DirectorCameraShot, DirectorObject } from "./directorProject";
import { getAnimatedCameraFocusTarget } from "./cameraTarget";

it("tracks the animated position of a moving prop at the current shared timeline progress", () => {
  const object: DirectorObject = {
    id: "moving_box",
    name: "移动箱子",
    kind: "prop",
    visible: true,
    locked: false,
    geometryType: "box",
    transform: { position: [10, 2, -4], rotation: [0, 0, 0], scale: [2, 2, 2] },
    motionPath: {
      interpolation: "linear",
      keyframes: [
        { id: "move_1", time: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        { id: "move_2", time: 1, transform: { position: [10, 2, -4], rotation: [0, 0, 0], scale: [2, 2, 2] } },
      ],
    },
  };
  const camera: DirectorCameraShot = {
    id: "cam_1",
    name: "机位01",
    fov: 50,
    transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
    targetMode: "object",
    targetObjectId: object.id,
    target: [0, 0.5, 0],
  };

  expect(getAnimatedCameraFocusTarget(camera, [object], 0)).toEqual([0, 0.5, 0]);
  expect(getAnimatedCameraFocusTarget(camera, [object], 0.5)).toEqual([5, 1.75, -2]);
  expect(getAnimatedCameraFocusTarget(camera, [object], 1)).toEqual([10, 3, -4]);
});

it("does not override a manually aimed camera", () => {
  const camera: DirectorCameraShot = {
    id: "cam_1",
    name: "机位01",
    fov: 50,
    transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
    targetMode: "manual",
    target: [1, 2, 3],
  };

  expect(getAnimatedCameraFocusTarget(camera, [], 0.5)).toBeNull();
});

it("lets each waypoint track a different moving subject and blends between them", () => {
  const left: DirectorObject = {
    id: "left_actor",
    name: "左侧人物",
    kind: "prop",
    visible: true,
    locked: false,
    geometryType: "box",
    transform: { position: [-4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };
  const right: DirectorObject = {
    ...left,
    id: "right_actor",
    name: "右侧人物",
    transform: { ...left.transform, position: [4, 0, 0] },
  };
  const camera: DirectorCameraShot = {
    id: "cam_route",
    name: "切换跟踪目标",
    fov: 50,
    transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
    targetMode: "manual",
    target: [0, 1, 0],
    motionPath: {
      duration: 6,
      loop: false,
      interpolation: "smooth",
      easing: "linear",
      keyframes: [
        { id: "point_1", time: 0, position: [0, 2, 8], target: [-4, 0.5, 0], fov: 50, targetMode: "object", targetObjectId: left.id },
        { id: "point_2", time: 1, position: [0, 2, 4], target: [4, 0.5, 0], fov: 50, targetMode: "object", targetObjectId: right.id },
      ],
    },
  };

  expect(getAnimatedCameraFocusTarget(camera, [left, right], 0)).toEqual([-4, 0.5, 0]);
  expect(getAnimatedCameraFocusTarget(camera, [left, right], 0.5)).toEqual([0, 0.5, 0]);
  expect(getAnimatedCameraFocusTarget(camera, [left, right], 1)).toEqual([4, 0.5, 0]);
});
