"""Guided test: the watch shows what to press, and we record which watch buttons reach the PC."""
import asyncio
import time

from fundo import EVENTS, MAGIC, RX, TX, connect_with_retries, decode, encode, notification

STEP_TIMEOUT = 45

STEPS = [
    {
        "name": "Buscar telefono",
        "text": "PASO 1: MENU > BUSCAR TELEFONO",
        "expect": {(5, 81)},
    },
    {
        "name": "Disparador de camara",
        "text": "PASO 2: TOCA LA CAMARA",
        "action": encode(4, 70, b"\x01"),
        "expect": {(4, 71), (4, 72)},
        "cleanup": encode(4, 70, b"\x00"),
    },
    {
        "name": "Colgar llamada",
        "text": "PASO 3: TOCA COLGAR",
        "action": notification("TOCA COLGAR", kind=0),
        "expect": {(13, 2)},
        "cleanup": encode(6, 96, bytes([15])),
    },
    {
        "name": "Controles de musica",
        "text": "PASO 4: SI HAY MUSICA TOCA PLAY",
        "expect": {(13, 4), (13, 5), (13, 6), (13, 7)},
    },
]


async def main():
    t0 = time.monotonic()
    buf = bytearray()
    events: asyncio.Queue = asyncio.Queue()

    def on_rx(_, data: bytearray):
        buf.extend(data)
        if buf[0] != MAGIC:
            print(f"[{time.monotonic()-t0:6.1f}s] RAW: {bytes(buf).hex(' ')}", flush=True)
            buf.clear()
            return
        if len(buf) < 8 or len(buf) < 8 + ((buf[2] << 8) | buf[3]):
            return
        msg = decode(bytes(buf))
        buf.clear()
        if msg is None:
            return
        cmd, key, args = msg
        print(f"[{time.monotonic()-t0:6.1f}s] cmd={cmd} key={key} args={args.hex(' ')} {EVENTS.get((cmd, key), '')}", flush=True)
        events.put_nowait((cmd, key))

    async def send(pkt: bytes):
        await client.write_gatt_char(TX, pkt, response=False)
        await asyncio.sleep(0.3)

    results = {}
    client = await connect_with_retries()
    if client is None:
        print("No se pudo conectar: acercalo a la PC, encende la pantalla y desconectalo del telefono")
        return
    try:
        await client.start_notify(RX, on_rx)
        await send(encode(5, 80))  # vibrate: test is starting
        await send(notification("PRUEBA DE BOTONES"))
        await asyncio.sleep(4)

        for step in STEPS:
            print(f"\n=== {step['name']} ===", flush=True)
            while not events.empty():
                events.get_nowait()
            await send(notification(step["text"]))
            if "action" in step:
                await asyncio.sleep(4)  # let the user read the instruction first
                await send(step["action"])
            got = set()
            deadline = time.monotonic() + STEP_TIMEOUT
            while time.monotonic() < deadline:
                try:
                    ev = await asyncio.wait_for(events.get(), deadline - time.monotonic())
                except asyncio.TimeoutError:
                    break
                if ev in step["expect"]:
                    got.add(ev)
                    deadline = min(deadline, time.monotonic() + 3)  # catch repeated presses
            results[step["name"]] = got
            if "cleanup" in step:
                await send(step["cleanup"])
            await send(notification("OK" if got else "NO LLEGO NADA"))
            await asyncio.sleep(3)

        await send(notification("FIN. GRACIAS"))
    finally:
        await client.disconnect()

    print("\n===== RESUMEN =====")
    for name, got in results.items():
        detail = ", ".join(EVENTS.get(e, str(e)) for e in sorted(got))
        print(f"{name:22s}: {'FUNCIONA -> ' + detail if got else 'no llego ningun evento'}")


asyncio.run(main())
