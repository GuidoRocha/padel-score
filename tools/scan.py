"""Scan nearby BLE devices for 20 s and print their advertising data; marks the watch."""
import asyncio
from bleak import BleakScanner

from fundo import is_watch


async def main():
    seen = {}

    def cb(dev, adv):
        seen[dev.address] = (dev, adv)

    async with BleakScanner(cb):
        await asyncio.sleep(20)

    print(f"{len(seen)} dispositivos BLE vistos\n")
    for addr, (dev, adv) in sorted(seen.items(), key=lambda kv: -kv[1][1].rssi):
        mark = "  <<<<< RELOJ" if is_watch(addr, adv.local_name or dev.name) else ""
        print(f"{addr}  rssi={adv.rssi}  name={adv.local_name or dev.name!r}{mark}")
        if adv.service_uuids:
            print("    services:", adv.service_uuids)
        if adv.manufacturer_data:
            print("    manuf:", {hex(k): v.hex() for k, v in adv.manufacturer_data.items()})
        if adv.service_data:
            print("    svcdata:", {k: v.hex() for k, v in adv.service_data.items()})
        if adv.tx_power is not None:
            print("    tx_power:", adv.tx_power)


asyncio.run(main())
