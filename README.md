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
