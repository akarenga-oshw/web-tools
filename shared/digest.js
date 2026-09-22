/**
 * SHA-256 of some bytes, as lower case hex.
 *
 * Tools here show this next to whatever they are about to write, so that it can
 * be read against the digest published with a release. That is the only check
 * available on a file fetched over the network: the alternative is trusting
 * that whatever answered the URL was what was meant to.
 *
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @returns {Promise<string>} 64 lower case hex characters
 */
export async function sha256Hex(bytes) {
  const buf = ArrayBuffer.isView(bytes)
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
