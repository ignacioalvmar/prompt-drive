# Nota de diseño: `defrost`

**Campos de VehicleState o estados del agente a los que reacciona:** `window_front_defrost`, `window_rear_defrost`
**Autores:** DanielMolina (dafeshark), COH-4 — implementación asistida por IA (ver `AI_LOG.md` en el fork)

## 1. Qué viste en el estudio

Al pedir "está empañado, hágale" el asistente respondía "listo", el campo `window_front_defrost` pasaba a `true` en la pestaña Vehicle, pero el parabrisas de la cabina se veía exactamente igual. No había forma de saber si la orden se había entendido ni si era el delantero o el trasero.

## 2. Qué debería percibir quien maneja

- **Que se activó** (confirmación inmediata, < 300 ms): un sonido suave de ventilador que sube y un testigo ámbar en el borde inferior.
- **Cuál** (delantero / trasero): testigo con letra F o R; para el trasero, líneas de resistencia ámbar donde estaría el retrovisor (el lugar donde se mira el vidrio trasero).
- **Que está funcionando** (proceso): en el delantero, un vaho leve sobre la parte alta del parabrisas que se aclara de abajo hacia arriba en ~10 s, como el flujo real de las salidas de aire.
- **Qué NO debe pasar:** tapar la vía (el vaho se limita al 42 % superior, opacidad máx. ~0.38 y se va desvaneciendo), parpadear, sonar como una alerta, usar rojo.

Canal: visual periférico + sonido corto. Nada de texto que leer.

## 3. Alternativas que consideraste

1. **Solo un ícono en el cluster/consola.** Correcto pero focal y fácil de perder; no comunica que el sistema "está trabajando" ni cuándo termina. Se conservó como testigo persistente, pero no como único canal.
2. **Vaho permanente que aparece al apagar el desempañador.** Simula mejor la física, pero el simulador no conoce la temperatura/humedad: mostrar vaho que el conductor no pidió sería falso y bloquearía la vista. Descartado.
3. **Animación a pantalla completa (vidrio entero empañado).** Muy clara, pero tapa la vía justo mientras se maneja. Descartado; se limitó a la franja superior y con opacidad baja.
4. **Mensaje de voz/texto "Desempañador activado".** Redundante con la respuesta del asistente y exige lectura. Descartado.

## 4. Diseño elegido

- Vaho blanco azulado (gradiente + `backdrop-filter: blur(3px)`) en el 42 % superior, que se recorta de abajo hacia arriba en 10 s (`clip-path`, curva ease-out) y se desvanece al final.
- Barrido de tono senoidal 140→320 Hz, 700 ms, volumen 0.06 (ventilador que arranca). Trasero: clic corto de relé.
- Testigo ámbar (convención ISO 2575 para desempañador: flechas onduladas) con "F"/"R", en una pastilla oscura semitransparente centrada abajo, fuera de la vía.
- Trasero: rejilla de líneas ámbar con brillo tenue arriba al centro (zona del retrovisor), fija mientras esté activo.
- Referencias: botones de desempañador de casi todos los carros (testigo ámbar en el botón), principio de "visibilidad del estado del sistema" (Nielsen) y de mínima demanda visual (NHTSA Visual-Manual Distraction Guidelines: mirar < 2 s).

## 5. Implementación

Capa DOM (`ctx.layer`) únicamente; no toca la escena 3D ni escribe en `VehicleState`. Sonido con `ctx.audio.tone`. El primer `onChange` (al cargar) muestra testigos sin animar ni sonar: si ya estaba activo, se asume vidrio despejado. Se guarda el estado previo para no repetir la animación si llega un `set` con el mismo valor. Lo difícil: reiniciar la transición de `clip-path` (se fuerza un reflow).

## 6. Limitaciones y siguientes pasos

- El tiempo de despeje es fijo (10 s); no depende de `fan_speed` ni de `fan_airflow_direction`. Con un segundo día lo relacionaría.
- El vaho es una aproximación 2D sobre el lienzo; no se alinea con la geometría exacta del parabrisas en todas las vistas de cámara.
- Prueba con usuarios: comparar tiempo de confirmación y miradas fuera de la vía (eye tracking o conteo de glances) entre "solo testigo" y "testigo + vaho", y preguntar si el vaho se confunde con un fallo.
