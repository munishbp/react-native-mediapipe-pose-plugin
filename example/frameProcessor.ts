/**
 * Example: Using the PoseLandmarker VisionCamera plugin in React Native
 *
 * This shows how to call the native plugin from a VisionCamera frame processor
 * and convert the 33 MediaPipe pose landmarks to 17 COCO-compatible keypoints,
 * plus how to receive the optional 21-landmark hand results that come back
 * from the same plugin call.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RETURN-SHAPE NOTE (v0.2.0):
 * As of v0.2.0 the native plugin returns a unified `{ pose, hands }` dict on
 * every frame instead of a bare landmark array. `pose` is the 33-entry pose
 * landmark array (same as before). `hands` is an array of 0..2 hands, each
 * shaped `{ landmarks: [...21], handedness: 'Left' | 'Right' | '' }`. If you
 * are upgrading from 0.1.x, the worklet's `Array.isArray(result)` check has
 * to become `result && Array.isArray(result.pose)`.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useRef } from 'react';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

// Initialize the native plugin (must match the name in PoseLandmarkerPlugin.m)
const plugin = VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {});

// MediaPipe pose landmark type (33 per person)
type Landmark = {
  x: number;       // normalized 0-1
  y: number;       // normalized 0-1
  z: number;       // depth relative to hip midpoint
  visibility?: number; // 0-1 confidence
};

// One hand result from the native plugin. `landmarks` has 21 entries
// (MediaPipe's hand landmark count). `handedness` is "Left" or "Right" as
// reported by MediaPipe, or an empty string if MediaPipe didn't return one.
type Hand = {
  landmarks: Landmark[];
  handedness: 'Left' | 'Right' | '';
};

// The full per-frame return shape from the native plugin.
type PoseFrameResult = {
  pose: Landmark[];
  hands: Hand[];
};

// Maps MediaPipe 33 landmarks → 17 COCO keypoint names.
// Left/right are swapped to correct for iOS front camera mirror after
// the coordinate rotation (x: lm.y, y: lm.x).
const MEDIAPIPE_TO_COCO: Array<[number, string]> = [
  [0,  'nose'],
  [2,  'right_eye'],    // MediaPipe "left" = user's right on front camera
  [5,  'left_eye'],
  [7,  'right_ear'],
  [8,  'left_ear'],
  [11, 'right_shoulder'],
  [12, 'left_shoulder'],
  [13, 'right_elbow'],
  [14, 'left_elbow'],
  [15, 'right_wrist'],
  [16, 'left_wrist'],
  [23, 'right_hip'],
  [24, 'left_hip'],
  [25, 'right_knee'],
  [26, 'left_knee'],
  [27, 'right_ankle'],
  [28, 'left_ankle'],
];

/**
 * Convert raw MediaPipe landmarks to COCO-compatible keypoints.
 * Applies 90° CW rotation (x: lm.y, y: lm.x) to convert from
 * iOS landscape camera space to portrait display space.
 */
function mapLandmarksToPose(landmarks: Landmark[]) {
  return MEDIAPIPE_TO_COCO.map(([mpIndex, name]) => {
    const lm = landmarks[mpIndex];
    return {
      name,
      x: lm.y,        // rotate 90° CW for portrait
      y: lm.x,
      z: lm.z,
      confidence: lm.visibility ?? 0.5,
    };
  });
}

/**
 * What the JS-side callback receives once per frame:
 *   - `keypoints`: 17 COCO-mapped pose keypoints (or null if pose detection failed)
 *   - `hands`: 0..2 raw hand results from MediaPipe (each has 21 landmarks +
 *              "Left"/"Right"/"" handedness). Empty array if no hand was
 *              detected on this frame, or if the native HandLandmarker failed
 *              to initialize entirely.
 */
type DetectionResult = {
  keypoints: ReturnType<typeof mapLandmarksToPose>;
  hands: Hand[];
};

/**
 * Hook that returns a VisionCamera frame processor with MediaPipe pose +
 * hand detection. The supplied callback fires once per frame on the JS thread.
 */
export function usePoseFrameProcessor(
  onDetection: (result: DetectionResult | null) => void
) {
  const callbackRef = useRef(onDetection);
  callbackRef.current = onDetection;

  const handleResult = useCallback((result: DetectionResult | null) => {
    callbackRef.current(result);
  }, []);

  const handleOnJS = useRunOnJS(handleResult, [handleResult]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!plugin) return;

    const result = plugin.call(frame) as unknown as PoseFrameResult | undefined;
    if (!result || !Array.isArray(result.pose) || result.pose.length < 33) {
      handleOnJS(null);
      return;
    }
    handleOnJS({
      keypoints: mapLandmarksToPose(result.pose),
      hands: Array.isArray(result.hands) ? result.hands : [],
    });
  }, [handleOnJS]);

  return frameProcessor;
}
