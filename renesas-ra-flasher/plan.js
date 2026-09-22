/* Decide exactly what will be written, before anything is erased. */

/**
 * @param {{addr:number, data:Uint8Array}[]} segments parsed Intel HEX
 * @param {{koa:number, sad:number, ead:number, eau:number, wau:number}[]} areas from Area Info
 * @returns {{start:number, end:number, image:Uint8Array}}
 */
const overlaps = (s, a) => s.addr <= a.ead && s.addr + s.data.length - 1 >= a.sad;

const at = n => '0x' + n.toString(16).padStart(8, '0');

export function plan(segments, areas) {
  const code = areas.find(a => a.koa === 0);
  if (!code) throw new Error('the part reports no code flash area');

  /* The config area holds the ID code. Writing one there can disable serial
     programming permanently - the part answers 0xDC from then on and no erase
     brings it back - so this refuses rather than trimming the file down to the
     part that happens to fit. */
  for (const cfg of areas.filter(a => a.koa === 2)) {
    if (segments.some(s => overlaps(s, cfg)))
      throw new Error('this file writes into the config area, which can disable serial ' +
        'programming for good. Refusing.');
  }

  /* Only code flash is written. Anything else in the file would be dropped and
     the result reported as a success, so refuse the file rather than write part
     of it. */
  for (const s of segments) {
    if (s.addr >= code.sad && s.addr + s.data.length - 1 <= code.ead) continue;
    const other = areas.find(a => a !== code && overlaps(s, a));
    const where = other ? other.kind : 'outside every area the part reports';
    throw new Error(`${at(s.addr)}..${at(s.addr + s.data.length - 1)} is ${where}, ` +
      'and only code flash is written. Refusing rather than writing part of the file.');
  }

  const min = Math.min(...segments.map(s => s.addr));
  const max = Math.max(...segments.map(s => s.addr + s.data.length - 1));
  const start = Math.floor(min / code.eau) * code.eau;

  /* Erase works in whole blocks and write works in whole units, and what is
     written must never reach past what was erased.
     Both sizes are powers of two on the parts this has been pointed at, so the
     range is already a whole number of write units and this loop does not run.
     That is an inference from one measured part, not a guarantee: Area Info
     reports a single erase size per area, and what a part with non-uniform
     blocks answers is unknown. Hence a loop rather than an assertion. */
  let end = Math.ceil((max + 1) / code.eau) * code.eau - 1;
  while ((end - start + 1) % code.wau !== 0) end += code.eau;
  if (end > code.ead) throw new Error('the file runs past the end of code flash once the ' +
    'erase range is rounded out to whole blocks');

  const image = new Uint8Array(end - start + 1).fill(0xFF);
  for (const s of segments) image.set(s.data, s.addr - start);
  return { start, end, image };
}
