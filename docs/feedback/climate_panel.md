# Nota de diseño: `climate_panel`

**Autor:** Ian Saonni Rodríguez Pulido.  
**Equipo:** Ian_Rodriguez_Pulido. **Cohorte:** COH2.  
**Campos:** `climate_temperature_driver`, `climate_temperature_passenger`,
`fan_speed`, `fan_airflow_direction`, `air_conditioning`, `air_circulation`,
`window_front_defrost`, `window_rear_defrost`, `seat_heating_driver`,
`seat_heating_passenger`.

## 1. Qué viste en el estudio

El catálogo del reto describe ajustes de clima que solo aparecen como números
en Comfort. Los pasos t02, t03, t06 y t09 cambian temperatura, ventilación,
visibilidad o calefacción. Si la pantalla muestra navegación, falta una señal
dedicada del resultado. Esta observación procede del material del reto, no de
haber participado personalmente en el estudio.

## 2. Qué debería percibir quien maneja

La persona necesita identificar qué zona cambió, la temperatura objetivo,
la intensidad del ventilador y los modos activos. El canal es visual: un
panel persistente debajo de la pantalla. El cambio se destaca brevemente;
después quedan los valores, sin voz adicional ni avisos sobre la carretera.
La temperatura representa la consigna solicitada, no una medición física.

## 3. Alternativas consideradas

- Abrir Comfort después de cada orden: aprovecha la pantalla existente, pero
  interrumpe navegación o música y requiere buscar el dato.
- Mostrar un aviso DOM temporal: se integra fácilmente, pero desaparece y su
  posición fija no sigue el tablero al cambiar de cámara.
- Usar un módulo físico independiente: conserva la pantalla disponible,
  distingue las zonas y expresa el estado persistente. Fue la opción elegida,
  asumiendo mayor trabajo para integrarlo en 3D.

## 4. Diseño elegido

Dos perillas metálicas con arcos azul/rojo, valores grandes, pantalla negra
central y testigos para A/C, circulación, dirección, desempañadores y asientos.
El ventilador expresa cinco niveles y movimiento proporcional a su velocidad.
Las temperaturas interpolan durante 350 ms; los cambios se destacan durante
850 ms. Con movimiento reducido, los estados se presentan sin animaciones.

La referencia visual fue el climatizador del Audi A4 proporcionado por el autor:
https://cars.usnews.com/cars-trucks/audi/a4/photos-interior . El dibujo Canvas
es original; no se incorporan fotografías como texturas. Dos zonas corresponden
al estado disponible, aunque la referencia muestra tres. En el vehículo del
reto el acompañante queda a la izquierda; se sigue también la configuración
del lado del conductor si cambia. Rejillas centrales y lateral derecha completan
la integración visual. Su movimiento mecánico no se simula.

## 5. Implementación

Un archivo autocontenido, `src/feedback/features/climate_panel.js`, se registra
en `CabinFeedback`. `onChange` conserva el snapshot; Canvas dibuja la información
en una textura independiente. La textura y las rejillas se montan junto a la
pantalla existente utilizando `ctx.handles().centerConsole`, sin editar la
consola, el motor, el API ni el orden de carga.

La construcción espera a que existan handles y una pantalla montada. La
visibilidad sigue la cámara interior, la pantalla y `CabinFeedback.enable`.
El dibujo se limita a unos 30 Hz y se omite si no hay cambios ni animaciones.
Los recursos se liberan al cambiar la superficie de montaje y en `dispose`.
No hay controles manuales, llamadas a `vehicle.set`, nuevas dependencias ni
recursos externos. El bundle se regenera con `npm run build:feedback`.

Prueba: t02 (19 °C), t03 (ventilador y parabrisas), t06 (24 °C y asiento), t09
(dos zonas). Verificar encendido inicial, recarga, movimiento reducido y
benchmark. Un clic en la representación no debe modificar el estado.

## 6. Limitaciones y siguientes pasos

No existe simulación térmica, empañamiento del vidrio ni regulación automática:
se representa la orden aceptada. AUTO identifica el modo de circulación, no un
termostato. El panel es pequeño; su legibilidad depende de resolución y cámara.
La geometría se ajustó al interior del vehículo de referencia y necesita
validación en otros modelos. No se añaden controles táctiles al feedback.

Con usuarios, pedir reconocer zona, nivel y dirección durante una tarea de
conducción y medir errores y duración de miradas. Un segundo día permitiría
ajustar contraste y tamaño según esas pruebas, conservando libre la carretera.
