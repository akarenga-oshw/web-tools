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
