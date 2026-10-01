"""One-minute check: does the watch actually SHOW text and vibrate? Sends the same basic setup the official app would."""
import asyncio
import datetime
import time

from fundo import MAGIC, RX, TX, connect_with_retries, decode, encode, notification

SEQUENCE = [
    ("vibrar", encode(5, 80), 3),
    ("mensaje", notification("HOLA 15-0"), 8),
    ("llamada", notification("PADEL 15-0", kind=0), 10),
    ("cerrar llamada", encode(6, 96, bytes([15])), 2),
    ("mensaje final", notification("FIN PRUEBA"), 3),
]


async def main():
    t0 = time.monotonic()

    def on_rx(_, data: bytearray):
        msg = decode(bytes(data)) if data and data[0] == MAGIC else None
        shown = f"cmd={msg[0]} key={msg[1]} args={msg[2].hex(' ')}" if msg else f"RAW {bytes(data).hex(' ')}"
        print(f"[{time.monotonic()-t0:6.1f}s]   <- {shown}", flush=True)

    client = await connect_with_retries(attempts=10)
    if client is None:
        print("No se pudo conectar")
        return
    try:
        await client.start_notify(RX, on_rx)
        now = datetime.datetime.now()
        setup = [
            ("hora", encode(2, 32, bytes([now.year % 100, now.month, now.day, now.hour, now.minute, now.second, 0]))),
            ("idioma es / 24h", encode(2, 39, bytes([3, 0, 60, 0]))),
            ("no molestar OFF", encode(6, 100, bytes([0, 22, 0, 7, 0]))),
        ]
        for name, pkt in setup:
            print(f"[{time.monotonic()-t0:6.1f}s] -> {name}", flush=True)
            await client.write_gatt_char(TX, pkt, response=False)
            await asyncio.sleep(0.8)
        for name, pkt, wait in SEQUENCE:
            print(f"[{time.monotonic()-t0:6.1f}s] -> {name}", flush=True)
            await client.write_gatt_char(TX, pkt, response=False)
            await asyncio.sleep(wait)
    finally:
        await client.disconnect()
    print("Fin")


asyncio.run(main())
