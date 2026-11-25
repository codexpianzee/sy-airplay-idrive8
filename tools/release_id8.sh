#!/bin/sh
# Builds this repository's MGU Store release in dist/release/ (catalog.json and its assets):
#   jap_airplay8    AirPlay for iDrive 8, a source package the head unit builds (kit/tools/build.py --hmi ID8)
#   jap-airplay-d   its service: airplayd.js and h4m4d's receiver airplay-rx 1.0.0, taken from his published release
#                   (github.com/noth4m4d/mgu-hamadstools, release "catalog") and checked against the sha256 pinned here
# Usage: MGU_STORE=<a clone of github.com/robertnisipeanu/mgu-store> tools/release_id8.sh
# Needs curl, tar, node, python3, git.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
: "${MGU_STORE:?set MGU_STORE to a clone of github.com/robertnisipeanu/mgu-store (its deploy/hu packs the tool kit)}"
dl=$root/build/upstream
mkdir -p "$dl"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fetch() {    # url sha256 file
    if [ ! -f "$3" ] || [ "$(sha "$3")" != "$2" ]; then curl -fsSL --retry 3 -o "$3.part" "$1" && mv "$3.part" "$3"; fi
    [ "$(sha "$3")" = "$2" ] || { echo "release_id8.sh: sha256 mismatch for $1" >&2; exit 1; }
}
take() {     # tgz member sha256 out
    tar -xzf "$1" -O "$2" > "$4"
    [ "$(sha "$4")" = "$3" ] || { echo "release_id8.sh: $2 in $1 is not the pinned one" >&2; exit 1; }
}
fetch "https://github.com/noth4m4d/mgu-hamadstools/releases/download/catalog/airplay-rx@1.0.0.tgz" \
    b4ada38b813ee1e4f489583eb569d540db294ae2f466b30142136717aab5b36c "$dl/airplay-rx@1.0.0.tgz"
d=$root/native/jap-airplay-d
mkdir -p "$d/build"
take "$dl/airplay-rx@1.0.0.tgz" files/airplay-rx 9f7b2963deb0cd80f84a3e827c632efeeecb0c33bc45bf2c0e86f3ac3c242272 "$d/build/airplay-rx"
chmod 755 "$d/build/airplay-rx"

# BMW's oap-sdk is in no file of the release: the head unit links the app against the SDK of an app on the car
if [ ! -f "$root/oap-sdk/index.js" ]; then
    mkdir -p "$root/oap-sdk"
    echo "module.exports = {}; // placeholder: no package of this repository's release holds an oap-sdk" > "$root/oap-sdk/index.js"
    echo '{"name":"oap-sdk","version":"0.0.0-placeholder"}' > "$root/oap-sdk/package.json"
fi
cd "$root"
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct 2>/dev/null || echo 0)}
export SOURCE_DATE_EPOCH
python3 kit/tools/build.py --hmi ID8 jap_airplay
node kit/tools/test_node8.js >/dev/null
node kit/tools/test_runtime.js >/dev/null
node kit/tools/test_airplay8.js >/dev/null
node native/jap-airplay-d/test/test_airplayd.js >/dev/null
MGU_STORE="$MGU_STORE" node kit/tools/test_mgu8.js | tail -1 | grep -q '^mgu8: all ok$' || { echo "release_id8.sh: kit/tools/test_mgu8.js did not pass (or was skipped)" >&2; exit 1; }

node "$MGU_STORE/deploy/hu" artifact "$d" --out "$d/dist"
tag=${RELEASE_TAG:-catalog}
python3 tools/release.py --base "https://github.com/${GITHUB_REPOSITORY:-trnaslan/airplay-idrive8}/releases/download/$tag/"
echo "release_id8.sh: upload every file of dist/release/ to the GitHub release tagged \"$tag\""
