/* The Renesas standard boot firmware protocol (application note r01an5372).
 *
 * Commands are SOH LNH LNL COM <info> SUM ETX, replies and data start with SOD,
 * and SUM is the two's complement of everything from LNH to the last info byte.
 * The framing is shared by both, so `frame` builds either.
 *
 * Flash geometry is never assumed: `signature` and `areaInfo` ask the part for
 * it. That is what makes this file work on RA parts other than the one it has
 * been tried on — the protocol is the same, only the numbers differ. */

export const SOH = 0x01, SOD = 0x81, ETX = 0x03;

export const CMD = {
  INQUIRY: 0x00, ERASE: 0x12, WRITE: 0x13, READ: 0x15,
  ID_AUTH: 0x30, BAUD: 0x34, SIG: 0x3A, AREA: 0x3B,
};

export const STS = {
  0x00: 'OK', 0xC0: 'unsupported command', 0xC1: 'packet error', 0xC2: 'checksum error',
  0xC3: 'flow error', 0xD0: 'address error', 0xD4: 'baud rate error',
  0xDA: 'protection error', 0xDB: 'ID mismatch', 0xDC: 'serial programming disabled',
  0xE1: 'erase error', 0xE2: 'write error', 0xE7: 'sequencer error',
};

export function frame(start, code, payload) {
  const len = 1 + payload.length;
  const out = new Uint8Array(1 + 2 + len + 2);
  out[0] = start; out[1] = (len >> 8) & 0xff; out[2] = len & 0xff; out[3] = code;
  out.set(payload, 4);
  let sum = 0; for (let i = 1; i < 4 + payload.length; i++) sum = (sum + out[i]) & 0xff;
  out[4 + payload.length] = (0x100 - sum) & 0xff;
  out[5 + payload.length] = ETX;
  return out;
}

export const cmdPacket  = (code, payload = new Uint8Array(0)) => frame(SOH, code, payload);
export const dataPacket = (code, payload)                     => frame(SOD, code, payload);
export const be32 = n => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
export const rd32 = (a, i) => ((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0;

/** Read one reply off a transport and check it before handing back the body. */
export async function recvPacket(tr, timeout = 3000, onRx = null) {
  const head = await tr.want(3, timeout);
  if (head[0] !== SOD) throw new Error(`expected SOD, got 0x${head[0].toString(16)}`);
  const len = (head[1] << 8) | head[2];
  const rest = await tr.want(len + 2, timeout);
  const full = new Uint8Array(3 + len + 2);
  full.set(head); full.set(rest, 3);
  if (onRx) onRx(full);
  if (full[full.length - 1] !== ETX) throw new Error('no ETX');
  let sum = 0; for (let i = 1; i < 3 + len; i++) sum = (sum + full[i]) & 0xff;
  if (((sum + full[3 + len]) & 0xff) !== 0) throw new Error('checksum mismatch in the reply');
  const res = full[3], body = full.slice(4, 3 + len);
  if (res & 0x80) {
    const code = body[0];
    throw new Error(`device error: ${STS[code] || 'unknown'} (0x${code.toString(16).toUpperCase()})`);
  }
  return { res, body };
}

export class Boot {
  /** @param tr a Transport @param log (cls, text) sink, defaults to nothing */
  constructor(tr, { log = () => {}, onRx = null } = {}) {
    this.tr = tr;
    this.log = log;
    this.onRx = onRx;
    this.areas = [];
  }

  _recv(timeout) { return recvPacket(this.tr, timeout, this.onRx); }

  async command(code, payload, timeout = 3000) {
    this.tr.flush();
    await this.tr.write(cmdPacket(code, payload));
    return this._recv(timeout);
  }

  /** UART only. Nothing to synchronise over CDC. */
  async sync(portOpts) {
    /* Not just 'none': RA2 parts have been reported to want ODD parity for the
       synchronisation alone, which is in no Renesas document. Trying both costs
       one failed round and saves an unexplainable dead end. */
    for (const parity of ['none', 'odd']) {
      this.log('info', `synchronising, parity=${parity}`);
      await this.tr.reopen(Object.assign({}, portOpts, { baudRate: 9600, parity }));
      this.tr.flush();
      let acked = false;
      for (let i = 0; i < 30; i++) {
        await this.tr.write(new Uint8Array([0x00]));
        try { const a = await this.tr.want(1, 120); if (a[0] === 0x00) { acked = true; break; } }
        catch (e) { /* try the next 0x00 */ }
      }
      if (!acked) continue;
      await this.tr.write(new Uint8Array([0x55]));
      const b = await this.tr.want(1, 500).catch(() => null);
      if (b && b[0] === 0xC3) {
        this.log('ok', `synchronised, boot code 0xC3, sync parity=${parity}`);
        if (parity !== 'none') {
          await this.tr.reopen(Object.assign({}, portOpts, { baudRate: 9600, parity: 'none' }));
          this.log('info', 'switched parity to NONE for the command phase');
        }
        return;
      }
    }
    throw new Error('no answer. Check the MD pin, the wiring, and when reset is released.');
  }

  async enterCommandPhase() {
    try {
      await this.command(CMD.INQUIRY, new Uint8Array(0), 1500);
      this.log('ok', 'in the command phase, no ID authentication needed');
    } catch (e) {
      /* A flow error here is the part saying it wants an ID, not a failure. */
      if (!/flow error/.test(e.message)) throw e;
      this.log('info', 'in the authentication phase, trying ID = FF x 16');
      await this.command(CMD.ID_AUTH, new Uint8Array(16).fill(0xFF), 3000);
      this.log('ok', 'ID authentication accepted');
    }
  }

  async signature() {
    const { body } = await this.command(CMD.SIG);
    const sig = {
      sciHz: rd32(body, 0), maxBaud: rd32(body, 4),
      areas: body[8], type: body[9], fw: `${body[10]}.${body[11]}`,
    };
    this.log('info', `SCI ${(sig.sciHz / 1e6).toFixed(0)} MHz / max ${sig.maxBaud} bps / ` +
      `${sig.areas} areas / TYP 0x${sig.type.toString(16).toUpperCase()} / boot firmware V${sig.fw}`);
    return sig;
  }

  async areaInfo(n) {
    const { body } = await this.command(CMD.AREA, new Uint8Array([n]));
    const kind = ['code flash', 'data flash', 'config'][body[0]] || `unknown (${body[0]})`;
    const a = {
      koa: body[0], kind,
      sad: rd32(body, 1), ead: rd32(body, 5), eau: rd32(body, 9), wau: rd32(body, 13),
    };
    this.log('info', `area ${n}, ${a.kind}, ` +
      `0x${a.sad.toString(16).padStart(8, '0')}-0x${a.ead.toString(16).padStart(8, '0')}, ` +
      `erase ${a.eau ? a.eau + 'B' : 'n/a'}, write ${a.wau}B`);
    return a;
  }

  async setBaud(bps, portOpts) {
    await this.command(CMD.BAUD, be32(bps));
    await new Promise(r => setTimeout(r, 50));
    await this.tr.reopen(Object.assign({}, portOpts, { baudRate: bps, parity: 'none' }));
    await new Promise(r => setTimeout(r, 10));
    this.log('ok', `switched to ${bps} bps`);
  }

  async erase(start, end) {
    const p = new Uint8Array(8); p.set(be32(start)); p.set(be32(end), 4);
    this.log('info', `erasing 0x${start.toString(16).padStart(8, '0')}-0x${end.toString(16).padStart(8, '0')}`);
    await this.command(CMD.ERASE, p, 60000);
    this.log('ok', 'erased');
  }

  async write(start, image, onProgress) {
    const end = start + image.length - 1;
    const p = new Uint8Array(8); p.set(be32(start)); p.set(be32(end), 4);
    this.tr.flush();
    await this.tr.write(cmdPacket(CMD.WRITE, p));
    await this._recv(5000);
    const CH = 1024;
    for (let off = 0; off < image.length; off += CH) {
      const chunk = image.slice(off, Math.min(off + CH, image.length));
      await this.tr.write(dataPacket(CMD.WRITE, chunk));
      await this._recv(10000);
      onProgress && onProgress((off + chunk.length) / image.length);
    }
  }

  async read(start, len, timeout = 10000) {
    const end = start + len - 1;
    const p = new Uint8Array(8); p.set(be32(start)); p.set(be32(end), 4);
    this.tr.flush();
    await this.tr.write(cmdPacket(CMD.READ, p));
    const out = new Uint8Array(len);
    let got = 0;
    while (got < len) {
      const { body } = await this._recv(timeout);
      if (body.length === 1) break;               // the closing OK
      out.set(body.slice(0, Math.min(body.length, len - got)), got);
      got += body.length;
    }
    /* Some parts send a trailing OK after the last data packet and some do not,
       so take one if it turns up rather than leaving it to confuse the next
       command. */
    try { await this._recv(150); } catch (e) {}
    return out.slice(0, got);
  }
}
