# web tools

Browser tools for working with boards over USB. Nothing to install, nothing sent
to a server: [Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
talks to the board directly from the page.

<https://akarenga-oshw.github.io/web-tools/>

| | |
|---|---|
| [renesas-ra-flasher](https://akarenga-oshw.github.io/web-tools/renesas-ra-flasher/) | Writes flash over the Renesas standard boot firmware. Verified on RA4M1. |
| [usb-time-sync](https://akarenga-oshw.github.io/web-tools/usb-time-sync/) | Sets a board's RTC from the host clock, then reports the drift in ppm. |

Chrome or Edge on the desktop. Firefox, Safari and Android do not implement Web
Serial.

## renesas-ra-flasher

The flash geometry is not hardcoded: the tool asks the boot firmware for it at
runtime (Signature `0x3A`, Area Info `0x3B`), so the protocol layer is
family-generic. **Verified is a different claim from generic**, and only RA4M1
has been tried. On anything else, read the area information by all means, but
treat writing as untested — this tool can leave a part unable to accept another
one.

### What it refuses

A file for the wrong board is easier to pick up than a malicious one, and both
end the same way. Rather than write the part of a file that happens to fit, the
page works out the whole write first and refuses if anything is off:

- **Anything reaching into the config area.** An ID code written there can
  disable serial programming for good: the part answers `0xDC` from then on and
  no erase undoes it. Recovery needs SWD, if the settings even allow that.
- **Anything outside code flash**, including data flash. Only code flash is
  written, so the rest of the file would be silently dropped and the result
  reported as done.
- **A file whose erase range would run past the end of code flash.**

The area addresses come from the part itself, not from a table here, so this
holds on a part whose flash is laid out differently.

The page also shows the SHA-256 of the file it loaded. Releases publish the same
digest, so the two can be read against each other before anything is erased.

Firmware is loaded from your own disk. There is no URL box: a link that fetches
and flashes is a way to write an arbitrary binary to someone else's board, and a
file you picked yourself is one you can see the provenance of.

## usb-time-sync

The board prints its time on its own one-second boundary; the page records when
each line arrives and fits a line through the offsets, so the constant USB CDC
latency drops out of the slope. The sketch to run on the board is on the page.

Measuring over USB measures the crystal *at the temperature USB puts it*. A
tuning-fork crystal loses roughly 0.034 ppm per degree squared away from 25°C,
so self-heating alone moves the figure. For the number that matters to a battery
powered board, set the time, unplug, run on backup power overnight, and reconnect.

## Tests

<https://akarenga-oshw.github.io/web-tools/tests/>

The flasher can leave a part unable to accept another image, so the parts that
decide what gets written are worth checking, and worth being able to check
yourself. That page runs in your browser with no board attached: it feeds
generated Intel HEX back through the parser, corrupts a byte to confirm the
corruption is caught, and verifies the length and checksum fields of the packets
against what the protocol specifies.

What it cannot cover is the conversation with a real part — the synchronisation
sequence, the timeouts, which parts send a trailing OK. Those need hardware.

Run them locally with any static server, which is also how to use the tools
themselves without publishing anything:

```
python3 -m http.server
```
