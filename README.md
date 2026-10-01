# Pádel Score

Marcador de pádel que se maneja **desde un smartwatch chino barato** (sin apps propias ni botones), usando la pantalla de música del reloj como control remoto.

| Toque en el reloj (pantalla de música) | Acción |
|---|---|
| ⏮ izquierda | punto para el equipo de la izquierda |
| ⏭ derecha | punto para el equipo de la derecha |
| ⏯ centro | deshacer el último punto |

Cada partido queda guardado en el historial del teléfono.

## Cómo funciona

```
Reloj (pantalla de música) ──BLE──> FunDo Health ──teclas multimedia──> Chrome (web app)
```

El reloj (nRF52, firmware cerrado) no admite apps de terceros. La app oficial **FunDo Health** convierte los toques de la pantalla de música en teclas multimedia de Android. La web app las recibe con la [Media Session API](https://developer.mozilla.org/docs/Web/API/Media_Session_API), igual que un reproductor de música.

## Uso

1. Instalá **FunDo Health** desde Play Store y vinculá el reloj desde la app.
2. En el Samsung, poné **Chrome** y **FunDo Health** con batería **"Sin restricciones"**.
3. Abrí la web app en Chrome. Conviene instalarla con "Agregar a pantalla de inicio".
4. Creá un **nuevo partido** y tocá **⌚ Activar reloj**.
5. En el reloj, abrí la pantalla de **música** y anotá los puntos. Con el teléfono bloqueado vas a escuchar un pitido por punto de la izquierda y dos por punto de la derecha.

Límites conocidos:
- Dos toques rápidos en ⏯ Android los convierte en "siguiente", o sea un punto para la derecha.
- La voz solo funciona con la pantalla del teléfono encendida.
- Si cerrás deslizando la notificación de música de Chrome, el reloj deja de controlar la app.
- Cuando la pantalla del reloj se apaga, el reloj vuelve a la esfera.

Formatos: 1 set o al mejor de 3, sets a 6 o a 4 juegos, tie-break a 7, tercer set como super tie-break a 10 o set completo. En 40-40: punto de oro, ventaja o *star point* (FIP 2026).

## Estructura

| Carpeta | Contenido |
|---|---|
| `web/` | La PWA (HTML/CSS/JS sin build). Es lo que se publica en GitHub Pages. |
| `web/js/scoring.js` | Motor de puntuación puro: el estado se recalcula a partir de la lista de puntos. |
| `web/js/watch.js` | Recepción de las teclas multimedia, con un audio de mantenimiento para que Chrome no congele la página. |
| `tests/` | Tests del motor (`node --test tests/scoring.test.mjs`). |
| `tools/` | Scripts Python (bleak) para hablar directo con el reloj por BLE: escaneo, volcado GATT y protocolo FunDo. |
| `docs/INVESTIGACION-RELOJ.md` | Investigación del hardware y del protocolo BLE (compatible con el driver Hama Fit6900 de Gadgetbridge). |

## Desarrollo

```bash
python -m http.server 8765 --directory web
node --test tests/scoring.test.mjs
```

En `localhost`, el service worker no cachea nada, así que los cambios se ven al recargar.

Para probar en el teléfono sin publicar:
1. Conectá el teléfono por USB con la depuración USB activada.
2. En la PC, abrí `chrome://inspect` y configurá *Port forwarding* de `8765` a `localhost:8765`.
3. En el teléfono, abrí `http://localhost:8765`.

## Publicación

Cada push a `main` corre los tests y publica `web/` en GitHub Pages (`.github/workflows/pages.yml`).

**En cada cambio de la web app, subí `VERSION` en `web/sw.js`.** El service worker instala la app como un paquete versionado, y si no cambia la versión los teléfonos siguen usando la anterior.

## Herramientas BLE (opcional)

```bash
pip install -r tools/requirements.txt
python tools/scan.py
python tools/fundo.py 10 "15-30"
```

`fundo.py 10 "15-30"` lee batería y firmware y muestra un texto en el reloj.

Los scripts buscan el reloj por su nombre BLE (`Smart Watch`). Para fijar uno en particular, definí la variable de entorno `WATCH_MAC`.

El reloj acepta una sola conexión a la vez. Mientras FunDo Health está conectada, la PC no lo ve, así que primero hay que apagar el Bluetooth del teléfono.

**No escribas nunca en el servicio DFU `FE59`, ni mandes el comando 2/199 (reset de fábrica).**
