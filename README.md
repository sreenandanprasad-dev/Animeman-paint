# KomaStudio

An offline-first Android illustration studio and pose reference tool. KomaStudio packages a Vite/React frontend, an HTML Canvas 2D editor, Three.js/three-vrm, and MediaPipe still-image inference in a hardware-accelerated Android WebView. There is no camera permission, account, server, or model download on Android.

**Install:** Open [`release/KomaStudio.apk`](release/KomaStudio.apk) on Android 13 and install it from the device's file manager. If prompted, allow that file manager to install apps from this source. An up-to-date Android System WebView is recommended for WebGL 2 and WASM. The APK is signed with a local release certificate; future upgrades must be signed with the same key. Use your own long-lived signing key for distribution.

## Working in the studio

- **Home:** Quick Draw starts a 1080 × 1520 canvas with a baked blue figure guide. Custom Canvas accepts 256–3072 px on each side, including transparent paper. Starter studies can be opened and edited. Projects, layers, thumbnails and figure state are stored in IndexedDB on this device.
- **Draw:** Ink and pencil, four anime cel brushes, scanline fill, HSV and swatches, selection and layer transforms. Two-finger pinch pans, zooms and rotates. Two-finger tap undoes, three-finger tap redoes, and a 460 ms hold samples color. The floating **Ref** window samples any loaded image. In Layers you can adjust compositing or use the baked figure as a separate guide. Export PNG excludes the reference by default.
- **Pose:** Pose three included 6.8/7.2/2.8-head mannequins with editable hands and five shape targets, or import a self-contained `.vrm`/`.glb` with embedded, uncompressed geometry and textures. Named humanoid bones are needed for bone/IK editing; unrigged `.glb` files still work as visual references. Gizmo **Move** works on VRM hips or hand/foot IK targets. **Use** bakes a transparent reference at up to 1024 px; **Ink** overlays the current drawing. Pose JSON stores a named rig pose, shape, lights and camera, not model binaries.
- **Photo:** Pick a full-body image, or try the local example. MediaPipe reduces the image to ≤960 px and detects one body and up to two hands. Check the skeleton, switch **Mirror L⇄R** or **Hands**, then apply. The rig starts from its rest state before solving; applying can be undone. Hidden or foreshortened joints are an estimate and can be adjusted in Pose Studio.

## Web build and verification

Requirements: Node.js 22 and npm. Python 3 is needed only for regenerating figures or packaging/verifying Android.

```sh
npm ci
npm run dev

npm test                  # raster, pose metadata and rig structure
npm run build             # production bundle in dist/; includes local WASM and task files
npm run test:mobile       # Playwright against the production bundle
npm run preview           # browse the production build
```

The production browser version precaches the bundle for offline reloads once its service worker is installed. The APK loads the same bundle from `WebViewAssetLoader`, so it can start offline on the first launch without a service worker.

`test:mobile` checks a 390 × 844 touch viewport, canvas acceleration flags and DPR caps, the three-blit stroke path, uniform cel opacity, gesture undo/redo, both eyedroppers, IndexedDB and PNG export, and offline MediaPipe inference, pose undo/redo and bake. It writes screenshots under `artifacts/`. Headless Linux x86-64 uses Chromium with SwiftShader; flags and rendering architecture were checked, not frame times on a physical Android GPU. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a different installed Chromium. To regenerate the built-in art mannequins and Quick Draw bake, use `npm run models`, `npm run build`, `npm run bake:starter`, then rebuild.

## Android release

Use JDK 17, Gradle 8.2+, Android SDK platform 33, and SDK Build-Tools 33.0.2. The shell targets Android 13 (API 33) with minimum API 26. Picking uses AndroidX `PickVisualMedia` and `OpenDocument`. PNG saving uses Scoped Storage on API 29+, with document-provider saving on older versions. Sharing grants temporary read access to only the exported file.

After setting `ANDROID_HOME`, `KOMA_KEYSTORE`, `KOMA_STORE_PASSWORD`, and optionally `KOMA_KEY_ALIAS` and `KOMA_KEY_PASSWORD` in your local environment:

```sh
npm ci
npm run android:release
```

The script builds and aligns the unsigned package, signs it with APK signature schemes v2/v3, verifies alignment and signatures, and checks the APK's packaged web assets and native class definitions. Output: `release/KomaStudio.apk`.

In a Linux x86-64 runner without a full Android SDK, use `scripts/bootstrap-android-linux.sh` to prepare checksum-pinned AOSP tools and set `KOMA_TOOLS_DIR` to its output directory before running the same release command. This path uses the API 33 SDK stubs, `aapt2`, `javac`, D8, `zipalign`, and `apksigner` with the same native sources and packaged web bundle.

A physical Android device or emulator is required to verify the actual system pickers, OS insets and MediaStore/share UI. `npm run test:apk-web` runs the APK’s actual assets in Chromium under the asset origin and CSP, with a mock export bridge; the OS system surfaces are not exercised by Chromium.
