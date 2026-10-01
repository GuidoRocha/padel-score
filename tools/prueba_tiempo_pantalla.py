"""Experiment: does the 3rd byte of setSystemData (cmd 2/39, default 60, "screen. unclear" in Gadgetbridge)
control how long the watch screen stays on? Turn the phone's Bluetooth off first (FunDo Health holds the link).

Usage: python prueba_tiempo_pantalla.py <valor 1-255>   then time how long the screen stays on.
"""
import asyncio
import sys
import time

from fundo import MAGIC, RX, TX, connect_with_retries, decode, encode, notification


async def main(value: int):
    t0 = time.monotonic()

    def on_rx(_, data: bytearray):
        msg = decode(bytes(data)) if data and data[0] == MAGIC else None
        if not msg:
            print(f"[{time.monotonic()-t0:5.1f}s] RAW {bytes(data).hex(' ')}", flush=True)
            return
        cmd, key, args = msg
        print(f"[{time.monotonic()-t0:5.1f}s] <- cmd={cmd} key={key} len={len(args)} args={args.hex(' ')}", flush=True)
        if (cmd, key) == (2, 47) and len(args) > 56:
            # dc6jn layout (unverified): system block at 53..56 = language, time format, screen, pair
            print(f"   sistema: idioma={args[53]} formato={args[54]} pantalla={args[55]} pair={args[56]}", flush=True)

    client = await connect_with_retries(attempts=6)
    if client is None:
        print("No se pudo conectar: apaga el Bluetooth del telefono y acerca el reloj a la PC")
        return
    try:
        await client.start_notify(RX, on_rx)
        print("-> leer configuracion (2/46)", flush=True)
        await client.write_gatt_char(TX, encode(2, 46), response=False)
        await asyncio.sleep(2)
        print(f"-> setSystemData idioma=es 24h pantalla={value}", flush=True)
        await client.write_gatt_char(TX, encode(2, 39, bytes([3, 0, value, 0])), response=False)
        await asyncio.sleep(1)
        await client.write_gatt_char(TX, notification(f"PANTALLA {value}"), response=False)
        await asyncio.sleep(2)
    finally:
        await client.disconnect()
    print("Listo: medi cuanto tarda en apagarse la pantalla del reloj")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 255))
