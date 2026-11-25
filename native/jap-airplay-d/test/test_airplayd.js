'use strict';
// jap-airplay-d against a fake airplay-rx and a fake nft:
//   - the app's file fresh: airplay-rx starts (video only, software decoding, the state dir's key, the video file),
//     and the firewall gets its rules for the car's Wi-Fi interfaces (found in /sys/class/net, or config.json's);
//   - the file stale: airplay-rx gets SIGTERM, the rules go;
//   - an airplay-rx that cannot start: "failed" with the reason it gave, and no third start before the wait;
//   - config.json: the name, the interfaces, firewall off.
//   node test/test_airplayd.js
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap8-'));
const p = (n) => path.join(dir, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
    const end = Date.now() + (ms || 4000);
    while (!fn()) { if (Date.now() > end) throw new Error('timed out: ' + what); await sleep(20); }
}
const status = () => { try { return JSON.parse(fs.readFileSync(p('status.json'), 'utf8')); } catch (e) { return {}; } };
const lines = (f) => { try { return fs.readFileSync(p(f), 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } };

// the fake receiver: says its arguments, runs until SIGTERM (then says so); FAIL=1: dies at once with a loader error
fs.writeFileSync(p('airplay-rx'), `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(p('rx.log'))}, 'start ' + process.argv.slice(2).join(' ') + '\\n');
if (fs.existsSync(${JSON.stringify(p('FAIL'))})) { process.stderr.write('airplay-rx: error while loading shared libraries: libdns_sd.so.765: cannot open shared object file: No such file or directory\\n'); process.exit(127); }
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(p('rx.log'))}, 'sigterm\\n'); process.exit(0); });
setInterval(() => {}, 1000);
`, { mode: 0o755 });
// the fake nft: an "ip filter" table whose rules are kept in a file, with handles
fs.writeFileSync(p('nft'), `#!/usr/bin/env node
const fs = require('fs'), db = ${JSON.stringify(p('nft.json'))}, a = process.argv.slice(2);
let r = []; try { r = JSON.parse(fs.readFileSync(db, 'utf8')); } catch (e) {}
fs.appendFileSync(${JSON.stringify(p('nft.log'))}, a.join(' ') + '\\n');
const s = a.join(' ');
let m;
if ((m = /^(-a )?list chain (\\w+) filter (\\w+)$/.exec(s))) {
  if (m[2] !== 'ip') { process.stderr.write('No such file or directory'); process.exit(1); }
  console.log('table ip filter {\\n chain ' + m[3] + ' {'); r.filter((x) => x.chain === m[3]).forEach((x) => console.log('  ' + x.text + ' # handle ' + x.h)); console.log(' }\\n}');
} else if ((m = /^insert rule ip filter (\\w+) (.*)$/.exec(s))) {
  r.push({ chain: m[1], text: m[2], h: r.reduce((n, x) => Math.max(n, x.h), 0) + 1 });
} else if ((m = /^delete rule ip filter (\\w+) handle (\\d+)$/.exec(s))) {
  r = r.filter((x) => x.h !== Number(m[2]));
} else { process.stderr.write('bad: ' + s); process.exit(1); }
fs.writeFileSync(db, JSON.stringify(r));
`, { mode: 0o755 });
fs.mkdirSync(p('net'));
['lo', 'eth0', 'wlan0', 'usb0'].forEach((n) => fs.mkdirSync(p('net/' + n)));
fs.mkdirSync(p('state'));

const want = () => { fs.writeFileSync(p('want'), String(Date.now())); };
const rules = () => { try { return JSON.parse(fs.readFileSync(p('nft.json'), 'utf8')); } catch (e) { return []; } };

function daemon() {
    return cp.spawn(process.execPath, [path.join(__dirname, '..', 'airplayd.js')], {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: Object.assign({}, process.env, {
            AP8_BIN: p('airplay-rx'), AP8_STATE: p('state'), AP8_LOGDIR: p('log'), AP8_WANT: p('want'), AP8_STATUS: p('status.json'),
            AP8_VIDEO: p('video'), AP8_NFT: p('nft'), AP8_SYSNET: p('net'), AP8_TICK_MS: '100', AP8_WANT_MS: '600', AP8_RETRY_MS: '1500',
        }),
    });
}

async function main() {
    let d = daemon();
    d.stdout.resume();
    await until(() => status().state === 'idle', 3000, 'idle at first');
    assert.strictEqual(status().want, false);
    assert.strictEqual(lines('rx.log').length, 0, 'no receiver without the app');

    // the app opens
    const keep = setInterval(want, 150); want();
    await until(() => status().state === 'running' && lines('rx.log').length > 0, 3000, 'running');
    const args = lines('rx.log')[0];
    assert.strictEqual(args, 'start -A -s -n auto -k ' + p('state/airplay.pem') + ' -o ' + p('video'), 'its arguments: ' + args);
    const ifs = status().ifaces;
    assert.deepStrictEqual(ifs, ['wlan0', 'wlan_bridge'], 'Wi-Fi interfaces found: ' + ifs);
    assert.strictEqual(rules().length, 6, 'three rules each');
    assert.ok(rules().every((r) => /comment "jap-airplay8"/.test(r.text)), 'every rule carries the comment');
    assert.ok(rules().some((r) => r.chain === 'input' && /iifname "wlan0" tcp dport \{ 7100, 7101 \} accept/.test(r.text)), 'TCP 7100/7101 in on wlan0');
    assert.ok(/open \(ip, 6 rules\)/.test(status().firewall), status().firewall);
    console.log('ok   app open: airplay-rx started (' + args.replace(dir, '<dir>').replace(dir, '<dir>') + '), firewall ' + status().firewall);

    // the app closes
    clearInterval(keep);
    await until(() => status().state === 'idle' && lines('rx.log').indexOf('sigterm') >= 0, 4000, 'stopped');
    assert.strictEqual(rules().length, 0, 'the rules are gone');
    console.log('ok   app closed: SIGTERM, rules removed');

    // a receiver that cannot start
    fs.writeFileSync(p('FAIL'), '');
    fs.writeFileSync(p('rx.log'), '');
    const keep2 = setInterval(want, 150); want();
    await until(() => status().state === 'failed' && lines('rx.log').length >= 2, 4000, 'failed twice');
    assert.ok(/libdns_sd\.so\.765/.test(status().err), 'the reason: ' + status().err);
    await sleep(700);
    assert.strictEqual(lines('rx.log').length, 2, 'it waits after two failed starts');
    fs.unlinkSync(p('FAIL'));
    await until(() => status().state === 'running', 4000, 'running again after the wait');
    console.log('ok   failed start: "' + status().err + '", retried after the wait');
    clearInterval(keep2);
    await until(() => status().state === 'idle', 4000, 'idle');

    // config.json
    fs.writeFileSync(p('state/config.json'), JSON.stringify({ name: 'BMW 54321', ifaces: ['wlan1'], hw: true, firewall: true }));
    fs.writeFileSync(p('rx.log'), '');
    const keep3 = setInterval(want, 150); want();
    await until(() => status().state === 'running' && lines('rx.log').length > 0, 3000, 'running (config)');
    assert.strictEqual(lines('rx.log')[0], 'start -A -n BMW 54321 -k ' + p('state/airplay.pem') + ' -o ' + p('video'));
    assert.deepStrictEqual(status().ifaces, ['wlan1']);
    assert.ok(rules().every((r) => /"wlan1"/.test(r.text)) && rules().length === 3);
    console.log('ok   config.json: name, interfaces, GPU decoding');

    // the service stops: the receiver and the rules go with it
    d.kill('SIGTERM');
    await new Promise((r) => d.on('exit', r));
    clearInterval(keep3);
    assert.ok(lines('rx.log').indexOf('sigterm') >= 0, 'receiver stopped');
    assert.strictEqual(rules().length, 0, 'rules removed');
    assert.notStrictEqual(status().state, 'running', 'status: ' + status().state);
    console.log('ok   service stop: receiver stopped, rules removed');
    console.log('airplayd: all ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
