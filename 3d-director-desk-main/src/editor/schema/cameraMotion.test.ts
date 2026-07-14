import { describe, expect, it } from "vitest";
import type { DirectorCameraShot } from "./directorProject";
import {
  createCameraMotionKeyframe,
  getCameraMotionSnapshot,
  normalizeCameraMotionPath,
  retimeCameraMotionKeyframes,
  sampleCameraMotionPath,
} from "./cameraMotion";

function camera(): DirectorCameraShot {
  return {
    id: "cam_1",
    name: "机位01",
    fov: 50,
    transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
    targetMode: "manual",
    target: [0, 1, 0],
    motionPath: {
      duration: 6,
      loop: false,
      interpolation: "smooth",
      easing: "ease-in-out",
      keyframes: [
        { id: "key_1", time: 0, position: [0, 2, 8], target: [0, 1, 0], fov: 50 },
        { id: "key_2", time: 0.5, position: [5, 3, 2], target: [1, 1.5, 0], fov: 42 },
        { id: "key_3", time: 1, position: [0, 1.5, -5], target: [3, 1, -1], fov: 35 },
      ],
    },
  };
}

describe("camera motion path", () => {
  it("normalizes malformed persisted values", () => {
    expect(normalizeCameraMotionPath({ duration: -1, interpolation: "unknown" })).toMatchObject({
      duration: 0.5,
      interpolation: "smooth",
      keyframes: [],
    });
    expect(normalizeCameraMotionPath({ duration: 99 }).duration).toBe(30);
  });

  it("captures the current camera as a keyframe", () => {
    expect(createCameraMotionKeyframe(camera(), "key_4")).toMatchObject({
      id: "key_4",
      position: [0, 2, 8],
      target: [0, 1, 0],
      fov: 50,
    });
  });

  it("retimes keyframes across the complete shot", () => {
    const retimed = retimeCameraMotionKeyframes(camera().motionPath!.keyframes);
    expect(retimed.map((item) => item.time)).toEqual([0, 0.5, 1]);
  });

  it("preserves exact first and last camera positions and look targets", () => {
    const shot = camera();
    shot.motionPath!.keyframes[0].target = [-2, 1, 1];
    shot.motionPath!.keyframes[2].target = [4, 2, -3];

    expect(getCameraMotionSnapshot(shot, 0)).toMatchObject({
      position: [0, 2, 8],
      target: [-2, 1, 1],
    });
    expect(getCameraMotionSnapshot(shot, 1)).toMatchObject({
      position: [0, 1.5, -5],
      target: [4, 2, -3],
    });
  });

  it("samples a smooth path while interpolating each waypoint target", () => {
    const shot = camera();
    const sample = getCameraMotionSnapshot(shot, 0.5);
    expect(sample.position).toEqual([5, 3, 2]);
    expect(sample.target).toEqual([1, 1.5, 0]);
    expect(sampleCameraMotionPath(shot, 20)).toHaveLength(20);
  });

  it("captures an arbitrary live pilot snapshot instead of the camera rig", () => {
    expect(
      createCameraMotionKeyframe(camera(), "key_live", {
        position: [9, 4, -2],
        target: [2, 2, 0],
        fov: 33,
      })
    ).toMatchObject({
      id: "key_live",
      position: [9, 4, -2],
      target: [2, 2, 0],
      fov: 33,
    });
  });
});
