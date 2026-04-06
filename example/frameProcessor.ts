/**
 * Example: Using the PoseLandmarker VisionCamera plugin in React Native
 *
 * This shows how to call the native plugin from a VisionCamera frame processor
 * and convert the 33 MediaPipe landmarks to 17 COCO-compatible keypoints.
 */

import { useCallback, useRef } from 'react';
import { useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

// Initialize the native plugin (must match the name in PoseLandmarkerPlugin.m)
const plugin = VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {});

// MediaPipe landmark type (33 per person)
type Landmark = {
  x: number;       // normalized 0-1
  y: number;       // normalized 0-1
  z: number;       // depth relative to hip midpoint
  visibility?: number; // 0-1 confidence
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
 * Hook that returns a VisionCamera frame processor with MediaPipe pose detection.
 */
export function usePoseFrameProcessor(onPoseDetected: (keypoints: any[] | null) => void) {
  const callbackRef = useRef(onPoseDetected);
  callbackRef.current = onPoseDetected;

  const handleLandmarks = useCallback((landmarks: Landmark[] | null) => {
    if (!landmarks) {
      callbackRef.current(null);
      return;
    }
    callbackRef.current(mapLandmarksToPose(landmarks));
  }, []);

  const handleOnJS = useRunOnJS(handleLandmarks, [handleLandmarks]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!plugin) return;

    const result = plugin.call(frame);
    if (!result || !Array.isArray(result) || result.length < 33) {
      handleOnJS(null);
      return;
    }
    handleOnJS(result as unknown as Landmark[]);
  }, [handleOnJS]);

  return frameProcessor;
}
