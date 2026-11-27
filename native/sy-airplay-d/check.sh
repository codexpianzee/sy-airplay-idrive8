#!/bin/sh
# mgu-deploy "check": the head unit's Node (8) loads the service, and airplay-rx finds every library it links, with
# the service's libdns_sd link (iDrive 8 has libdns_sd.so.1096 where airplay-rx asks for .765). A car without one of
# them refuses the install here, with the library named, instead of failing later.
set -eu
d=$(cd "$(dirname "$0")" && pwd)
shim=$(mktemp -d)
trap 'rm -rf "$shim"' EXIT
lib=$(/usr/bin/node -e "var s=require('$d/airplayd.js').dnssdShim('$shim'); process.stdout.write(s||'')")
missing=$(LD_LIBRARY_PATH="$lib" LD_TRACE_LOADED_OBJECTS=1 /lib/ld-linux-x86-64.so.2 "$d/airplay-rx" 2>&1 | grep 'not found' || true)
if [ -n "$missing" ]; then echo "airplay-rx: missing libraries on this head unit:"; echo "$missing"; exit 1; fi
