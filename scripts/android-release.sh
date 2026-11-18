#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
: "${KOMA_KEYSTORE:?Set KOMA_KEYSTORE to the path of your release keystore.}"
: "${KOMA_STORE_PASSWORD:?Set KOMA_STORE_PASSWORD in your local environment.}"
KOMA_KEY_ALIAS=${KOMA_KEY_ALIAS:-komastudio}
export KOMA_KEY_PASSWORD=${KOMA_KEY_PASSWORD:-$KOMA_STORE_PASSWORD}
[[ -f $KOMA_KEYSTORE ]] || { echo 'Keystore not found.' >&2; exit 1; }
KOMA_KEYSTORE=$(realpath "$KOMA_KEYSTORE")
if [[ ${KOMA_SKIP_WEB_BUILD:-0} != 1 ]]; then npm run build; fi
[[ -f dist/studio-sw.js ]] || { echo 'Build the production web assets first.' >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p release

if [[ -n ${KOMA_TOOLS_DIR:-} ]]; then
  # Standalone SDK build used in restricted CI. See bootstrap-android-linux.sh.
  T=$(realpath "$KOMA_TOOLS_DIR")
  BASE=android/app/src/main
  sed 's/<manifest /<manifest package="studio.koma.app" /' "$BASE/AndroidManifest.xml" > "$TMP/AndroidManifest.xml"
  mkdir -p "$TMP/dex" "$TMP/classes" "$TMP/gen"
  unzip -p "$T/webkit.aar" classes.jar > "$TMP/webkit.jar"
  unzip -p "$T/activity.aar" classes.jar > "$TMP/activity-full.jar"
  unzip -p "$T/core.aar" classes.jar > "$TMP/core-full.jar"
  python3 - "$TMP/activity-full.jar" "$TMP/activity.jar" "$TMP/core-full.jar" "$TMP/core.jar" <<'PY'
import sys, zipfile
# The plain Activity calls the contracts directly; ComponentActivity and its lifecycle are not used.
with zipfile.ZipFile(sys.argv[1]) as src, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as dst:
    for name in src.namelist():
        if name.endswith('.class') and (name.startswith('androidx/activity/result/PickVisualMediaRequest') or name.removeprefix('androidx/activity/result/contract/').startswith(('ActivityResultContract.class', 'ActivityResultContract$','ActivityResultContracts.class','ActivityResultContracts$PickVisualMedia','ActivityResultContracts$OpenDocument.class','ActivityResultContracts$GetMultipleContents'))):
            dst.writestr(name, src.read(name))
# WebViewAssetLoader.Builder uses Core's Pair. Other Core APIs are not used by the shell.
with zipfile.ZipFile(sys.argv[3]) as src, zipfile.ZipFile(sys.argv[4], 'w', zipfile.ZIP_DEFLATED) as dst:
    name='androidx/core/util/Pair.class'
    dst.writestr(name, src.read(name))
PY
  "$T/aapt2" compile --dir "$BASE/res" -o "$TMP/res.zip"
  "$T/aapt2" link --manifest "$TMP/AndroidManifest.xml" -I "$T/android.jar" \
    -A "$ROOT/dist" --java "$TMP/gen" --min-sdk-version 26 --target-sdk-version 33 \
    --version-code 1 --version-name 1.0.0 -o "$TMP/unsigned.apk" "$TMP/res.zip"
  mapfile -d '' SOURCES < <(find "$BASE/java" "$TMP/gen" -name '*.java' -print0)
  "$T/javac" -source 8 -target 8 -Xlint:-options -encoding UTF-8 \
    -classpath "$T/android.jar:$TMP/webkit.jar:$TMP/activity.jar:$TMP/core.jar:$T/kotlin-stdlib.jar:$T/annotation.jar" -d "$TMP/classes" "${SOURCES[@]}"
  mapfile -d '' CLASSES < <(find "$TMP/classes" -name '*.class' -print0)
  "$T/java-bin" -cp "$T/d8.jar" com.android.tools.r8.D8 --release --min-api 26 --lib "$T/android.jar" \
    --output "$TMP/dex" "${CLASSES[@]}" "$TMP/webkit.jar" "$TMP/activity.jar" "$TMP/core.jar" "$T/kotlin-stdlib.jar" "$T/annotation.jar"
  zip -q -j "$TMP/unsigned.apk" "$TMP/dex/"*.dex
  export LD_LIBRARY_PATH="$T/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  ALIGN="$T/zipalign"
  signer() { "$T/java-bin" -cp "$T/apksigner.jar" com.android.apksigner.ApkSignerTool "$@"; }
else
  SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
  : "${SDK:?Set ANDROID_HOME to an SDK with platforms;android-33 and build-tools;33.0.2 installed.}"
  TOOLS=${ANDROID_BUILD_TOOLS:-$SDK/build-tools/33.0.2}
  command -v gradle >/dev/null || { echo 'Install Gradle 8.2+ and JDK 17 or use KOMA_TOOLS_DIR.' >&2; exit 1; }
  # Build the unsigned variant and align it explicitly before signing.
  env -u KOMA_KEYSTORE -u KOMA_STORE_PASSWORD -u KOMA_KEY_PASSWORD gradle -p android :app:assembleRelease
  cp android/app/build/outputs/apk/release/app-release-unsigned.apk "$TMP/unsigned.apk"
  ALIGN="$TOOLS/zipalign"
  signer() { "$TOOLS/apksigner" "$@"; }
fi

"$ALIGN" -f 4 "$TMP/unsigned.apk" "$TMP/aligned.apk"
signer sign --ks "$KOMA_KEYSTORE" --ks-key-alias "$KOMA_KEY_ALIAS" \
  --ks-pass env:KOMA_STORE_PASSWORD --key-pass env:KOMA_KEY_PASSWORD \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out "$TMP/KomaStudio.apk" "$TMP/aligned.apk"
"$ALIGN" -c 4 "$TMP/KomaStudio.apk"
signer verify --verbose --print-certs "$TMP/KomaStudio.apk"
python3 scripts/verify-android-bundle.py "$TMP/KomaStudio.apk" dist
mv "$TMP/KomaStudio.apk" release/KomaStudio.apk
sha256sum release/KomaStudio.apk
