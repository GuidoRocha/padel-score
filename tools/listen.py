"""Subscribe to the watch's notify/indicate characteristics and print whatever arrives. Sends no commands."""
import asyncio
import sys
import time
from bleak import BleakClient

from fundo import find_watch

CHANNELS = {
    "c3e6fea2-e966-1000-8000-be99c223df6a": "FUNDO notify",
    "0000fec8-0000-1000-8000-00805f9b34fb": "WECHAT indicate",
    "0000fea1-0000-1000-8000-00805f9b34fb": "WECHAT steps",
}
SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 60


async def main():
    dev = await find_watch()
    if dev is None:
        print("Reloj no encontrado")
        return
    t0 = time.monotonic()
    async with BleakClient(dev, timeout=30) as client:
        print("Conectado; escuchando", SECONDS, "s", flush=True)
        for uuid, label in CHANNELS.items():
            def handler(_, data, label=label):
                print(f"[{time.monotonic() - t0:6.1f}s] {label}: {data.hex(' ')}", flush=True)
            await client.start_notify(uuid, handler)
        await asyncio.sleep(SECONDS)
    print("Fin")


asyncio.run(main())
