/* USB identities the tools in this repository look for.
 *
 * A board shows up under a different identity depending on what is running on
 * it, so these are not interchangeable: the flasher talks to the ROM boot
 * firmware, the time sync page talks to a sketch, and dfu-util talks to the
 * bootloader. Keeping them in one file is the reason these tools share a
 * repository at all. */

/* Renesas standard boot firmware, entered by releasing reset with MD low.
 * Not vendor specific: every RA part with USB boot enumerates like this. */
export const RA_USB_BOOT = { usbVendorId: 0x045B, usbProductId: 0x0261 };

/* Akarenga UNO R4 Minima, running a sketch. CDC plus a DFU runtime interface. */
export const AKARENGA_UNO_R4_MINIMA = { usbVendorId: 0x2886, usbProductId: 0x806A };

/* The same board in its DFU bootloader, which is what dfu-util writes through.
 * Nothing here talks to it yet; the flasher is what puts it there. */
export const AKARENGA_UNO_R4_MINIMA_DFU = { usbVendorId: 0x2886, usbProductId: 0x006A };

export const describe = ({ usbVendorId: v, usbProductId: p }) =>
  `${v.toString(16).padStart(4, '0').toUpperCase()}:${p.toString(16).padStart(4, '0').toUpperCase()}`;
