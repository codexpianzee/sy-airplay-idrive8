'use strict';
/**
 * SY AirPlay for iDrive 8 - an iPhone's screen on the central display by AirPlay screen mirroring.
 * Design: the SY Car Data (M Track) look - dark track background, amber accent, white text.
 * EXPERIMENTAL FORK of trnaslan/airplay-idrive8: the picture stays up while driving too (the
 * "Parked only" setting, off by default here, hides it again; it acts at once, also while moving -
 * the upstream latch that kept the setting from counting until the car had stood still once is
 * removed).
 *
 * The receiver is h4m4d's airplay-rx (UxPlay's AirPlay library), run by the service sy-airplay-d
 * (native/sy-airplay-d/airplayd.js) only while this app's screen is up. This app:
 *   - keeps it on: it touches WANT (/dev/shm/mgu-sy-airplay-want) about once a second while VIEW is visible; the service
 *     starts airplay-rx and opens the car Wi-Fi's firewall while that file is fresh, and stops both a few seconds after;
 *   - shows the phone's picture: airplay-rx writes the decoded frames to /dev/shm/mgu-video-sy-airplay (mgu-render's MGVF,
 *     the same as MeTube's decoder) and the renderer draws the newest one in this app's video op;
 *   - reads airplay-rx's status (/dev/shm/mgu-sy-airplay-status.json) and the service's (/dev/shm/mgu-sy-airplay-d.json).
 *
 * VIEW: while nothing is mirrored, how to connect (with the name the iPhone lists) and the state; once the iPhone
 * mirrors, its picture over the whole app area, fitted - in this experimental build also while driving; with the
 * setting "Parked only" on, a notice instead. A tap on the picture shows a bar (state, Back to the steps) for a
 * few seconds.
 *
 * Linked on the head unit (Node 8: no newer syntax).
 */
const fs = require('fs');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { PAGE } = require('./kit/display');
const { listSheet } = require('./kit/sheet');
const Parked = require('./kit/parked');

const W = PAGE.w, H = PAGE.h;                 // iDrive 8: 2080 x 520
const TOP = 38;
const VID = 1;
const VPATH = process.env.AP8_VIDEO || '/dev/shm/mgu-video-sy-airplay';
const WANT = process.env.AP8_WANT || '/dev/shm/mgu-sy-airplay-want';
const RX_STATUS = process.env.AP8_RX_STATUS || '/dev/shm/mgu-sy-airplay-status.json';
const D_STATUS = process.env.AP8_D_STATUS || '/dev/shm/mgu-sy-airplay-d.json';
const STALE_MS = 5000, BAR_MS = 4000, HINT_MS = 12000;
const LIT = { literal: true }, LITB = { literal: true, font: 'bold' };
// SY design (SY Car Data / M Track): dark track background, amber accent, white text, red errors
const C = { bg: '#16191e', card: '#1e222a', text: '#f2f2f2', dim: '#9aa3b2', accent: '#ffb020', ok: '#7ee07e', warn: '#ffd27a', err: '#ff3b30' };

process.on('uncaughtException', (e) => { try { mgu.log.error('uncaught', e); } catch (x) { /* nothing left to log with */ } });

function readJson(file) {
    try {
        const st = fs.statSync(file);
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        j._age = Date.now() - st.mtime.getTime();
        return j;
    } catch (e) { return null; }
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const parked = Parked.watch(ctx, log, { strict: true });
        // EXPERIMENTAL FORK: "Parked only" is off by default and acts at once, also while moving - the
        // picture stays up while driving. Upstream latched the off state until the car had stood still
        // once, so a press while moving could not bring the picture up; that latch is removed here.
        // The setting on hides the picture while moving again, at once too.
        const blocked = () => parked.moving() && settings.get('parkedOnly') !== false;

        /* ---------- keep the receiver on while VIEW is up ---------- */
        const up = () => ui.isVisible('VIEW');
        function touchWant() {
            if (!up()) return;
            try { fs.writeFileSync(WANT, String(Date.now())); } catch (e) { log.warn('want: ' + e.message); }
        }
        setInterval(touchWant, 1000);
        ui.onVisible((name, v) => { if (name === 'VIEW' && v) { touchWant(); dirty = true; } });

        /* ---------- the receiver's state ---------- */
        let rx = null, svc = null, wasMirroring = false, mirrorT = 0, full = false, barUntil = 0, dirty = true;
        function poll() {
            rx = readJson(RX_STATUS);
            if (rx && rx._age > STALE_MS) rx = null;
            svc = readJson(D_STATUS);
            if (svc && svc._age > STALE_MS) svc = null;
            const m = !!(rx && rx.mirroring && rx.on !== false);
            if (m && !wasMirroring) {
                mirrorT = Date.now();
                if (settings.get('autoShow') !== false) full = true;
            }
            if (!m) full = false;
            wasMirroring = m;
            if (ctx.status) ctx.status('Service (sy-airplay-d): ' + (svc ? svc.state + (svc.err ? ' - ' + svc.err : '') : 'not running - is the AirPlay service installed? (the Store, Tools)'));
            sync();
            dirty = true;
        }
        setInterval(() => { try { poll(); } catch (e) { log.error('poll', e); } }, 500);

        /* ---------- the video file, named to the renderer (again when airplay-rx made a new one) ---------- */
        let ino = null, videoShown = false;
        const gpu = () => (ctx.display && ctx.display.gpu && ctx.display.gpu.rich ? ctx.display.gpu : null);
        function sync() {
            const want = full && up() && !blocked() && !!(rx && rx.mirroring && rx.w);
            let cur = null;
            if (want) { try { const st = fs.statSync(VPATH); cur = st.isFile() ? st.ino : null; } catch (e) { cur = null; } }
            const g = gpu();
            if (g) {
                if (!cur || cur !== ino) g.dropVideo(VID);
                if (cur) g.video(VID, VPATH);
            }
            ino = cur;
            videoShown = !!(cur && g);
        }

        /* ---------- what the state says, in one line ---------- */
        function line() {
            if (!svc) return { t: 'SY AirPlay servisi çalışmıyor - MGU Store > Tools: "SY AirPlay service (iDrive 8)" kurulu mu?', c: C.err };
            if (svc.state === 'failed') return { t: 'Alıcı başlatılamadı: ' + (svc.err || 'bilinmeyen hata'), c: C.err };
            if (!rx) return { t: 'Alıcı başlatılıyor...', c: C.warn };
            if (rx.mirroring) return { t: (rx.client || 'iPhone') + ' yansıtıyor' + (rx.fps ? ' · ' + Math.round(rx.fps) + ' fps' : '') + (blocked() ? ' · sürüş sırasında görüntü gizli' : ''), c: C.ok };
            if (rx.connections > 0) return { t: 'iPhone bağlandı, görüntü bekleniyor...', c: C.warn };
            return { t: 'Hazır - iPhone bekleniyor', c: C.ok };
        }
        const carName = () => (rx && rx.name) || 'BMW xxxxx';

        /* ---------- the steps (nothing mirrored, or Back pressed) ---------- */
        function drawSteps(cv) {
            G.frame(cv, ctx.theme(), [], -1);
            const x0 = 60, y0 = TOP + 40;
            // the M Track header (SY Car Data): the name, an amber bar under it
            cv.text('SY AIRPLAY', x0, y0 + 40, 44, C.text, LITB);
            cv.fillRect(x0, y0 + 52, 130, 6, C.accent);
            const s = line();
            cv.circle(x0 + 10, y0 + 82, 9, s.c);
            cv.text(s.t, x0 + 32, y0 + 92, 26, s.c, LIT);
            const steps = [
                'iPhone\'da CarPlay bağlantısını kes.',
                'iPhone\'u arabanın Wi-Fi ağına bağla (Ayarlar > Wi-Fi).',
                'Denetim Merkezi > Ekran Yansıtma > "' + carName() + '"',
                'Ses: iPhone\'un ses çıkışını BMW (Bluetooth) olarak bırak.',
            ];
            const bx = x0, bw = W - 2 * x0 - 420;
            let y = y0 + 140;
            steps.forEach((t, i) => {
                cv.roundRect(bx, y, bw, 58, 14, C.card);
                cv.circle(bx + 34, y + 29, 18, C.accent);
                cv.text(String(i + 1), bx + 34, y + 38, 24, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                cv.text(t, bx + 66, y + 38, 24, C.text, LIT);
                y += 70;
            });
            // the buttons on the right: the picture (while mirroring), the settings
            const px = W - x0 - 380, pw = 380;
            const btn = (yy, label, on, run, key) => {
                cv.roundRect(px, yy, pw, 70, 35, on ? C.accent : '#ffffff14');
                cv.text(label, px + pw / 2, yy + 45, 26, on ? '#ffffff' : C.dim, { literal: true, font: 'bold', align: 'center' });
                if (run) cv.target(px, yy, pw, 70, run, key, 35);
            };
            const can = !!(rx && rx.mirroring);
            btn(y0 + 140, 'Ekranı göster', can, can ? () => { full = true; barUntil = Date.now() + BAR_MS; sync(); dirty = true; } : null, 'show');
            btn(y0 + 230, 'Ayarlar', true, () => { ctx.sheet(listSheet(settings, null, { version: mgu.SPEC.version })); return null; }, 'settings');
            cv.text('AirPlay protokolü: UxPlay · alıcı: h4m4d (airplay-rx) · GPL-3.0', W - x0, y0 + 360, 18, C.dim, { literal: true, align: 'right' });
        }

        /* ---------- the phone's picture, over the whole app area ---------- */
        function drawFull(cv) {
            const pl = cv.place, s = pl.scale, SW = pl.w / s, SH = pl.h / s, dx = pl.ox / s, dy = pl.oy / s;
            cv.chrome = null;
            void cv.extra;
            const tg = (x, y, w, h, run, key, r) => cv.target(x - dx, y - dy, w, h, run, key, r);
            cv.xf(1, 0, 0).fillRect(0, 0, pl.w, pl.h, '#000000');
            const now = Date.now();
            if (blocked()) {
                cv.text('Park halindeyken iPhone ekranı burada görünür', pl.w / 2, pl.h / 2, 40, '#ffffff', { literal: true, font: 'bold', align: 'center' });
            } else if (videoShown) {
                cv.video(VID, 0, 0, pl.w, pl.h, 0);   // fitted, aspect kept (a portrait iPhone: black at the sides)
            } else {
                cv.text('Görüntü bekleniyor...', pl.w / 2, pl.h / 2, 40, '#ffffff', { literal: true, font: 'bold', align: 'center' });
            }
            // the first seconds: where the sound goes (the receiver takes none)
            if (videoShown && now - mirrorT < HINT_MS) {
                const bw = 1300, bh = 76, bx = (pl.w - bw) / 2, by = pl.h - bh - 30;
                cv.roundRect(bx, by, bw, bh, 20, '#000000c8');
                cv.text('Ses için iPhone\'da çıkışı BMW (Bluetooth) seç', pl.w / 2, by + 50, 30, '#ffffff', { literal: true, align: 'center' });
            }
            // a tap: the bar (state, Back) for a few seconds
            if (now < barUntil) {
                const bh = 110;
                cv.fillRect(0, 0, pl.w, bh, '#000000b4');
                cv.roundRect(30, 20, 220, 70, 35, '#ffffff22');
                cv.text('‹ Geri', 140, 66, 30, '#ffffff', { literal: true, font: 'bold', align: 'center' });
                const s0 = line();
                cv.text(s0.t, 290, 66, 30, s0.c, LIT);
                cv.xf(s, pl.ox, pl.oy);
                tg(30 / s, 20 / s, 220 / s, 70 / s, () => { full = false; sync(); dirty = true; }, 'back', 35 / s);
            } else cv.xf(s, pl.ox, pl.oy);
            tg(0, 0, SW, SH, () => { barUntil = Date.now() + BAR_MS; dirty = true; }, 'tap', 0);
        }

        if (ctx.onBack) ctx.onBack(() => { if (full) { full = false; sync(); dirty = true; return true; } return false; });

        let last = null, lastT = 0;
        function render() {
            const now = Date.now();
            if (!last || dirty || now - lastT > 250) {
                dirty = false; lastT = now;
                const cv = ctx.canvas(W, H).clear(C.bg);
                if (full && cv.own && cv.place && cv.place.full) drawFull(cv);
                else drawSteps(cv);
                last = cv;
            }
            return ui.image('VIEW_GFX', last);
        }
        poll();
        touchWant();
        ctx.loop('VIEW', 10, render);
        log.info('airplay app started');
    },
});
