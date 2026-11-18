#!/usr/bin/env bash
# Bootstrap the official tool/class binaries from public AOSP mirrors for a constrained Linux x86-64 runner.
set -euo pipefail
DEST=${1:-${TMPDIR:-/tmp}/komastudio-android-tools}
mkdir -p "$DEST"; cd "$DEST"
AOSP='https://api.github.com/repos/msft-mirror-aosp/platform.prebuilts.sdk/contents'
JDK='https://api.github.com/repos/msft-mirror-aosp/platform.prebuilts.jdk.jdk17/contents/linux-x86/jmods'
ANDX="$AOSP/current/androidx/m2repository/androidx"
fetch() {
  local url=$1 file=$2 hash=$3
  if ! echo "$hash  $file" | sha256sum -c --status 2>/dev/null; then
    curl -fsS --retry 2 -H 'Accept: application/vnd.github.raw+json' "$url" -o "$file"
  fi
  echo "$hash  $file" | sha256sum -c
}
fetch https://api.github.com/repos/Sable/android-platforms/contents/android-33/android.jar android.jar 4fade8d5e04130bd8ccd74d5fec6c86b01ad75c3ee877ccc5d660255c4c78646
fetch "$AOSP/tools/linux/bin/aapt2" aapt2 0f4474300b737e9bf68fcb3cbb3338c958e51899e3be93c6f429b3aae0ca48df
fetch "$AOSP/tools/linux/bin/zipalign" zipalign db322ca007a4ceac0e34688ad896a6ba95166334324c3d8c9db30c4e73d6cf1b
mkdir -p lib64
fetch "$AOSP/tools/linux/lib64/libc++.so" lib64/libc++.so a7292b027ec262cefed580771f063f12d06bf9f40ccd50b3d1f57ffedc1d962e
fetch "$AOSP/tools/linux/lib/d8.jar" d8.jar 875fab053a6d1bce99751d7a529fa7f80e408550275a2919d76fa4cea56d5819
fetch "$AOSP/tools/linux/lib/apksigner.jar" apksigner.jar 9469c60e5e40fc5c44a2f2338509cb6600cdf065e9b50f9fa3ca6c5be5bae6a9
fetch "$ANDX/webkit/webkit/1.12.0-alpha02/webkit-1.12.0-alpha02.aar" webkit.aar 215abcebf78fdf213b7ef29bf08a65945ebc44076240e205e5a7cb78873c076a
fetch "$ANDX/activity/activity/1.11.0-alpha01/activity-1.11.0-alpha01.aar" activity.aar 3d51a9f1b912666f1eee05c08ff75f8858901f76b1cb7b33dd49f2349cd291a7
fetch "$ANDX/core/core/1.16.0-beta01/core-1.16.0-beta01.aar" core.aar 45566ff71b718cf42e4a96c624b92d074c017de5518ca0938aff32435505fd64
fetch "$ANDX/annotation/annotation-jvm/1.9.0-rc01/annotation-jvm-1.9.0-rc01.jar" annotation.jar e92f33fc2832a3debf9e56afa9bdb86715d2d1ae88f61887a548515827d24cc5
fetch https://api.github.com/repos/aosp-mirror-neo/platform_external_kotlinc/contents/lib/kotlin-stdlib.jar kotlin-stdlib.jar f31cc53f105a7e48c093683bbd5437561d1233920513774b470805641bedbc09
fetch "$JDK/jdk.compiler.jmod" jdk.compiler.jmod ab7e0f24c37116baa6e1a526c1927b266761b2338f83fc646068a2c827e88ce8
fetch "$JDK/java.compiler.jmod" java.compiler.jmod 62d6896931336011203ff585dfee586266f2db46617ed5aaba693f733b766f8f
WHEEL=jdk4py-17.0.9.2-0-py3-none-manylinux1_x86_64.whl
if [[ ! -f $WHEEL ]]; then python3 -m pip download --no-deps jdk4py==17.0.9.2; fi
echo "d9e5235e110182b9291ea09da413309b19dcf12d104d9aa3624abe210e593d7c  $WHEEL" | sha256sum -c
unzip -oq "$WHEEL" -d java
for mod in jdk.compiler java.compiler; do
  python3 - "$mod" <<'PY'
import sys,zipfile
m=sys.argv[1]
with zipfile.ZipFile(m+'.jmod') as z:
    z.extractall(m, [x for x in z.namelist() if x.startswith('classes/')])
PY
done
cat >javac <<'WRAPPER'
#!/usr/bin/env bash
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
exec "$HERE/java/jdk4py/java-runtime/bin/java" -Xbootclasspath/a:"$HERE/jdk.compiler/classes:$HERE/java.compiler/classes" com.sun.tools.javac.Main "$@"
WRAPPER
ln -sfn java/jdk4py/java-runtime/bin/java java-bin
ln -sfn java/jdk4py/java-runtime/bin/keytool keytool
chmod +x aapt2 zipalign javac
printf '\nKOMA_TOOLS_DIR=%s\n' "$PWD"
