'use strict';
// AirPlay on iDrive 8 (dist/sy_airplay8, python3 kit/tools/build.py --hmi ID8 sy_airplay): the built app through the
// stubbed head unit on a 2880 x 960 renderer that routes touch, against the status files of a fake service and a fake
// airplay-rx. Checks: the app keeps the receiver on (the want file) only while its screen is up; the steps page and
// its state line (no service, failed, ready); mirroring opens the picture over the whole app area (video op 19, the
// file named to the renderer); a tap shows the bar, Back goes to the steps; driving keeps the picture up
// (experimental fork), the "Parked only" setting hides it while moving; Settings.
// With SHOTS=<folder> each step is also written there as a PNG of the whole screen (kit/tools/surface.js).
//   node kit/tools/test_airplay8.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const stage = path.join(ROOT, 'dist', 'sy_airplay8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 3000);
    while (!fn()) { if (Date.now() > end) throw new Error('timed out: ' + what); await sleep(10); }
}
const quiet = { info() {}, warn() {}, error(m, e) { throw e || new Error(m); }, debug() {} };

async function main() {
    if (!fs.existsSync(path.join(stage, 'source', 'javascript', 'app.js'))) {
        console.log('skip (python3 kit/tools/build.py --hmi ID8 sy_airplay first)');
        return;
    }
    const kitDir = path.join(stage, 'source', 'javascript', 'kit');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(kitDir, 'app-spec.json'), 'utf8')).hmi, 'ID8', 'built for iDrive 8');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap8app-'));
    const f = (n) => path.join(dir, n);
    process.env.MGU_RENDERD_FILE = f('stream.bin');
    process.env.AP8_VIDEO = f('mgu-video-sy-airplay');
    process.env.AP8_WANT = f('want');
    process.env.AP8_RX_STATUS = f('rx.json');
    process.env.AP8_D_STATUS = f('d.json');
    const svc = (o) => fs.writeFileSync(f('d.json'), JSON.stringify(Object.assign({ t: Date.now(), want: true, state: 'running', err: null }, o)));
    const rx = (o) => fs.writeFileSync(f('rx.json'), JSON.stringify(Object.assign({ on: true, name: 'BMW 12345', client: '', connections: 0, mirroring: false, w: 0, h: 0, fps: 0 }, o)));

    const { headUnit } = require('./hu-stub');
    const hu = headUnit(stage, { dataDir: dir, fresh: true, image: () => Promise.resolve(), log: quiet });
    const disp = hu.display;
    let speed = 0, speedH = null;
    hu.ctx.signals = { watch: async (i, n, h) => { if (h && h.statusCarSpeed2) { speedH = h.statusCarSpeed2; speedH({ speedVehicleCentreOfGravity: speed }); } return {}; } };
    const drive = (kmh) => { speed = kmh; speedH({ speedVehicleCentreOfGravity: Math.round(kmh / 0.015625) }); };
    hu.ctx.status = (t) => { disp.appStatus = String(t); };
    hu.start();
    await sleep(50);

    disp.gpu.screen = { w: 2880, h: 960 };
    disp.gpu.touch = true;
    disp.gpu.iterio = true;
    disp._place();
    await hu.ui.open('VIEW');
    await hu.loopFn();
    const pl = disp.place;
    const { surfaceCanvas } = require('./surface');
    let shot = 0;
    const snap = (name) => {
        if (!process.env.SHOTS) return;
        fs.mkdirSync(process.env.SHOTS, { recursive: true });
        const cv = surfaceCanvas(disp.last.frame.words(), disp.place, disp.gpu.screen, kitDir);
        fs.writeFileSync(path.join(process.env.SHOTS, String(++shot).padStart(2, '0') + '-' + name + '.png'), cv.png());
    };
    const tap = async (sx, sy) => {
        const x = (sx - pl.ox) / pl.scale, y = (sy - pl.oy) / pl.scale;
        disp._touch(1, x, y); disp._touch(3, x, y);
        await sleep(20);
    };
    const tapTarget = async (t) => { const k = disp.place.scale; await tap((t.x + t.w / 2) * k + disp.place.ox, (t.y + t.h / 2) * k + disp.place.oy); };
    const target = (key) => disp.pageTargets.find((t) => t.key === key);
    const keys = () => disp.pageTargets.map((t) => t.key).join(' ');
    const texts = () => {   // the text ops' strings are not in the words; read what the app said through its status
        return disp.appStatus || '';
    };
    const videoOp = () => {
        const w = disp.last.frame.words(), fl = new Float32Array(w.buffer, w.byteOffset, w.length);
        for (let i = 0; i + 6 < w.length; i++) if (w[i] === 19 && w[i + 6] === 1 && fl[i + 3] >= 2880 && fl[i + 4] >= 764) return [fl[i + 1], fl[i + 2], fl[i + 3], fl[i + 4]].map(Math.round);
        return null;
    };
    const step = async (ms) => { await sleep(ms || 650); await hu.loopFn(); };

    assert.ok(disp.own(), 'the kit runs the screen');
    // no service: the steps, the status line says so, the want file is touched while the screen is up
    await step();
    assert.ok(fs.existsSync(f('want')) && Date.now() - fs.statSync(f('want')).mtime.getTime() < 2000, 'the want file is fresh while VIEW is up');
    assert.ok(/not running/.test(texts()), 'status: ' + texts());
    assert.ok(target('settings') && !target('show'), 'Settings, no "show" while nothing mirrors: ' + keys());
    snap('no-service');
    console.log('ok   no service: steps page, "' + texts() + '", want file touched');

    // failed start
    svc({ state: 'failed', err: 'airplay-rx stopped (exit 127): libdns_sd.so.765: cannot open shared object file' });
    await step();
    assert.ok(/failed - airplay-rx stopped/.test(texts()), texts());
    snap('failed');

    // ready
    svc({}); rx({});
    await step();
    assert.ok(/running/.test(texts()) && !videoOp(), 'ready, no picture');
    snap('ready');
    console.log('ok   ready: waiting for the iPhone, the steps name "BMW 12345"');

    // the iPhone mirrors: the picture over the whole app area
    fs.writeFileSync(f('mgu-video-sy-airplay'), Buffer.alloc(64));
    rx({ mirroring: true, client: 'iPhone', connections: 1, w: 888, h: 1920, fps: 30 });
    await step();
    await step(50);
    assert.deepStrictEqual(videoOp(), [0, 0, 2880, 764], 'the picture over the app area (fitted by the renderer)');
    assert.strictEqual(disp.gpu.sent.video.get(1), f('mgu-video-sy-airplay'), 'the file named to the renderer');
    assert.ok(target('tap') && !target('back'), 'a tap target, no bar yet: ' + keys());
    snap('mirroring');
    await tapTarget(target('tap'));
    await step(50);
    assert.ok(target('back'), 'a tap shows the bar with Back: ' + keys());
    snap('mirroring-bar');
    await tapTarget(target('back'));
    await step(50);
    assert.ok(!videoOp() && target('show') && !disp.gpu.sent.video.has(1), 'Back: the steps again, the video dropped: ' + keys());
    await tapTarget(target('show'));
    await step(50);
    assert.ok(videoOp(), 'Show: the picture again');
    console.log('ok   mirroring: picture over the area, tap bar, Back to the steps, Show again');

    // driving: "Parked only" off (the default here) - the picture stays up (experimental fork)
    drive(30);
    await step();
    assert.ok(videoOp() && disp.gpu.sent.video.has(1), 'experimental: the picture stays up while driving');
    snap('driving');
    // the setting on: hidden while moving, back when parked
    hu.settings.set('parkedOnly', true);
    await step();
    assert.ok(!videoOp() && !disp.gpu.sent.video.has(1), 'Parked only on: no picture while driving');
    drive(0);
    await step();
    await step(50);
    assert.ok(videoOp(), 'parked again: the picture is back');
    // off again while moving: the picture comes back at once (the upstream latch is gone)
    drive(30);
    await step();
    assert.ok(!videoOp(), 'on again: hidden while driving');
    hu.settings.set('parkedOnly', false);
    await step();
    await step(50);
    assert.ok(videoOp(), 'off takes effect at once, even while moving');
    drive(0);
    await step(50);
    console.log('ok   driving: picture up (experimental); the setting still hides it while moving');

    // the app's screen goes: the want file is no longer touched
    hu.ui.isVisible = () => false;
    const t0 = fs.statSync(f('want')).mtime.getTime();
    await sleep(1300);
    assert.strictEqual(fs.statSync(f('want')).mtime.getTime(), t0, 'not touched while VIEW is hidden');
    console.log('ok   screen closed: the want file goes stale (the service stops the receiver)');
    console.log('airplay8: all ok');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
