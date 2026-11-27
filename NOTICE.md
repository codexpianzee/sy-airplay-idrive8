# Notices

SY AirPlay for iDrive 8 is GPL-3.0-or-later (`LICENSE`).

SY AirPlay is an experimental fork of trnaslan's airplay-idrive8 (GPL-3.0-or-later,
https://github.com/trnaslan/airplay-idrive8), which ports h4m4d's iDrive 7 AirPlay app to iDrive 8. This
fork renames the app and service (SY AirPlay / sy-airplay-d), restyles the app in the SY Car Data (M Track)
design and lets the picture stay up while driving (the "Parked only" setting is off by default and the
upstream latch is removed). The SY Car Data look follows the user's own app
(https://github.com/smhcnyldz26-prog/sy-cardash).

| Part | Licence | Source |
|---|---|---|
| `airplay-rx` (the AirPlay receiver binary, shipped unchanged in the `sy-airplay-d` tool) by h4m4d | GPL-3.0-or-later | https://github.com/noth4m4d/mgu-hamadstools (`airplay/receiver/`, release `catalog`, airplay-rx 1.0.0) |
| inside `airplay-rx`: UxPlay `lib/` (AirPlay protocol, FairPlay handshake, pairing) | GPL-3.0 (parts LGPL-2.1) | https://github.com/FDH2/UxPlay |
| inside `airplay-rx`: FFmpeg 3.4.7 (H.264/HEVC decoding only), libplist 2.6.0 | LGPL-2.1-or-later | as listed in mgu-hamadstools' NOTICE.md |
| the app kit (`kit/`) from MeTube / RideTube | MIT (`kit/LICENSE`) | https://github.com/trnaslan/metube-idrive8, https://github.com/JustAnotherPU/ridetube |
| `tools/release.py`, `tools/release_id8.sh` (adapted) | GPL-3.0-or-later | MeTube / RideTube |

The receiver's complete source and its build script are in mgu-hamadstools' `airplay/receiver/`. It uses, from the head
unit, without shipping them: OpenSSL 1.1 (libcrypto), Apple's mDNSResponder client library (libdns_sd), libva.

BMW's oap-sdk is not included: the head unit supplies it.

AirPlay and iPhone are trademarks of Apple Inc.; BMW and iDrive of BMW AG. This project is not affiliated with or
endorsed by either.
