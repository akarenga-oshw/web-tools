/* Everything that touches the DOM. The modules it pulls in do not, which is
 * what makes them testable without a browser page around them. */

import { Transport } from '../shared/transport.js';
import { RA_USB_BOOT, describe } from '../shared/devices.js';
import { sha256Hex } from '../shared/digest.js';
import { parseIntelHex } from './hex.js';
import { Boot } from './boot.js';
import { plan } from './plan.js';

const $ = id => document.getElementById(id);

/* ───────────────── Log ───────────────── */
const logEl = $('log');
const verboseEl = $('verbose');
const ts = () => {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
};
function log(cls, text) {
  const line = document.createElement('div');
  const t = document.createElement('span'); t.className = 't'; t.textContent = ts();
  const b = document.createElement('span'); b.className = cls; b.textContent = text;
  line.append(t, b); logEl.append(line); logEl.scrollTop = logEl.scrollHeight;
}
const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const hexTrunc = (a, max = 16) =>
  a.length <= max ? hex(a) : hex(a.slice(0, max)) + ` … (${a.length} bytes)`;
const logTx = a => { if (verboseEl.checked) log('tx', 'TX  ' + hexTrunc(a)); };
const logRx = a => { if (verboseEl.checked) log('rx', 'RX  ' + hexTrunc(a)); };
$('btnClear').onclick = () => { logEl.textContent = ''; };

/* ───────────────── State ───────────────── */
let port = null, tr = null, boot = null, segments = null, portOpts = null;
let hexSha = null;
const setBar = f => { $('bar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; };

function setHexStat() {
  if (!segments) { $('hexStat').innerHTML = ''; return; }
  const total = segments.reduce((s, x) => s + x.data.length, 0);
  const min = Math.min(...segments.map(s => s.addr));
  const max = Math.max(...segments.map(s => s.addr + s.data.length - 1));
  $('hexStat').innerHTML =
    `<span>segments <b>${segments.length}</b></span>` +
    `<span>total <b>${total.toLocaleString()}</b> bytes</span>` +
    `<span>range <b>0x${min.toString(16).padStart(8, '0')}</b> - <b>0x${max.toString(16).padStart(8, '0')}</b></span>` +
    (hexSha ? `<span>sha256 <b>${hexSha.slice(0, 16)}…</b></span>` : '');
}

/** Load from the bytes as they arrived, so the digest is of the file itself. */
async function loadHexBytes(buf, name) {
  try {
    const text = new TextDecoder().decode(buf);
    segments = parseIntelHex(text);
    hexSha = await sha256Hex(buf);
    $('drop').classList.add('has');
    $('drop').textContent = name;
    log('ok', `loaded ${name}`);
    /* Printed in full so it can be read against the digest published with a
       release. The panel only has room for the first half. */
    log('info', `sha256 ${hexSha}`);
  } catch (e) {
    segments = null; hexSha = null;
    log('err', 'could not parse the HEX: ' + e.message);
  }
  setHexStat(); updateButtons();
}

function updateButtons() {
  $('btnProbe').disabled = !boot;
  $('btnFlash').disabled = !(boot && segments);
  $('btnDisconnect').disabled = !port;
  $('btnConnect').disabled = !!port;
}

/* ───────────────── Loading firmware ───────────────── */
const drop = $('drop');
drop.onclick = () => $('file').click();
$('file').onchange = e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(b => loadHexBytes(b, f.name)); };
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then(b => loadHexBytes(b, f.name));
});
/* ───────────────── Connecting ───────────────── */
$('btnConnect').onclick = async () => {
  if (!('serial' in navigator)) {
    log('err', 'This browser does not implement Web Serial. Use desktop Chrome or Edge.');
    return;
  }
  try {
    const filters = $('filterVid').checked ? [RA_USB_BOOT] : [];
    port = await navigator.serial.requestPort({ filters });
    const usb = port.getInfo();
    portOpts = { dataBits: 8, stopBits: 1, flowControl: 'none' };
    tr = new Transport(port, { onTx: logTx });
    await tr.open(Object.assign({ baudRate: 9600, parity: 'none' }, portOpts));
    boot = new Boot(tr, { log, onRx: logRx });
    log('ok', 'connected' + (usb.usbVendorId != null ? ` (${describe(usb)})` : ''));
    if ($('mode').value === 'uart') await boot.sync(portOpts);
    else log('info', 'USB boot mode: no synchronisation sequence, starting at Inquiry');
    await boot.enterCommandPhase();
    await probe();
  } catch (e) {
    log('err', e.message);
    if (tr) await tr.close().catch(() => {});
    port = null; tr = null; boot = null;
  }
  updateButtons();
};

$('btnDisconnect').onclick = async () => {
  if (tr) await tr.close();
  port = null; tr = null; boot = null;
  $('devStat').innerHTML = ''; setBar(0);
  log('info', 'disconnected'); updateButtons();
};

async function probe() {
  const sig = await boot.signature();
  boot.areas = [];
  for (let i = 0; i < sig.areas; i++) boot.areas.push(await boot.areaInfo(i));
  const code = boot.areas.find(a => a.koa === 0);
  $('devStat').innerHTML = code
    ? `<span>code flash <b>${((code.ead - code.sad + 1) / 1024).toFixed(0)} KB</b></span>` +
      `<span>erase unit <b>${code.eau} B</b></span><span>write unit <b>${code.wau} B</b></span>` +
      `<span>boot firmware <b>V${sig.fw}</b></span>`
    : '';
}
$('btnProbe').onclick = () => probe().catch(e => log('err', e.message));

/* ───────────────── Writing ───────────────── */
$('btnFlash').onclick = async () => {
  $('btnFlash').disabled = true; $('btnProbe').disabled = true;
  try {
    if (!boot.areas.length) await probe();
    const { start, end, image } = plan(segments, boot.areas);

    // UART can go faster than 9600
    const wanted = parseInt($('baud').value, 10);
    if ($('mode').value === 'uart' && wanted) await boot.setBaud(wanted, portOpts);

    const t0 = performance.now();
    setBar(0);
    await boot.erase(start, end);

    log('info', `writing ${image.length.toLocaleString()} bytes at 0x${start.toString(16).padStart(8, '0')}`);
    await boot.write(start, image, f => setBar(f * 0.8));
    log('ok', 'written');

    if ($('doVerify').checked) {
      log('info', 'verifying');
      let bad = 0;
      for (let off = 0; off < image.length; off += 1024) {
        const n = Math.min(1024, image.length - off);
        const got = await boot.read(start + off, n);
        for (let i = 0; i < Math.min(n, got.length); i++) if (got[i] !== image[off + i]) bad++;
        if (got.length < n) bad += n - got.length;
        setBar(0.8 + 0.2 * (off + n) / image.length);
      }
      if (bad) log('err', `verify failed on ${bad} bytes`);
      else log('ok', 'verify matched');
    }
    setBar(1);
    log('ok', `done in ${((performance.now() - t0) / 1000).toFixed(1)} s. ` +
      'Release the MD pin and power-cycle the board.');
  } catch (e) {
    log('err', e.message);
  } finally {
    updateButtons();
  }
};

if (!('serial' in navigator))
  log('err', 'Web Serial is not available. Open this in desktop Chrome or Edge, over HTTPS or on localhost.');
else
  log('dim', 'Ready. Put the target into boot mode, then connect.');
updateButtons();
