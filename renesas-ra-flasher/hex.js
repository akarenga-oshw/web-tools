/* Intel HEX. Nothing here is Renesas specific. */

/**
 * Parse Intel HEX into contiguous segments.
 *
 * Records that continue where the previous one stopped are merged, so a normal
 * firmware image comes back as one segment rather than hundreds. Every record's
 * checksum is verified: a truncated download or an edited file is far more
 * likely than a deliberate one, and either can brick a part if it reaches the
 * device.
 *
 * @param {string} text
 * @returns {{addr:number, data:Uint8Array}[]} segments, in file order
 */
export function parseIntelHex(text) {
  const chunks = [];
  let upper = 0, cur = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l[0] !== ':') throw new Error(`line ${i + 1} does not start with ':'`);
    const raw = l.slice(1);
    if (raw.length % 2) throw new Error(`line ${i + 1} has an odd number of characters`);
    const b = new Uint8Array(raw.length / 2);
    for (let k = 0; k < b.length; k++) b[k] = parseInt(raw.substr(k * 2, 2), 16);
    let sum = 0; for (const v of b) sum = (sum + v) & 0xff;
    if (sum !== 0) throw new Error(`checksum mismatch on line ${i + 1}`);

    const len = b[0], off = (b[1] << 8) | b[2], type = b[3], data = b.slice(4, 4 + len);
    if (type === 0x00) {
      const addr = upper + off;
      if (cur && cur.addr + cur.bytes.length === addr) cur.bytes.push(...data);
      else { cur = { addr, bytes: [...data] }; chunks.push(cur); }
    } else if (type === 0x04) { upper = ((data[0] << 8) | data[1]) * 0x10000; cur = null; }
    else if (type === 0x02) { upper = ((data[0] << 8) | data[1]) * 16; cur = null; }
    else if (type === 0x01) break;
  }
  if (!chunks.length) throw new Error('no data records');
  return chunks.map(c => ({ addr: c.addr, data: new Uint8Array(c.bytes) }));
}
