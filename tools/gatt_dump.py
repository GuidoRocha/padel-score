"""Read-only GATT dump: lists services/characteristics and reads readable values. Never writes."""
import asyncio
from bleak import BleakClient

from fundo import find_watch


def show(value: bytes) -> str:
    text = value.decode("utf-8", errors="replace") if value else ""
    printable = text.isprintable() and len(text) > 0
    return f"hex={value.hex()}" + (f"  text={text!r}" if printable else "")


async def main():
    dev = await find_watch()
    if dev is None:
        print("Reloj no encontrado (acercalo al PC y enciende la pantalla)")
        return
    async with BleakClient(dev, timeout=30) as client:
        print("Conectado:", client.is_connected, "MTU:", client.mtu_size)
        for svc in client.services:
            print(f"\n[SERVICE] {svc.uuid}  ({svc.description})  handle={svc.handle}")
            for ch in svc.characteristics:
                props = ",".join(ch.properties)
                line = f"   [CHAR] {ch.uuid}  ({ch.description})  handle={ch.handle}  props={props}"
                if "read" in ch.properties:
                    try:
                        line += "\n          value " + show(await client.read_gatt_char(ch))
                    except Exception as e:
                        line += f"\n          read error: {e}"
                print(line)
                for d in ch.descriptors:
                    print(f"          [DESC] {d.uuid} ({d.description}) handle={d.handle}")


asyncio.run(main())
