# react-native-mediapipe-pose-plugin

A [VisionCamera](https://github.com/mrousavy/react-native-vision-camera) frame processor plugin wrapping Google's [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) AND [Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) for real-time, on-device pose + hand estimation in React Native. iOS (Swift) and Android (Kotlin), both production-validated. A single plugin call returns both pose AND hand landmarks from the same frame.

## Origin

When this work began, **no React Native MediaPipe integration worked cleanly with VisionCamera on iOS**. Every existing wrapper hit at least one of `use_frameworks!` collisions, `-Swift.h` not-found errors, or static-xcframework linker failures. Rather than fork one of them, we wrote the iOS Swift plugin in this repo from scratch inside the [AI-PEER](https://github.com/munishbp/AI-PEER) project — a fall-prevention research app for older adults that needs clinical-grade pose estimation on-device for exercise-form coaching.

Once the iOS plugin was running on real hardware, we wrote the Kotlin counterpart so Android users would have the same capability. Both implementations are now battle-tested in AI-PEER and lifted into this repo, unchanged, for the broader React Native community.

- **iOS Swift** code in this repo is the same code shipping in AI-PEER's iOS app (`front-end/AI-PEER/ios/AIPEER/PoseLandmarkerPlugin.swift`)
- **Android Kotlin** code in this repo is the same code shipping in AI-PEER's Android app (`front-end/AI-PEER/android/app/src/main/java/.../PoseLandmarkerFrameProcessorPlugin.kt`)

## Why this exists

Most React Native MediaPipe packages (`react-native-mediapipe-posedetection`, `react-native-mediapipe`, etc.) hit unresolved iOS build issues. The concrete failure modes we ran into in AI-PEER:

- **`use_frameworks!` collisions** with React Native's static library linking. Most RN apps cannot enable `use_frameworks!` without breaking unrelated dependencies.
- **`-Swift.h` bridging-header not found** in mixed Swift/ObjC RN apps — a recurring footgun whenever Swift code lives outside the main app target.
- **`MediaPipeTasksVision` xcframework linker failures.** CocoaPods generates `-l"MediaPipeTasksCommon"` and `-l"MediaPipeTasksVision"` in xcconfig files, but the binaries are inside `.framework` wrappers — the linker needs `-framework "..."` instead, plus per-arch `FRAMEWORK_SEARCH_PATHS` pointing into `MediaPipeTasksVision.xcframework/ios-arm64`. Without the rewrite, link fails on the C++ symbol `kTasksVisionResourceProvider`.
- **C++20 enforcement** is required by MediaPipe headers. RN's default pod scripts emit `gnu++17` for many targets, which fails to compile MediaPipe (and `react-native-worklets-core` on RN 0.81+).
- **Duplicate symbols** when MediaPipe coexists with other ML/inference packages that also bundle TFLite or threadpool code. AI-PEER hits a `ThreadPool::~ThreadPool()` duplicate between `libMediaPipeTasksCommon_device_graph.a` and `libllama-rn.a`; the linker handles it with `ld: ignoring duplicate libraries '-lc++'` warnings, but it's a coexistence wart worth knowing about.

This plugin avoids all of that by being a small set of native files added directly to your Xcode and Android Studio projects — no pod or gradle module wrapping the MediaPipe SDK. You depend on `MediaPipeTasksVision` (iOS) / `com.google.mediapipe:tasks-vision` (Android) directly, and you own the linker fixes via the post_install snippet documented below.

## Features

- 33 3D pose landmarks (x, y, z, visibility) per detected person
- 21 hand landmarks per detected hand, up to 2 hands per frame, with `"Left"`/`"Right"` handedness label — returned alongside the pose result in the same plugin call
- GPU acceleration on both platforms — Metal delegate on iOS, MediaPipe GPU delegate on Android with automatic CPU fallback (per landmarker independently)
- Synchronous `.video` running mode — predictable per-frame latency, no async listener / delegate plumbing
- ~10–20 ms per frame inference on iPhone 16 Pro Max and Pixel 7 (pose + hands combined)
- Single-person tracking by default (`numPoses = 1`), confidence floors at `0.3` for full-body distance; hand confidence floors at `0.4` (slightly stricter, hand detection at distance has more false positives)
- Built-in temporal smoothing from MediaPipe's detect-then-track architecture
- Compatible with VisionCamera v4+
- Works with bare React Native and Expo bare workflow
- Ships diagnostic shell scripts (`ios-doctor.sh` / `android-doctor.sh` / `ios-clean.sh` / `android-clean.sh`) that consumers can drop into their own app's `scripts/` folder to preflight a build environment or nuke a stuck native build cache

## Validation

The exact production environment AI-PEER validated against, end-to-end:

### iOS
- **Device:** iPhone 16 Pro Max (Apple A18 Pro)
- **iOS:** 26.3.1
- **Xcode:** 26
- **React Native:** 0.81.5
- **Expo SDK:** ~54 (bare workflow, NOT managed)
- **react-native-vision-camera:** ^4.7.3
- **react-native-worklets-core:** ^1.6.3
- **MediaPipeTasksVision pod:** ~> 0.10.14

### Android
- **Device:** Pixel 7 (Tensor G2)
- **React Native:** 0.81.5 (same Expo bare workflow)
- **com.google.mediapipe:tasks-vision:** 0.10.29
- **min/target SDK:** matches the AI-PEER `rootProject.ext` defaults (API 24+)

### Performance
- ~10–20 ms per frame inference on both platforms with the GPU delegate
- 33 landmarks per detected person, x/y/z + visibility, normalized 0–1
- Deterministic latency — synchronous `.video` mode means no jitter from async listener queuing

### Use case validated
Real-time exercise-form analysis with downstream COCO-17 keypoint mapping. Left/right clinical correctness verified end-to-end on a left-side hip-abductor exercise on Pixel 7 (AI-PEER's R3 acceptance test). The hand-detection path is validated by AI-PEER's "open palm" gesture-confirm session-start UI: the user holds a forward-facing open palm for 1 second to begin a tracked exercise. The handedness label is required because the JS palm-vs-back-of-hand check uses a finger cross product whose sign flips between left and right hands — knowing which hand it is, is what makes the disambiguation work.

---

## iOS Setup

### 1. Add the MediaPipe pod

In `ios/Podfile`, inside your target block:

```ruby
pod 'MediaPipeTasksVision', '~> 0.10.14'
```

### 2. post_install: xcframework + linker fix

CocoaPods emits `-l"MediaPipeTasksCommon"` for the static xcframeworks, which fails at link time. Rewrite the xcconfigs to use `-framework "..."` and add the per-arch xcframework search paths. This snippet is verbatim from AI-PEER's `ios/Podfile`:

```ruby
post_install do |installer|
  # ... your existing react_native_post_install call ...

  xcf_vision = '${PODS_ROOT}/MediaPipeTasksVision/frameworks/MediaPipeTasksVision.xcframework'
  xcf_common = '${PODS_ROOT}/MediaPipeTasksCommon/frameworks/MediaPipeTasksCommon.xcframework'

  Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', 'Pods-<YourTargetName>', '*.xcconfig')).each do |xcconfig_path|
    config = File.read(xcconfig_path)

    # -l (library) → -framework
    config = config.gsub('-l"MediaPipeTasksCommon"', '-framework "MediaPipeTasksCommon"')
    config = config.gsub('-l"MediaPipeTasksVision"', '-framework "MediaPipeTasksVision"')

    # Per-arch xcframework slice paths so Swift can find the modules at compile
    # time AND the linker can find the frameworks
    unless config.include?('MediaPipeTasksVision.xcframework/ios-arm64')
      config += "\nFRAMEWORK_SEARCH_PATHS = $(inherited) \"#{xcf_vision}/ios-arm64\" \"#{xcf_common}/ios-arm64\""
    end

    File.write(xcconfig_path, config)
  end
end
```

Replace `<YourTargetName>` with your Xcode target name (e.g. `Pods-MyApp`).

### 3. post_install: C++20 enforcement

MediaPipe headers (and `react-native-worklets-core` on RN 0.81+) require C++20. RN's default pod scripts often leave many pod targets at `gnu++17`. Add to the same `post_install` block:

```ruby
installer.pods_project.targets.each do |target|
  target.build_configurations.each do |config|
    config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
    config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
  end
end

# Defense in depth: also patch xcconfig files on disk so a `grep` won't lie
Dir.glob(File.join(installer.sandbox.root, 'Target Support Files', '**', '*.xcconfig')).each do |xcconfig_path|
  contents = File.read(xcconfig_path)
  patched = contents.gsub(/CLANG_CXX_LANGUAGE_STANDARD = (?:"?(?:gnu\+\+14|gnu\+\+17|c\+\+14|c\+\+17)"?)/, 'CLANG_CXX_LANGUAGE_STANDARD = c++20')
  File.write(xcconfig_path, patched) if patched != contents
end
```

### 4. Download the models

Download both model files from Google's CDN:

```
# Pose model (~9 MB)
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

# Hand model (~6 MB) — required as of v0.2.0; without it the plugin still
# detects pose but logs "[HandLandmarker] Model file not found in bundle"
# and returns hands: [] on every frame.
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
```

Add **both files** to your Xcode project (`ios/<YourApp>/`) and ensure **"Copy Bundle Resources"** is checked on each in Xcode's Build Phases. The Swift plugin loads them by name (`pose_landmarker_full.task`, `hand_landmarker.task`) from `Bundle.main` — they must be present in the app bundle, not as Xcode file references only.

### 5. Add the plugin files

Copy these into `ios/<YourApp>/`:

- **`ios/PoseLandmarkerPlugin.swift`** — the VisionCamera frame processor plugin
- **`ios/PoseLandmarkerPlugin.m`** — ObjC registration
- **`ios/BridgingHeader.h`** — append these imports to your existing bridging header (or create one if you don't have it):

```objc
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import <VisionCamera/VisionCameraProxyHolder.h>
```

> **⚠️ Bridging-header footgun.** The shipped `PoseLandmarkerPlugin.m` has `#import "AIPEER-Swift.h"` hardcoded on line 23. **You MUST edit this** to `#import "<YourTargetName>-Swift.h"` (e.g. `#import "MyApp-Swift.h"`) before building. Otherwise the build fails with a clear "header not found" error — which is the goal; better than silently importing the wrong header. Generalizing this is tracked in the [Roadmap](#roadmap) section.

### 6. Install pods

```bash
cd ios && pod install
```

### 7. Use it from JavaScript

```typescript
import { Camera, useFrameProcessor, VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

const plugin = VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {});

function CameraView() {
  const handleResult = (result) => {
    // result.pose:  33 entries  → { x, y, z, visibility? }, normalized 0–1
    // result.hands: 0..2 hands  → { landmarks: [...21 {x,y,z}], handedness: 'Left' | 'Right' | '' }
    //
    // Example:
    //   const noseY = result.pose[0].y;
    //   const firstHand = result.hands[0];        // may be undefined
    //   const isRightHand = firstHand?.handedness === 'Right';
  };
  const onResult = useRunOnJS(handleResult, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!plugin) return;
    const result = plugin.call(frame);
    if (result && Array.isArray(result.pose) && result.pose.length >= 33) {
      onResult(result);
    }
  }, [onResult]);

  return (
    <Camera
      device={device}
      isActive={true}
      frameProcessor={frameProcessor}
      pixelFormat="rgb"   // REQUIRED — see Coordinate Transforms below
    />
  );
}
```

> **Breaking change in v0.2.0.** The plugin now returns a `{ pose, hands }` dict instead of a bare landmark array. If you're upgrading from 0.1.x, change `Array.isArray(result)` to `result && Array.isArray(result.pose)` and read `result.pose` where you previously read `result`. `result.hands` is always an array (possibly empty), never `undefined` — even if MediaPipe's HandLandmarker fails to initialize entirely (you'll see a `[HandLandmarker] Failed to init` log line, and every `result.hands` will be `[]`, but pose detection still runs).

The `'worklet'` directive is mandatory on the frame processor function — it tells `react-native-worklets-core` to compile it for the camera thread. The `pixelFormat="rgb"` prop is also mandatory; MediaPipe expects RGBA frames, and on Android the Kotlin plugin defensively rejects non-RGBA frames.

---

## Android Setup

### 1. Add the MediaPipe Maven dependency

In `android/app/build.gradle`, inside the `dependencies` block:

```gradle
implementation 'com.google.mediapipe:tasks-vision:0.10.29'
```

Maven Central is already declared in the default RN `android/build.gradle` repositories block, so no extra repository needed.

### 2. Disable .task compression

The MediaPipe model file is a TFLite flatbuffer loaded via `mmap`. AAPT's default gzip compression corrupts the mmap path and breaks model loading. Inside the `android { ... }` block of `android/app/build.gradle`:

```gradle
androidResources {
    ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'
    noCompress += "task"
}
```

### 3. Download the models

Same files as iOS, different location:

```
android/app/src/main/assets/pose_landmarker_full.task
android/app/src/main/assets/hand_landmarker.task
```

Download from Google's CDN:

```
# Pose model (~9 MB)
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

# Hand model (~6 MB) — required as of v0.2.0; without it the Kotlin plugin
# logs "createHandLandmarker(delegate=GPU) failed" and disables hand
# detection while keeping pose detection running.
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
```

The `noCompress += "task"` rule from Step 2 already covers both files (it matches by file extension), so you do NOT need to repeat it.

### 4. Copy the Kotlin plugin file

Copy `android/src/main/java/com/poselandmarker/PoseLandmarkerFrameProcessorPlugin.kt` from this repo into your Android app at:

```
android/app/src/main/java/com/<yourapp>/poselandmarker/PoseLandmarkerFrameProcessorPlugin.kt
```

Update the `package` declaration on line 1 to match the directory you placed it in (e.g. `package com.myapp.poselandmarker`). The class name (`PoseLandmarkerFrameProcessorPlugin`) and the registered plugin name (`poseLandmarker`) MUST stay the same so the JS layer is identical to iOS.

### 5. Register the plugin in MainApplication

In your `android/app/src/main/java/com/<yourapp>/MainApplication.kt`, add the import and a `companion object` with an `init` block. The companion-object init runs at JVM class-load time — earlier than `Application.onCreate()` and earlier than any JS bundle load — so the registry is populated before any frame processor resolves the plugin from JS.

```kotlin
import com.<yourapp>.poselandmarker.PoseLandmarkerFrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry

class MainApplication : Application(), ReactApplication {
  // ... your existing reactNativeHost / reactHost / onCreate ...

  companion object {
    init {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("poseLandmarker") { proxy, options ->
        PoseLandmarkerFrameProcessorPlugin(proxy, options)
      }
    }
  }
}
```

The plugin name `"poseLandmarker"` MUST match exactly what iOS exports (`VISION_EXPORT_SWIFT_FRAME_PROCESSOR(PoseLandmarkerPlugin, poseLandmarker)`) so the JS layer is platform-agnostic. A mismatch silently makes `VisionCameraProxy.initFrameProcessorPlugin('poseLandmarker', {})` return `null` in JS.

### 6. Set the camera pixel format

On the `<Camera>` component in JS, `pixelFormat="rgb"` is required. CameraX needs `OUTPUT_IMAGE_FORMAT_RGBA_8888` and the Kotlin plugin defensively rejects non-RGBA frames with a loud log line.

### 7. Build hardening (recommended)

Adding MediaPipe + VisionCamera + worklets-core to an Android RN app multiplies the amount of native CMake / NDK work the Gradle build has to do. On a fresh clone of a project that uses all three, builds can fail with:

```
Fail to run Gradle Worker Daemon
> Build failed with an exception.
> A failure occurred while executing org.jetbrains.kotlin.gradle.tasks.KotlinCompile$KotlinCompileTask
> Process 'Gradle Worker Daemon 1' finished with non-zero exit value 137
```

The exit code 137 is the OOM signal. The root cause is almost always the Gradle daemon running out of heap while forking worker JVMs to compile Kotlin / javac / CMake all in parallel across four target architectures. The fix is three lines in `android/gradle.properties`:

```properties
# 1. Cap architectures: every modern Android phone is arm64-v8a. Building all
# four (armeabi-v7a, arm64-v8a, x86, x86_64) quadruples CMake work across
# VisionCamera / reanimated / worklets-core / MediaPipe — the main cause of
# daemon OOM on fresh clones. CLI override for multi-arch release builds:
#   ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86,x86_64
reactNativeArchitectures=arm64-v8a

# 2. Bumped from the RN default -Xmx2048m. 4 GB max heap is safe on any 8 GB+
# machine and gives the daemon room to fork worker JVMs while CMake tasks
# are running. HeapDumpOnOutOfMemoryError leaves a dump for next time.
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError

# 3. Cap concurrent worker JVMs. Default is availableProcessors(), which on a
# 16-core machine forks 16 workers each with their own heap and OOMs the
# daemon on modest-RAM laptops. 4 keeps total fork pressure bounded.
org.gradle.workers.max=4
```

Most consumers will not need to ship multi-arch APKs in dev (every physical Android phone since ~2018 is arm64-v8a — the other architectures only exist for emulators and ancient hardware). Override on the CLI when you need a Play Store release build.

### 8. Use it from JavaScript

The JS code is identical to iOS — see the [iOS Step 7](#7-use-it-from-javascript) snippet above. The shared TS layer handles platform differences via `Platform.OS === 'android'` (see [Coordinate Transforms](#coordinate-transforms)).

### Android-specific gotchas

The shipped Kotlin plugin handles the following — most of this knowledge is encoded as comments in the source. Worth knowing if you're tracing a bug:

- **GPU thread affinity.** `PoseLandmarker` MUST be created on the same thread `callback()` runs on (VisionCamera's videoQueue HandlerThread). The plugin handles this with lazy initialization on first callback; constructing on the JS thread crashes the GPU delegate.
- **GPU → CPU fallback.** First tries `Delegate.GPU`. On hardware that doesn't support it (some Mali / older Adreno parts), falls back to `Delegate.CPU` automatically. `initAttempted` is set unconditionally so we never re-try mid-stream.
- **HMR survival.** The `PoseLandmarker` instance is held in a `companion object @Volatile` field so React Native fast-refresh / HMR cycles re-invoking the registry factory don't leak ~50 MB of native memory per reload.
- **Nanosecond → millisecond timestamp conversion** with strict-monotonicity guard. CameraX delivers `frame.timestamp` in nanoseconds (`SystemClock`-derived). MediaPipe's `detectForVideo` expects milliseconds. Two frames within the same millisecond would collide after integer division and trigger MediaPipe's `IllegalArgumentException`, so the plugin force-advances any timestamp `<= lastTimestampMs`.
- **JSI bridge `Float → Double` upcast.** VisionCamera v4's JSI bridge on Android does NOT accept `java.lang.Float` (`"Cannot convert Java type 'class java.lang.Float' to jsi::Value!"`). The plugin explicitly upcasts each `lm.x() / .y() / .z() / .visibility()` to `Double` before boxing into the result map. JS receives plain `number` either way.
- **No manual cleanup.** Do NOT call `mediaImage.close()` or `mpImage.close()`. VisionCamera retains the underlying ImageProxy via reference counting and releases it after `callback()` returns; closing it ourselves corrupts the next frame.
- **RGBA_8888 format check.** The plugin verifies `mediaImage.format == PixelFormat.RGBA_8888` and returns `null` with an error log otherwise. This catches a regression where someone removes `pixelFormat="rgb"` from the Camera component.

---

## Diagnostic scripts

This package ships four shell scripts under `scripts/` that you can drop into your own app's `scripts/` folder to preflight a build environment or recover from a stuck native build cache. They're cross-platform (macOS, Linux, Windows Git Bash), read-only on the doctor side, and explicit about what they touch on the clean side.

| Script | Type | What it does |
| --- | --- | --- |
| `scripts/ios-doctor.sh` | Read-only check | Verifies Xcode ≥ 16, Command Line Tools points at `/Applications/Xcode.app`, Node version vs `.nvmrc`, CocoaPods ≥ 1.16, `ios/Pods/` present, `.env` present, the three plugin peerDeps in `node_modules/`, and that `pose_landmarker_full.task` + `hand_landmarker.task` exist somewhere under `ios/`. Exits 0 if every check passes, 1 otherwise. |
| `scripts/android-doctor.sh` | Read-only check | Verifies JDK 17/21 (via PATH or JAVA_HOME — accepts Android Studio's bundled JBR on Windows where `java` isn't on PATH), `JAVA_HOME` validity, `ANDROID_HOME`/`ANDROID_SDK_ROOT`, `adb` (PATH or under `$ANDROID_HOME/platform-tools`), platform-tools install, NDK presence, Node vs `.nvmrc`, `.env`, the three plugin peerDeps, `android/gradlew` checked in, and total system RAM (warns if < 8 GB). |
| `scripts/ios-clean.sh` | Destructive (with explicit warning) | Deintegrates CocoaPods, wipes `ios/Pods` + `ios/Podfile.lock` + `ios/build`, wipes `~/Library/Developer/Xcode/DerivedData` (shared across **all** Xcode projects on the machine, not just yours), then re-runs `pod install`. Use when iOS builds fail with mysterious template / module / linker errors after a Podfile change. |
| `scripts/android-clean.sh` | Destructive (with explicit warning) | Wipes `android/.gradle` + `android/build` + `android/app/build` + `android/app/.cxx`, then runs `./gradlew clean`. Does NOT touch `~/.gradle` (shared cache, would cost hours of redownloads) or `node_modules`. Use when Android builds fail with mysterious Kotlin / CMake / dex errors. |

### Installing the scripts in your app

Copy from the package into your app's `scripts/` folder:

```bash
mkdir -p scripts
cp node_modules/react-native-mediapipe-pose-plugin/scripts/ios-doctor.sh scripts/
cp node_modules/react-native-mediapipe-pose-plugin/scripts/ios-clean.sh scripts/
cp node_modules/react-native-mediapipe-pose-plugin/scripts/android-doctor.sh scripts/
cp node_modules/react-native-mediapipe-pose-plugin/scripts/android-clean.sh scripts/
chmod +x scripts/*.sh
```

Then add the four entries to your app's `package.json` `scripts` block:

```json
"scripts": {
  "ios:doctor": "bash scripts/ios-doctor.sh",
  "ios:clean": "bash scripts/ios-clean.sh",
  "android:doctor": "bash scripts/android-doctor.sh",
  "android:clean": "bash scripts/android-clean.sh"
}
```

### Using them

**Before every build on a fresh machine** (or after pulling a branch that touches native deps), run the doctor:

```bash
npm run ios:doctor      # before pod install / xcodebuild / Xcode
npm run android:doctor  # before ./gradlew assembleDebug / npx expo run:android
```

**When a build fails with "works on my machine" weirdness**, run the matching clean and try the build again:

```bash
npm run ios:clean
# then: cd ios && pod install && open <YourApp>.xcworkspace, then Cmd+Shift+K, then build

npm run android:clean
# then: npx expo run:android  (or: npm run android)
```

### Windows note

If you're on Windows Git Bash, the scripts work as-is. The shipped `.gitattributes` enforces `*.sh text eol=lf` so the shebang doesn't get a stray `\r` on first clone — without that, Bash fails to start the script with `env: bash\r: No such file or directory`. If you `cp` the scripts into your own app, copy `.gitattributes` (or its `*.sh text eol=lf` rule) along with them.

---

## Coordinate Transforms

MediaPipe returns landmarks in the raw camera-sensor frame coordinate space (normalized 0–1). The native plugins on both platforms intentionally do NOT pass `ImageProcessingOptions` with rotation — the TypeScript layer handles it, with a per-platform branch.

### iOS

The front camera buffer arrives in landscape-right orientation, **pre-mirrored by the OS**. To get a portrait-display coordinate with head at top:

```typescript
const portraitX = lm.y;      // 90° CW transpose
const portraitY = lm.x;
```

After the rotation, MediaPipe's `left_*` landmarks visually appear on the user's *right* side (because the front camera mirror inverts L/R from the user's POV). So the COCO label table swaps L/R to compensate — MediaPipe's `left_wrist` (index 15) becomes COCO `right_wrist`, etc. See [`MEDIAPIPE_TO_COCO_IOS`](#mediapipe--coco-mapping) below.

### Android

CameraX delivers the front camera buffer in the **opposite vertical orientation** from iOS, and is **NOT pre-mirrored**. So:

```typescript
const portraitX = lm.y;      // 90° CW transpose
const portraitY = 1 - lm.x;  // Y-flip to compensate for CameraX vertical orientation
```

Because the buffer isn't pre-mirrored, MediaPipe's L/R labels already match the user's body — use the natural (non-swapped) [`MEDIAPIPE_TO_COCO_ANDROID`](#mediapipe--coco-mapping) table.

### Hands

Hand landmarks live in the **same** raw camera coordinate space as pose landmarks — both come back from MediaPipe in normalized 0–1 sensor coordinates with no rotation applied. So the same per-platform transform applies to both:

```typescript
const portraitX = lm.y;
const portraitY = Platform.OS === 'android' ? 1 - lm.x : lm.x;
```

If you're rendering hands on top of pose (e.g. drawing a finger overlay on a person's wrist), apply the rotation once per landmark and they'll line up. If they don't, the most likely cause is rotating pose but not hands (or vice versa).

### Cross-platform mapping function

This is exactly what AI-PEER's `front-end/AI-PEER/src/vision/VisionService.ts` does at runtime:

```typescript
import { Platform } from 'react-native';

export function mapMediaPipeToPose(landmarks: MediaPipeLandmark[]): Pose | null {
  if (!landmarks || landmarks.length < 33) return null;

  const isAndroid = Platform.OS === 'android';
  const labelTable = isAndroid ? MEDIAPIPE_TO_COCO_ANDROID : MEDIAPIPE_TO_COCO_IOS;

  const keypoints = labelTable.map(([mpIndex, name]) => {
    const lm = landmarks[mpIndex];
    return {
      name,
      x: lm.y,
      y: isAndroid ? 1 - lm.x : lm.x,
      confidence: lm.visibility ?? 0.5,
      z: lm.z,
      visibility: lm.visibility ?? 0.5,
    };
  });

  const average_confidence = keypoints.reduce((sum, kp) => sum + kp.confidence, 0) / keypoints.length;
  return { keypoints, timestamp: Date.now(), confidence: average_confidence };
}
```

---

## MediaPipe → COCO mapping

Most consumers want to project MediaPipe's 33 landmarks down to a COCO-17 keypoint set (the standard format used by pose-based downstream models — analytics, action classification, etc.). Both label tables, verbatim from AI-PEER:

### iOS — left/right swapped (compensates for front camera mirror)

```typescript
const MEDIAPIPE_TO_COCO_IOS: Array<[number, string]> = [
  [0,  'nose'],
  [2,  'right_eye'],     // MediaPipe "left" = user's right after mirror correction
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
```

### Android — natural left/right (CameraX is not pre-mirrored)

```typescript
const MEDIAPIPE_TO_COCO_ANDROID: Array<[number, string]> = [
  [0,  'nose'],
  [2,  'left_eye'],
  [5,  'right_eye'],
  [7,  'left_ear'],
  [8,  'right_ear'],
  [11, 'left_shoulder'],
  [12, 'right_shoulder'],
  [13, 'left_elbow'],
  [14, 'right_elbow'],
  [15, 'left_wrist'],
  [16, 'right_wrist'],
  [23, 'left_hip'],
  [24, 'right_hip'],
  [25, 'left_knee'],
  [26, 'right_knee'],
  [27, 'left_ankle'],
  [28, 'right_ankle'],
];
```

A few things to note about the indices:

- The eye landmark uses MediaPipe's central eye (`2`/`5`), not the `_inner` (`1`/`4`) or `_outer` (`3`/`6`) variants. MediaPipe defines three landmarks per eye for facial-expression workloads; for pose tracking, the central one is the canonical choice.
- Confidence falls back to `lm.visibility ?? 0.5` — MediaPipe's `visibility` is `Optional<Float>` and may be absent for occluded landmarks.
- The 16 hand landmarks (17–22 + 29–32: pinky/index/thumb finger tips, heels, foot indices) are dropped because COCO-17 doesn't have slots for them. If you need them, add additional rows to your own table.

---

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

---

## Requirements

- React Native 0.81+
- react-native-vision-camera 4.7+
- react-native-worklets-core 1.6+
- **iOS:** 15.0+, Xcode 16+
- **Android:** API 24+, Kotlin 1.9+

---

## Roadmap

This package currently ships as a "drag the files into your app" install model — no autolinking. That's a deliberate first step (it sidesteps every CocoaPods/gradle autolinking bug we hit while building it), but there's room to make it more ergonomic. Open contributions welcome on:

- **Generalize `ios/PoseLandmarkerPlugin.m`** so it doesn't ship with `AIPEER-Swift.h` hardcoded — replace with a `<YOUR_APP>-Swift.h` placeholder + clear comment
- **Ship as a real autolinked RN library** — CocoaPods podspec + gradle module — so the install model becomes pure `npm install` instead of "copy native files in"
- **Extract a `src/` TypeScript module** (types, hook, COCO mapper) so consumers can `import { useMediaPipePose }` instead of copy-pasting from `example/`
- **CHANGELOG.md** tracking version-to-version contract changes (e.g. the 0.1 → 0.2 return-shape break documented above)
- **Minimal runnable example app** (Expo bare workflow) showing the plugin end-to-end with on-screen pose + hand landmark rendering
- **MediaPipe Hand Landmarks reference table** in this README, mirroring the existing 33-pose table

---

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- Developed inside the [AI-PEER](https://github.com/munishbp/AI-PEER) research project (fall prevention for older adults via on-device pose estimation and exercise-form coaching)
- [Google MediaPipe](https://ai.google.dev/edge/mediapipe) for the Pose Landmarker model and SDK
- [VisionCamera](https://github.com/mrousavy/react-native-vision-camera) by Marc Rousavy for the frame processor plugin architecture
- Inspired by [Lukasz Kurant's hand landmarks tutorial](https://medium.com/@lukasz.kurant/high-performance-hand-landmark-detection-in-react-native-using-vision-camera-and-skia-frame-9ddec89362bc)
