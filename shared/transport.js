/* A Web Serial port as a byte stream with a buffer in front of it.
 *
 * Reading is a background loop appending into `buf`, rather than a read per
 * request, because a protocol that asks for "the next 3 bytes" cannot control
 * how the host chunks them. `want()` then waits for a count rather than for a
 * chunk.
 *
 * Nothing here knows about packets or commands. Framing belongs to whichever
 * protocol is on top. */

export class Transport {
  /** `onTx` and `onRx` see raw bytes, and exist so a page can log them. */
  constructor(port, { onTx = null, onRx = null } = {}) {
    this.port = port;
    this.buf = new Uint8Array(0);
    this.reader = null;
    this.writer = null;
    this.loop = null;
    this.onTx = onTx;
    this.onRx = onRx;
  }

  async open(opts) {
    await this.port.open(Object.assign(
      { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 65536 }, opts));
    this.writer = this.port.writable.getWriter();
    this.loop = this._read();
  }

  async _read() {
    this.reader = this.port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length) {
          const n = new Uint8Array(this.buf.length + value.length);
          n.set(this.buf); n.set(value, this.buf.length); this.buf = n;
        }
      }
    } catch (e) { /* cancelled */ }
    finally { try { this.reader.releaseLock(); } catch (e) {} }
  }

  async close() {
    try { if (this.reader) await this.reader.cancel(); } catch (e) {}
    try { await this.loop; } catch (e) {}
    try { if (this.writer) this.writer.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
    this.reader = this.writer = this.loop = null;
  }

  /** Reopen the port. Parity and baud rate cannot be changed while it is open. */
  async reopen(opts) { await this.close(); this.buf = new Uint8Array(0); await this.open(opts); }

  flush() { this.buf = new Uint8Array(0); }

  async write(bytes) {
    if (this.onTx) this.onTx(bytes);
    await this.writer.write(bytes);
  }

  /** Resolve once `n` bytes have arrived, and take them out of the buffer. */
  async want(n, timeout = 2000) {
    const end = performance.now() + timeout;
    while (this.buf.length < n) {
      if (performance.now() > end)
        throw new Error(`receive timeout, waiting for ${n} bytes, have ${this.buf.length}`);
      await new Promise(r => setTimeout(r, 4));
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}
