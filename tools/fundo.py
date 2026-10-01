"""FunDo / Fen Yun watch protocol (port of Gadgetbridge hama/fit6900/Message.java) + live test."""
import asyncio
import os
import sys
import time
from bleak import BleakClient, BleakScanner

# The watch is found by its advertised name; set WATCH_MAC to pin a specific watch.
WATCH_NAME = "Smart Watch"
WATCH_MAC = os.environ.get("WATCH_MAC")
TX = "c3e6fea1-e966-1000-8000-be99c223df6a"
RX = "c3e6fea2-e966-1000-8000-be99c223df6a"
MAGIC = 0xBA


def crc8(data: bytes) -> int:
    crc = 0xFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xB8 if crc & 1 else crc >> 1
    return crc


def encode(cmd: int, key: int, args: bytes = b"") -> bytes:
    body = bytes([cmd, 0, key, (len(args) >> 8) & 1, len(args) & 0xFF]) + args
    crc = crc8(body)
    header = bytes([MAGIC, 1 << 5, len(body) >> 8, len(body) & 0xFF, 0, crc, 0, 0])
    return header + body


def decode(data: bytes):
    if len(data) < 13 or data[0] != MAGIC:
        return None
    length = (data[2] << 8) | data[3]
    body = data[8:8 + length]
    if len(body) != length or crc8(body) != data[5]:
        return None
    return body[0], body[2], body[5:]


EVENTS = {
    (4, 70): "CAMARA abrir", (4, 71): "CAMARA disparar", (4, 72): "CAMARA cerrar",
    (5, 81): "BUSCAR TELEFONO",
    (13, 2): "COLGAR", (13, 4): "MUSICA play", (13, 5): "MUSICA pause",
    (13, 6): "MUSICA anterior", (13, 7): "MUSICA siguiente",
}


async def find_watch(timeout: float = 20):
    if WATCH_MAC:
        return await BleakScanner.find_device_by_address(WATCH_MAC, timeout=timeout)
    return await BleakScanner.find_device_by_name(WATCH_NAME, timeout=timeout)


def is_watch(address: str, name: str | None) -> bool:
    return address.upper() == WATCH_MAC.upper() if WATCH_MAC else name == WATCH_NAME


def notification(text: str, kind: int = 1) -> bytes:
    return encode(6, 96, bytes([kind]) + text.strip()[:64].encode("utf-16-le"))


async def connect_with_retries(attempts: int = 5) -> BleakClient | None:
    for attempt in range(1, attempts + 1):
        dev = await find_watch()
        if dev is None:
            print(f"Intento {attempt}: reloj no encontrado", flush=True)
            continue
        client = BleakClient(dev, timeout=30)
        try:
            await client.connect()
            print(f"Conectado (intento {attempt})", flush=True)
            return client
        except Exception as e:
            print(f"Intento {attempt}: fallo la conexion ({e})", flush=True)
            await asyncio.sleep(3)
    return None


async def main(listen_seconds: int, text: str | None):
    dev = await find_watch()
    if dev is None:
        print("Reloj no encontrado")
        return
    t0 = time.monotonic()
    buf = bytearray()

    def on_rx(_, data: bytearray):
        buf.extend(data)
        if buf[0] != MAGIC:
            print(f"[{time.monotonic()-t0:6.1f}s] RAW (magic desconocido): {bytes(buf).hex(' ')}", flush=True)
            buf.clear()
            return
        if len(buf) < 8 or len(buf) < 8 + ((buf[2] << 8) | buf[3]):
            return  # wait for more chunks
        msg = decode(bytes(buf))
        raw = bytes(buf).hex(" ")
        buf.clear()
        if msg is None:
            print(f"[{time.monotonic()-t0:6.1f}s] RAW (no decodifica): {raw}", flush=True)
            return
        cmd, key, args = msg
        label = EVENTS.get((cmd, key), "")
        if (cmd, key) == (1, 19):
            label = f"FIRMWARE {args[0]}.{args[1]}.{args[2]}" if len(args) >= 3 else "FIRMWARE"
        elif (cmd, key) == (4, 65):
            label = f"BATERIA {args[0]}%" if args else "BATERIA"
        print(f"[{time.monotonic()-t0:6.1f}s] cmd={cmd} key={key} args={args.hex(' ')}  {label}", flush=True)

    async with BleakClient(dev, timeout=30) as client:
        print("Conectado", flush=True)
        await client.start_notify(RX, on_rx)
        for pkt in (encode(4, 64), encode(1, 18)):
            print("TX", pkt.hex(" "), flush=True)
            await client.write_gatt_char(TX, pkt, response=False)
            await asyncio.sleep(1.0)
        if text:
            pkt = notification(text)
            print("TX notif", pkt.hex(" "), flush=True)
            await client.write_gatt_char(TX, pkt, response=False)
        print(f"Escuchando eventos {listen_seconds}s...", flush=True)
        await asyncio.sleep(listen_seconds)
    print("Fin")


if __name__ == "__main__":
    secs = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    msg = sys.argv[2] if len(sys.argv) > 2 else None
    asyncio.run(main(secs, msg))
