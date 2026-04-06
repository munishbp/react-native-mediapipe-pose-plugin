# react-native-mediapipe-pose-plugin

A custom [VisionCamera](https://github.com/mrousavy/react-native-vision-camera) frame processor plugin that wraps Google's [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) for real-time pose estimation in React Native.

Built as a lightweight native plugin (~50 lines of Swift) instead of depending on third-party MediaPipe React Native packages that have build configuration issues. Runs on-device with GPU acceleration.

## Why This Exists

Most React Native MediaPipe packages (`react-native-mediapipe-posedetection`, `react-native-mediapipe`, etc.) have unresolved iOS build issues:
- `use_frameworks!` conflicts with React Native's static library linking
- `-Swift.h` bridging header not found errors
- `MediaPipeTasksVision` xcframework linker failures
- Duplicate TensorFlow Lite symbols when combined with other ML packages

This plugin avoids all of that by being a simple native file added directly to your Xcode project — no separate pod, no framework linking issues.

## Features

- 33 3D pose landmarks (x, y, z, visibility) per detected person
- GPU acceleration via Metal on iOS
- ~10-20ms inference on iPhone 16 Pro Max
- Synchronous detection (results return directly from the frame processor callback)
- Built-in temporal smoothing from MediaPipe's detect-then-track architecture
- Compatible with VisionCamera v4+
- Works with bare React Native and Expo (bare workflow)

## iOS Setup

### 1. Add the MediaPipe pod

In your `ios/Podfile`, add inside the target block:

```ruby
pod 'MediaPipeTasksVision', '~> 0.10.14'
```

In the `post_install` block, add these workarounds for CocoaPods xcframework bugs:

```ruby
post_install do |installer|
  # ... your existing post_install code ...

  # Fix MediaPipe linker flags (CocoaPods bug with static xcframeworks)
  xcf_vision = '${PODS_ROOT}/MediaPipeTasksVision/frameworks/MediaPipeTasksVision.xcframework'
  xcf_common = '${PODS_ROOT}/MediaPipeTasksCommon/frameworks/MediaPipeTasksCommon.xcframework'
  xcf_common_graphs = '${PODS_ROOT}/MediaPipeTasksCommon/frameworks/graph_libraries'

  Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', 'Pods-YOUR_APP_NAME', '*.xcconfig')).each do |xcconfig_path|
    config = File.read(xcconfig_path)
    config = config.gsub('-l"MediaPipeTasksCommon"', '-framework "MediaPipeTasksCommon"')
    config = config.gsub('-l"MediaPipeTasksVision"', '-framework "MediaPipeTasksVision"')
    unless config.include?('MediaPipeTasksVision.xcframework/ios-arm64')
      config += "\nFRAMEWORK_SEARCH_PATHS = $(inherited) \"#{xcf_vision}/ios-arm64\" \"#{xcf_common}/ios-arm64\""
    end
    File.write(xcconfig_path, config)
  end
end
```

Replace `YOUR_APP_NAME` with your Xcode target name.

### 2. Download the model

Download `pose_landmarker_full.task` from [Google's MediaPipe models](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task) and add it to your Xcode project (make sure "Copy Bundle Resources" is checked).

### 3. Add the plugin files

Copy these 3 files into your `ios/YOUR_APP_NAME/` directory:

- **`PoseLandmarkerPlugin.swift`** — The VisionCamera plugin (detects poses, returns landmarks)
- **`PoseLandmarkerPlugin.m`** — ObjC registration (2 lines)
- **Update your bridging header** to include:

```objc
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import <VisionCamera/VisionCameraProxyHolder.h>
```

> **Note:** Update the `#import "AIPEER-Swift.h"` line in `PoseLandmarkerPlugin.m` to match your app's module name (e.g., `#import "YourApp-Swift.h"`).

### 4. Install pods

```bash
cd ios && pod install
```

### 5. Use in JavaScript/TypeScript

```typescript
import { VisionCameraProxy, useFrameProcessor } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {});

// Inside your component:
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const landmarks = plugin?.call(frame);
  if (landmarks && Array.isArray(landmarks) && landmarks.length >= 33) {
    // landmarks[i] = { x, y, z, visibility }
    // 33 MediaPipe landmarks, normalized 0-1
    runOnJS(handlePose)(landmarks);
  }
}, []);

return (
  <Camera
    device={device}
    isActive={true}
    frameProcessor={frameProcessor}
    pixelFormat="rgb"  // Required for MediaPipe
  />
);
```

See [`example/frameProcessor.ts`](example/frameProcessor.ts) for a complete example with MediaPipe-to-COCO keypoint mapping and iOS coordinate rotation.

## iOS Coordinate Notes

iOS front camera delivers frames in landscape-right orientation. The plugin returns coordinates in the raw camera frame's space. For portrait display, you need to rotate 90° CW:

```typescript
const portraitX = landmark.y;
const portraitY = landmark.x;
```

Left/right labels from MediaPipe are also swapped after this rotation (MediaPipe's "left" appears on the user's right side on screen). See the example for the full mapping.

## Android (Coming Soon)

The JavaScript code is cross-platform. For Android, you need a Kotlin equivalent of the Swift plugin:

1. Add `com.google.mediapipe:tasks-vision` to `android/app/build.gradle`
2. Create a Kotlin `FrameProcessorPlugin` subclass
3. Register it with the same name: `poseLandmarker`
4. Place `pose_landmarker_full.task` in `android/app/src/main/assets/`

See the detailed Android port guide in the comments of `PoseLandmarkerPlugin.swift`.

## MediaPipe Landmarks (33 total)

| Index | Landmark | Index | Landmark |
|-------|----------|-------|----------|
| 0 | nose | 17 | left pinky |
| 1 | left eye inner | 18 | right pinky |
| 2 | left eye | 19 | left index |
| 3 | left eye outer | 20 | right index |
| 4 | right eye inner | 21 | left thumb |
| 5 | right eye | 22 | right thumb |
| 6 | right eye outer | 23 | left hip |
| 7 | left ear | 24 | right hip |
| 8 | right ear | 25 | left knee |
| 9 | mouth left | 26 | right knee |
| 10 | mouth right | 27 | left ankle |
| 11 | left shoulder | 28 | right ankle |
| 12 | right shoulder | 29 | left heel |
| 13 | left elbow | 30 | right heel |
| 14 | right elbow | 31 | left foot index |
| 15 | left wrist | 32 | right foot index |
| 16 | right wrist | | |

## Requirements

- React Native 0.74+
- react-native-vision-camera 4.0+
- react-native-worklets-core 1.0+
- iOS 15.0+
- Xcode 15+

## License

MIT

## Acknowledgments

- [Google MediaPipe](https://ai.google.dev/edge/mediapipe) for the Pose Landmarker model and SDK
- [VisionCamera](https://github.com/mrousavy/react-native-vision-camera) by Marc Rousavy for the frame processor plugin architecture
- Inspired by [Lukasz Kurant's hand landmarks tutorial](https://medium.com/@lukasz.kurant/high-performance-hand-landmark-detection-in-react-native-using-vision-camera-and-skia-frame-9ddec89362bc)
