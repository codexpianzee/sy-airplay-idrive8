'use strict';
/*
 * sy-airplay-d - AirPlay screen mirroring for the BMW iDrive 8 head unit (MGU ID8): the service.
 *
 * Runs as root on the head unit's own Node (8: no newer syntax). It keeps h4m4d's AirPlay receiver
 * (airplay-rx, UxPlay's AirPlay library; github.com/noth4m4d/mgu-hamadstools, GPL-3.0-or-later) running only while the
 * AirPlay app is open, and opens the car Wi-Fi's firewall for it meanwhile:
 *
 *   - the app (sy_airplay8) touches WANT (/dev/shm/mgu-sy-airplay-want) about once a second while its screen is up;
 *   - WANT fresh (under WANT_MS old): airplay-rx is started (always-on mode: no -a, this service decides) and the
 *     firewall rules (comment "sy-airplay8") are put in for the car's Wi-Fi interfaces;
 *   - WANT stale: airplay-rx gets SIGTERM (it takes its mDNS adverts down and deletes its video file), the rules go;
 *   - airplay-rx writes the picture to /dev/shm/mgu-video-sy-airplay (mgu-render's MGVF, which the app names to the
 *     renderer) and its own status to /dev/shm/mgu-sy-airplay-status.json; this service writes its own to STATUS.
 *
 * Why a supervisor and not airplay-rx's -a: the receiver as released is built for iDrive 7. Its -a looks for the app
 * under /var/opt/public/oap/oap_* and its firewall rules name the iDrive 7 interface "wlan_bridge"; neither is known
 * to hold on iDrive 8. Here both are found on the car (or set in state/config.json), with no rebuild of the binary.
 *
 * state/config.json (all optional):
 *   { "name": "BMW 12345",          the name the iPhone lists (default: airplay-rx's "auto", the car's Bluetooth name)
 *     "ifaces": ["wlan0"],           the car Wi-Fi's interfaces for the firewall rules (default: found, see ifaces())
 *     "firewall": true,              false: no rules at all (a car whose Wi-Fi lets the ports in already)
 *     "hw": false,                   true: GPU decoding (airplay-rx without -s; the i965 driver of iDrive 7 could not)
 *     "audio": false,                true: also advertise audio (the sound then has no way out: off by default)
 *     "args": [] }                   more arguments for airplay-rx (e.g. ["-d"]: its debug log)
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const env = process.env;
const BASE = env.AP8_BASE || '/var/opt/sy-airplay-d';
const BIN = env.AP8_BIN || path.join(BASE, 'current', 'airplay-rx');
const STATE = env.AP8_STATE || path.join(BASE, 'state');
const LOGDIR = env.AP8_LOGDIR || path.join(BASE, 'log');
const WANT = env.AP8_WANT || '/dev/shm/mgu-sy-airplay-want';
const STATUS = env.AP8_STATUS || '/dev/shm/mgu-sy-airplay-d.json';
const VIDEO = env.AP8_VIDEO || '/dev/shm/mgu-video-sy-airplay';
const RX_STATUS = env.AP8_RX_STATUS || '/dev/shm/mgu-sy-airplay-status.json';
const NFT = env.AP8_NFT || 'nft';
const SYSNET = env.AP8_SYSNET || '/sys/class/net';
const TICK_MS = Number(env.AP8_TICK_MS || 1000);
const WANT_MS = Number(env.AP8_WANT_MS || 5000);
const QUICK_MS = 4000;              // an exit sooner than this after the start is a failed start
const RETRY_MS = Number(env.AP8_RETRY_MS || 15000);  // after two failed starts in a row: wait this long
const LOG_MAX = 1 << 20;
const COMMENT = 'sy-airplay8';
const LIBDIRS = (env.AP8_LIBDIRS || '/usr/lib:/lib').split(':');
const SHIM = env.AP8_SHIM || path.join(BASE, 'lib');
const TCP = [7100, 7101], UDP = [6100, 6101, 7111];   // airplay-rx's ports (CarPlay holds 7000)

function log(msg) { process.stdout.write(new Date().toISOString() + ' ' + msg + '\n'); }

function config() {
    try { return JSON.parse(fs.readFileSync(path.join(STATE, 'config.json'), 'utf8')) || {}; } catch (e) { return {}; }
}

/* ---------- the car Wi-Fi's interfaces ---------- */
// iDrive 7 calls it wlan_bridge; iDrive 8 is not known yet: every interface whose name looks like Wi-Fi or a bridge
// (a rule for an interface that is not there matches nothing, so a wider list does no harm)
const WIFI = /^(wlan|wl|br|ap|uap|mlan|bridge)/;
function ifaces(cfg) {
    if (Array.isArray(cfg.ifaces) && cfg.ifaces.length) return cfg.ifaces.filter((n) => /^[\w.-]{1,15}$/.test(n));
    let names = [];
    try { names = fs.readdirSync(SYSNET); } catch (e) { names = []; }
    const out = names.filter((n) => WIFI.test(n) && /^[\w.-]{1,15}$/.test(n));
    if (out.indexOf('wlan_bridge') < 0) out.push('wlan_bridge');
    return out.sort();
}

/* ---------- libdns_sd ---------- */
// airplay-rx links libdns_sd.so.765 (iDrive 7's mDNSResponder); iDrive 8 has a newer one (libdns_sd.so.1096). The
// client API it uses (DNSServiceRegister, TXTRecord*: unversioned symbols) is the same in both, so a link named .765
// to the car's own library, in a folder of our own put first in LD_LIBRARY_PATH, is all it takes. Nothing in /usr/lib
// is touched. Returns the folder, or null when the car has a .765 itself (or no libdns_sd at all: the loader says so).
const WANT_DNSSD = 'libdns_sd.so.765';
function dnssdShim(dir) {
    const has = (d, n) => { try { fs.statSync(path.join(d, n)); return true; } catch (e) { return false; } };
    if (LIBDIRS.some((d) => has(d, WANT_DNSSD))) return null;
    let best = null;
    LIBDIRS.forEach((d) => {
        let names = [];
        try { names = fs.readdirSync(d); } catch (e) { names = []; }
        names.forEach((n) => {
            const m = /^libdns_sd\.so\.(\d+)$/.exec(n);
            if (m && (!best || Number(m[1]) > best.v)) best = { v: Number(m[1]), p: path.join(d, n) };
        });
    });
    if (!best) return null;
    try { fs.mkdirSync(dir); } catch (e) { /* there */ }
    const link = path.join(dir, WANT_DNSSD);
    let cur = null;
    try { cur = fs.readlinkSync(link); } catch (e) { cur = null; }
    if (cur !== best.p) {
        try { fs.unlinkSync(link); } catch (e) { /* none */ }
        fs.symlinkSync(best.p, link);
    }
    return dir;
}

/* ---------- the firewall ---------- */
function nft(args) { return cp.execFileSync(NFT, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }); }
function family() {
    for (const fam of ['ip', 'inet']) {
        try { nft(['list', 'chain', fam, 'filter', 'input']); return fam; } catch (e) { /* not this one */ }
    }
    return null;
}
function fwClose() {
    for (const fam of ['ip', 'inet']) {
        for (const chain of ['input', 'output']) {
            let text;
            try { text = nft(['-a', 'list', 'chain', fam, 'filter', chain]); } catch (e) { continue; }
            const re = new RegExp('comment "' + COMMENT + '".*# handle (\\d+)', 'g');
            let m;
            while ((m = re.exec(text))) {
                try { nft(['delete', 'rule', fam, 'filter', chain, 'handle', m[1]]); } catch (e) { log('firewall: delete ' + m[1] + ': ' + e.message.split('\n')[0]); }
            }
        }
    }
}
function fwOpen(list) {
    fwClose();
    const fam = family();
    if (!fam) return { ok: false, why: 'no nft filter table (ip or inet) - the ports may be open already' };
    const set = (ports) => '{ ' + ports.join(', ') + ' }';
    let n = 0, errs = [];
    for (const i of list) {
        const rules = [
            ['input', 'iifname', '"' + i + '"', 'tcp', 'dport', set(TCP)],
            ['input', 'iifname', '"' + i + '"', 'udp', 'dport', set(UDP.concat([5353]))],
            ['output', 'oifname', '"' + i + '"', 'udp', 'sport', set(UDP)],
        ];
        for (const r of rules) {
            try {
                nft(['insert', 'rule', fam, 'filter', r[0]].concat(r.slice(1).join(' ').split(' ')).concat(['accept', 'comment', '"' + COMMENT + '"']));
                n++;
            } catch (e) { errs.push(i + ' ' + r[0] + ': ' + e.message.split('\n')[0]); }
        }
    }
    errs.forEach((e) => log('firewall: ' + e));
    return { ok: errs.length === 0, family: fam, rules: n, why: errs[0] || null };
}

/* ---------- the receiver ---------- */
let child = null, childT = 0, quick = 0, holdUntil = 0, lastErr = null, tail = '', restarts = 0, fw = null, list = [];
let state = 'idle', stopping = false;

function logFd() {
    try { fs.mkdirSync(LOGDIR); } catch (e) { /* there */ }
    const f = path.join(LOGDIR, 'airplay-rx.log');
    try { if (fs.statSync(f).size > LOG_MAX) fs.renameSync(f, f + '.1'); } catch (e) { /* none yet */ }
    try { return fs.openSync(f, 'a'); } catch (e) { return 'ignore'; }
}

function start(cfg) {
    try { fs.mkdirSync(STATE); } catch (e) { /* there */ }
    const args = ['-n', typeof cfg.name === 'string' && cfg.name ? cfg.name : 'auto',
        '-k', path.join(STATE, 'airplay.pem'), '-o', VIDEO];
    if (cfg.hw !== true) args.unshift('-s');
    if (cfg.audio !== true) args.unshift('-A');
    if (Array.isArray(cfg.args)) cfg.args.forEach((a) => args.push(String(a)));
    list = ifaces(cfg);
    fw = cfg.firewall === false ? { ok: true, off: true } : fwOpen(list);
    const out = logFd();
    log('start ' + BIN + ' ' + args.join(' ') + ' | firewall ' + (fw.off ? 'off (config)' : (fw.ok ? 'open' : 'NOT open: ' + fw.why)) + ' for ' + list.join(','));
    tail = '';
    const cenv = Object.assign({}, process.env);
    let shim = null;
    try { shim = dnssdShim(SHIM); } catch (e) { log('libdns_sd link: ' + e.message); }
    if (shim) {
        cenv.LD_LIBRARY_PATH = shim + (cenv.LD_LIBRARY_PATH ? ':' + cenv.LD_LIBRARY_PATH : '');
        log('libdns_sd: ' + WANT_DNSSD + ' -> ' + fs.readlinkSync(path.join(shim, WANT_DNSSD)));
    }
    try {
        child = cp.spawn(BIN, args, { stdio: ['ignore', out, 'pipe'], env: cenv });
    } catch (e) {
        child = null; lastErr = 'cannot start ' + BIN + ': ' + e.message; state = 'failed'; failed();
        if (typeof out === 'number') fs.closeSync(out);
        return;
    }
    if (typeof out === 'number') fs.closeSync(out);   // (the child has its own copy)
    childT = Date.now();
    state = 'running';
    const c = child;
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', (s) => {
        tail = (tail + s).slice(-4000);
        try { fs.appendFileSync(path.join(LOGDIR, 'airplay-rx.log'), s); } catch (e) { /* no log */ }
    });
    c.on('error', (e) => { lastErr = 'airplay-rx: ' + e.message; });
    c.on('exit', (code, sig) => {
        if (child !== c) return;
        child = null;
        const was = Date.now() - childT;
        if (stopping) { state = 'idle'; return; }
        // the reason, as the receiver or the loader said it (a missing library, mdnsd not reachable ...)
        const lines = tail.split('\n').map((l) => l.trim()).filter(Boolean);
        const said = lines.filter((l) => / E |error|cannot|failed|not found|No such/i.test(l)).pop() || lines.pop() || '';
        lastErr = 'airplay-rx stopped (' + (sig || 'exit ' + code) + ')' + (said ? ': ' + said.replace(/^[\d:.]+ [IE] /, '') : '');
        log(lastErr);
        if (was < QUICK_MS) failed(); else { quick = 0; state = 'restarting'; }
    });
}
function failed() {
    quick++;
    state = 'failed';
    if (quick >= 2) holdUntil = Date.now() + RETRY_MS;
}
function stop(why) {
    if (child) {
        log('stop (' + why + ')');
        stopping = true;
        state = 'stopping';
        const c = child;
        c.kill('SIGTERM');
        setTimeout(() => { if (child === c) { c.kill('SIGKILL'); } }, 3000);
    }
    if (fw && !fw.off) fwClose();
    fw = null;
}

function fresh() {
    try { return Date.now() - fs.statSync(WANT).mtime.getTime() < WANT_MS; } catch (e) { return false; }
}
// an iPhone mirroring right now (airplay-rx's own status, written while it runs): the receiver stays on even when the
// app's screen is not up (another iDrive screen opened over it): stopping it would end the iPhone's mirroring
function mirroring() {
    try {
        if (Date.now() - fs.statSync(RX_STATUS).mtime.getTime() > WANT_MS) return false;
        return JSON.parse(fs.readFileSync(RX_STATUS, 'utf8')).mirroring === true;
    } catch (e) { return false; }
}

function writeStatus(want) {
    const s = {
        t: Date.now(), want: want, state: state, pid: child ? child.pid : null, err: lastErr, restarts: restarts,
        ifaces: list, firewall: fw ? (fw.off ? 'off' : fw.ok ? 'open (' + fw.family + ', ' + fw.rules + ' rules)' : 'not open: ' + fw.why) : 'closed',
        bin: fs.existsSync(BIN),
    };
    const tmp = STATUS + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(s) + '\n', { mode: 0o644 }); fs.chmodSync(tmp, 0o644); fs.renameSync(tmp, STATUS); } catch (e) { /* /dev/shm full? */ }
}

function tick() {
    const want = fresh() || (!!child && !stopping && mirroring());
    if (want && !child && !stopping) {
        if (Date.now() >= holdUntil) {
            if (state === 'restarting' || state === 'failed') restarts++;
            start(config());
        }
    } else if (!want && child) {
        stop('the app is closed');
    } else if (!want && !child) {
        if (fw && !fw.off) { fwClose(); fw = null; }
        if (!stopping) { state = 'idle'; quick = 0; holdUntil = 0; }
    }
    if (!child) stopping = false;
    writeStatus(want);
}

function main() {
    log('sy-airplay-d up: ' + BIN + (fs.existsSync(BIN) ? '' : ' (MISSING)'));
    try { fwClose(); } catch (e) { /* no nft */ }   // rules a crash left behind
    const t = setInterval(tick, TICK_MS);
    tick();
    const bye = () => {
        clearInterval(t);
        stop('service stopping');
        writeStatus(false);
        setTimeout(() => process.exit(0), child ? 3500 : 0);
    };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
}

if (require.main === module) main();
module.exports = { ifaces, fresh, WIFI, dnssdShim };
