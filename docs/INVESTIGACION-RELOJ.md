# Reloj FunDo "Smart Watch": investigación y protocolo

Fecha: 2026-09-29. Todo lo marcado como **[probado]** se comprobó conectando al reloj real desde el PC (Python + bleak, `tools/`).

## 1. Qué es el reloj

| Dato | Valor |
|---|---|
| Nombre BLE | `Smart Watch` |
| MAC | dirección BLE *random static* (los scripts buscan el reloj por nombre; `WATCH_MAC` para fijar uno) |
| Firmware | 1.3.6 **[probado]** |
| Chip | **Nordic nRF52** (expone `FE59` Secure DFU Buttonless). MTU 247 **[probado]** |
| Sistema | Firmware propietario (RTOS/bare-metal). **No es Android: no admite APK ni apps de terceros.** |
| App oficial | FunDo Pro (`com.kct.fundo.btnotification`), de Shenzhen Fen Yun / grupo KCT |
| Emparejamiento | No necesita bond ni handshake **[probado]** |

Servicios GATT **[probado]**:

| Servicio | Características |
|---|---|
| `c3e6fea0-e966-1000-8000-be99c223df6a` (protocolo FunDo) | `c3e6fea1-…` write / write-without-response (TX, hacia el reloj); `c3e6fea2-…` notify (RX, desde el reloj) |
| `0000fe59` Nordic Secure DFU | `8ec90003-f315-4f60-9fb8-838830daea50` Buttonless DFU. **NO TOCAR** |
| `0000fee7` WeChat (Tencent) | `fec7` write, `fec8` indicate, `fec9` = MAC, `fea1` pasos |

## 2. Protocolo (idéntico al driver "Hama Fit6900" de Gadgetbridge)

Referencia: `Message.java` y `HamaFit6900DeviceSupport.java` en
https://codeberg.org/Freeyourgadget/Gadgetbridge (ruta `devices/hama/fit6900/`).
Implementación en Python: `tools/fundo.py`.

Trama = cabecera de 8 bytes + cuerpo:

```
Cabecera: BA | (tipo<<5) | len_hi | len_lo | 00 | crc8 | cnt_hi | cnt_lo
          tipo=1 (0x20) al enviar; el reloj responde con 0x30
Cuerpo:   cmd | 00 | key | (len_args>>8)&1 | len_args&0xFF | args...
CRC-8:    init 0xFF, polinomio reflejado 0xB8, calculado solo sobre el cuerpo
```

En Windows (MTU 247) una trama entera cabe en una escritura. En Android: `requestMtu(247)` o trocear en bloques de 20 bytes.

### Comandos teléfono → reloj

| Acción | cmd / key | args | Respuesta |
|---|---|---|---|
| Batería | 4 / 64 | — | 4 / 65, `[pct, cargando]` **[probado: 95 %]** |
| Versión firmware | 1 / 18 | — | 1 / 19, `[major, minor, patch, …]` **[probado: 1.3.6]** |
| **Mostrar texto (marcador)** | 6 / 96 | `[tipo] + texto UTF-16LE` (máx. 64 caracteres; mejor < 20 para que se lea) | 6 / 96 **[probado: ACK]** |
| Aviso de llamada (con botón colgar) | 6 / 96 | `[0] + texto` | 6 / 96 **[probado: ACK]** |
| Cerrar aviso de llamada | 6 / 96 | `[15]` | 6 / 96 **[probado: ACK]** |
| Hacer vibrar / buscar reloj | 5 / 80 | — | 5 / 80 **[probado: ACK]** |
| Modo cámara abrir / cerrar | 4 / 70 | `[1]` / `[0]` | 4 / 70 **[probado: ACK]** |
| Poner fecha y hora | 2 / 32 | `[año%100, mes, día, h, m, s, 0=24h]` | 2 / 32 |
| **Reset de fábrica** | 2 / 199 | — | **NO USAR** |

Tipos de notificación: 0 llamada, 1 SMS, 3 WeChat, 4 Facebook, 7 WhatsApp, 255 genérico.

### Eventos reloj → teléfono (posibles "botones" para sumar puntos)

Según Gadgetbridge. **Falta probarlos pulsando en el reloj.**

| Evento | cmd / key |
|---|---|
| Buscar teléfono (menú del reloj) | 5 / 81 |
| Cámara: abrir / **disparar** / cerrar | 4 / 70 / 71 / 72 |
| Música: play / pause / anterior / siguiente | 13 / 4 / 5 / 6 / 7 |
| Colgar (en el aviso de llamada) | 13 / 2 |
| Pulso en tiempo real / pasos | 10 / 171, 10 / 172 |

## 3. Reglas de seguridad

- No escribir nunca en el servicio `FE59` / `8ec90003`: el reloj entra en modo DFU (`DfuTarg`) y sin el firmware firmado del fabricante no se recupera.
- No enviar 2 / 199 (reset de fábrica) ni cambiar el Device Name.
- El reloj solo acepta **una conexión a la vez**: si el PC está conectado, el teléfono no puede (y al revés).
- No emparejarlo desde Ajustes > Bluetooth de Android; se conecta desde la app.

## 4. Conclusiones

1. **No se le puede meter un APK ni ninguna app.** El Secure DFU de Nordic solo acepta firmware firmado por el fabricante. La única vía para poner firmware propio sería abrir el reloj y reprogramarlo por SWD, reescribiendo todos los drivers. No compensa para un contador.
2. **Arquitectura viable: el teléfono es el cerebro y el reloj es la pantalla y el mando.** La app Android lleva el marcador, lo envía al reloj como texto (6/96) y recibe los eventos del reloj como pulsaciones de "punto".
3. **No hace falta FunDo Pro.** Si igualmente la quieres:
   - Play la oculta por su política de API objetivo (target 34 < 35 desde el 31/08/2026). No es un bloqueo de Android, así que el APK instalado a mano funciona sin `--bypass-low-target-sdk-block`.
   - Primero probar **FunDo Health** (`com.cqkct.fundo.health`, en Play y actualizada en 2026).
   - Si hay que instalar FunDo Pro 1.8.15 a mano: desactivar temporalmente Auto Blocker de Samsung, comprobar el certificado del APK y, después, en Ajustes > Apps, "Permitir ajustes restringidos".
   - Ojo: pide permisos invasivos (SMS, contactos, accesibilidad).
4. **Validar sin programar: Gadgetbridge** (F-Droid). En Ajustes > Discovery, activar "Discover unsupported devices". Escanear, mantener pulsado "Smart Watch", elegir "Add test device" y luego **Hama Fit6900**.

## 5. Pendiente (prueba de 2 minutos con el reloj en la mano)

- Confirmar a ojo que llegan el texto, la vibración, el aviso de llamada y la pantalla de cámara.
- Ver qué eventos genera cada botón: con `python tools/fundo.py 90` escuchando, pulsar en el reloj "buscar teléfono", el disparador de la cámara y los controles de música si los hay.
- Ver cuántos caracteres caben en pantalla, cuánto dura el mensaje y si el reloj corta la conexión cuando está inactivo.

## 6. Plan B y alternativas

- **Entrada sin el reloj:** Galaxy Buds3 Pro (pellizco simple, doble o triple llega como play/pause, siguiente o anterior mediante MediaSession) o un disparador de selfie Bluetooth de 1 a 3 USD. Referencia: Point-Counter (MIT).
- **Apps de pádel ya hechas** para relojes programables:
  - Wear OS: Simple Padel Score, WristScore, Padel Score Pro.
  - Garmin: garmin-padel (MPL-2.0, incluye Star Point).
  - Zepp OS: Padel Buddy.
  - Bangle.js 2: Score Tracker.
- **Si quieres la app corriendo en la muñeca:** Galaxy Watch4 o Watch5 usado (encaja con el Samsung), Amazfit Bip 6 o Bangle.js 2.

## 7. Arquitectura elegida (30/09/2026): web app + FunDo Health

- **FunDo Health** (Play Store) se conecta al reloj y le reenvía las notificaciones. Mientras está conectada, el reloj deja de anunciarse, así que ni la PC ni nRF Connect lo ven (por eso fallaron las pruebas de ese día).
- La **pantalla de música del reloj** tiene ⏮ a la izquierda, ⏯ en el centro y ⏭ a la derecha. FunDo Health convierte esos toques en teclas multimedia de Android **[probado por el usuario: cambia de canción]**.
- **Web app (`web/`):** una PWA en Chrome Android que recibe esas teclas con la Media Session API.
  - ⏮ suma punto para el equipo de la izquierda, ⏭ para el de la derecha y ⏯ deshace.
  - Historial por partido en `localStorage`.
- Requisitos verificados (Chromium/AOSP):
  - Hace falta un `<audio>` en bucle de 5 s o más y **audible para Chrome** (por encima de -72 dBFS). Desde Chrome 143, una página oculta y en silencio se congela al minuto. Usamos un tono de 30 Hz a -50 dBFS en WAV PCM.
  - No forzar `mediaSession.playbackState = 'playing'`.
  - Tocar dos veces rápido el ⏯ se convierte en "siguiente".
  - `speechSynthesis` y `vibrate` no funcionan con la página oculta. Los pitidos de Web Audio sí.
  - En Samsung, Chrome y FunDo Health tienen que tener la batería "Sin restricciones". Si se desliza para cerrar la notificación multimedia de Chrome, se pierde la sesión.
- **Pantalla del reloj:** no existe ningún comando conocido para abrir la pantalla de música ni para mantenerla.
  - Candidatos a probar: el ajuste de tiempo de pantalla en el menú del reloj, y el tercer byte de setSystemData (cmd 2/39, valor 60, "screen. unclear").
  - Ese byte se puede probar desde la PC, pero antes hay que apagar el Bluetooth del teléfono.
- Android permite que varias apps del mismo teléfono compartan el enlace BLE (`connectGatt`). Una app nativa auxiliar podría convivir con FunDo Health (sin probar). Web Bluetooth no ve un reloj que ya está conectado.
- **Publicación:** GitHub Pages. En cada deploy hay que subir `VERSION` en `web/sw.js`.
- **Prueba en el teléfono sin publicar:** depuración USB, `chrome://inspect` y port forwarding de 8765 a `localhost:8765`.

## 8. Reglas de pádel que debe soportar el motor

- Puntos 15 / 30 / 40.
- Deuce en tres modos: ventaja, punto de oro (la pareja que resta elige lado) o Star Point (FIP 2026: dos ventajas y luego punto decisivo).
- Sets a 6 con 2 de diferencia, y tie-break a 7 con 6-6 (saque 1-2-2, cambio de lado cada 6 puntos).
- Tercer set como super tie-break a 10 o set completo.
- Cambio de lado en los juegos impares.
- Deshacer.
