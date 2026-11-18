# KomaStudio notices

- KomaStudio source: see `LICENSE` (Apache 2.0). The original artist mannequins are provided under CC0 as specified in their VRM metadata. The dashboard, starter artwork and still photo example are generated studio assets. The sample photo is synthetic and is not sent to a service.
- React, React DOM and Scheduler: copyright Meta Platforms, Inc. and affiliates, MIT. Three.js: MIT. pixiv's three-vrm: MIT. Lucide: ISC and Feather-derived MIT. Their license texts are included in the build's `licenses/` directory.
- Inter and Outfit: SIL Open Font License 1.1. Their OFL texts are included with the bundled fonts.
- AndroidX WebKit, Activity, Core, annotations and the Kotlin standard library: Apache 2.0.
- MediaPipe Tasks Vision and the bundled MediaPipe Task model packages: Google / MediaPipe. The runtime is Apache 2.0, including the SIMD and non-SIMD WASM builds. The glue's stderr routing sends the successful XNNPACK initialization message to the info console; other error output is unchanged.

## Model provenance

The bundles are the unchanged Google MediaPipe float16 v1 assets. The app reads them locally; these links are for provenance and are not runtime dependencies.

| File | Original distribution | SHA-256 |
| --- | --- | --- |
| `pose_landmarker_lite.task` | [Google MediaPipe model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `hand_landmarker.task` | [Google MediaPipe model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
