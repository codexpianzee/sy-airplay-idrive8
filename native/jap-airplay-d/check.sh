#!/bin/sh
# mgu-deploy "check": the head unit's Node (8) loads the service, and airplay-rx finds every library it links
# (a car without one refuses the install here, with the library named, instead of failing later).
set -eu
d=$(cd "$(dirname "$0")" && pwd)
/usr/bin/node -e "require('$d/airplayd.js')"
missing=$(LD_TRACE_LOADED_OBJECTS=1 /lib/ld-linux-x86-64.so.2 "$d/airplay-rx" 2>&1 | grep 'not found' || true)
if [ -n "$missing" ]; then echo "airplay-rx: missing libraries on this head unit:"; echo "$missing"; exit 1; fi
