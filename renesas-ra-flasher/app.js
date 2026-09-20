/* Everything that touches the DOM. The modules it pulls in do not, which is
 * what makes them testable without a browser page around them. */

import { Transport } from '../shared/transport.js';
import { RA_USB_BOOT, describe } from '../shared/devices.js';
import { parseIntelHex } from './hex.js';
import { Boot } from './boot.js';

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
const setBar = f => { $('bar').style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; };

function setHexStat() {
  if (!segments) { $('hexStat').innerHTML = ''; return; }
  const total = segments.reduce((s, x) => s + x.data.length, 0);
  const min = Math.min(...segments.map(s => s.addr));
  const max = Math.max(...segments.map(s => s.addr + s.data.length - 1));
  $('hexStat').innerHTML =
    `<span>segments <b>${segments.length}</b></span>` +
    `<span>total <b>${total.toLocaleString()}</b> bytes</span>` +
    `<span>range <b>0x${min.toString(16).padStart(8, '0')}</b> - <b>0x${max.toString(16).padStart(8, '0')}</b></span>`;
}

function loadHexText(text, name) {
  try {
    segments = parseIntelHex(text);
    $('drop').classList.add('has');
    $('drop').textContent = name;
    log('ok', `loaded ${name}`);
  } catch (e) {
    segments = null;
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
$('file').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => loadHexText(t, f.name)); };
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0]; if (f) f.text().then(t => loadHexText(t, f.name));
});
$('btnFetch').onclick = async () => {
  const u = $('url').value.trim(); if (!u) return;
  try {
    const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
    loadHexText(await r.text(), u.split('/').pop());
  } catch (e) { log('err', 'could not fetch: ' + e.message); }
};

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
    const code = boot.areas.find(a => a.koa === 0);
    if (!code) throw new Error('the part reports no code flash area');

    const inRange = segments.filter(s => s.addr >= code.sad && s.addr <= code.ead);
    if (!inRange.length) throw new Error('the HEX has nothing inside the code flash range');
    if (inRange.length !== segments.length) log('info', 'ignoring segments outside code flash');

    const min = Math.min(...inRange.map(s => s.addr));
    const max = Math.max(...inRange.map(s => s.addr + s.data.length - 1));
    const eau = code.eau, wau = code.wau;
    const start = Math.floor(min / eau) * eau;
    const end   = Math.ceil((max + 1) / eau) * eau - 1;
    if (end > code.ead) throw new Error('the HEX runs past the end of code flash');

    // one contiguous image, padded with 0xFF
    const image = new Uint8Array(end - start + 1).fill(0xFF);
    for (const s of inRange) image.set(s.data, s.addr - start);
    const writeLen = Math.ceil(image.length / wau) * wau;
    const padded = writeLen === image.length ? image
      : (() => { const p = new Uint8Array(writeLen).fill(0xFF); p.set(image); return p; })();

    // UART can go faster than 9600
    const wanted = parseInt($('baud').value, 10);
    if ($('mode').value === 'uart' && wanted) await boot.setBaud(wanted, portOpts);

    const t0 = performance.now();
    setBar(0);
    await boot.erase(start, end);

    log('info', `writing ${padded.length.toLocaleString()} bytes at 0x${start.toString(16).padStart(8, '0')}`);
    await boot.write(start, padded, f => setBar(f * 0.8));
    log('ok', 'written');

    if ($('doVerify').checked) {
      log('info', 'verifying');
      let bad = 0;
      for (let off = 0; off < padded.length; off += 1024) {
        const n = Math.min(1024, padded.length - off);
        const got = await boot.read(start + off, n);
        for (let i = 0; i < Math.min(n, got.length); i++) if (got[i] !== padded[off + i]) bad++;
        if (got.length < n) bad += n - got.length;
        setBar(0.8 + 0.2 * (off + n) / padded.length);
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
