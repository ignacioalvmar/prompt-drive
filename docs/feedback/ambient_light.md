# Nota de diseño: `ambient_light`

**Campo de VehicleState:** `ambient_light`.
**Autor:** Ian Saonni Rodríguez Pulido.
**Equipo:** Ian_Rodriguez_Pulido.

## 1. Problema identificado

Según los materiales de Cabina Abierta, cambiar la luz ambiental modifica el
estado del vehículo, pero no produce un cambio visible en la cabina. El paso t08
del guion solicita luz azul y t12b solicita apagarla. Esta nota parte de ese
problema documentado; no afirma una observación personal del autor en el estudio.

## 2. Qué debería percibir quien maneja

La persona debería percibir que la luz se encendió, qué color tiene y si permanece
encendida. Se usa el canal visual periférico, con una transición de 400 ms y un
resplandor persistente. Al apagarla, el mismo color se desvanece. No se añade voz
ni sonido porque el asistente ya confirma la acción y esta es una preferencia de
confort, no una alerta que deba reclamar atención.

## 3. Alternativas consideradas

- Un aviso textual temporal con el nombre del color: es explícito, pero exige
  leer y desaparece sin representar el estado persistente de la luz.
- Iluminar superficies reales de la escena 3D: ofrece mayor realismo, pero exige
  handles del motor, ajustar materiales y comprobar las condiciones día/noche.
- Un resplandor DOM en los bordes inferiores: funciona antes de arrancar el motor,
  mantiene despejada la zona central y permite verificar el cambio sin alterar
  la escena. Es la alternativa elegida para esta primera versión.

## 4. Diseño elegido

Tres franjas con degradados de opacidad: una inferior de 13 % de la altura y dos
laterales de 5 % del ancho, limitadas al 44 % inferior. Las franjas laterales se
desvanecen también hacia arriba. La opacidad del conjunto es 0,32; el centro y la
parte superior quedan libres. Se representan los nueve colores permitidos y OFF.

Los cambios de color interpolan durante 400 ms; OFF desvanece el color anterior.
La primera representación del estado es inmediata, sin simular un encendido al
recargar. Con `prefers-reduced-motion: reduce`, los cambios también son inmediatos.
La decisión sigue el consejo del reto de usar señales sutiles, coherentes con la
cabina y que no tapen la vía. Los colores de confort no se usan para indicar
errores ni decisiones del asistente.

## 5. Implementación

`src/feedback/features/ambient_light.js` registra la feature en `CabinFeedback` y
se suscribe exclusivamente a `ambient_light`. `init(ctx)` crea tres elementos
dentro de `ctx.layer`; `onChange` representa el valor del snapshot. Las máscaras
CSS delimitan el resplandor y las transiciones CSS animan color y opacidad.

No se escribe en VehicleState, no se usan handles 3D, no hay bucles por cuadro ni
dependencias nuevas. `dispose` elimina el DOM creado. Todos los recursos son CSS
original, sin imágenes o sonidos externos. El bundle se genera con
`npm run build:feedback`.

Para demostrarla: ejecutar t08 y t12b del guion, o enviar
`PromptDrive.vehicle.set({ ambient_light: 'BLUE' })` y después OFF. Probar también
los otros colores, cambios rápidos, estado inicial encendido y movimiento reducido.

Validación técnica realizada: compilación completa con `npm run build`, sintaxis
JavaScript y `git diff --check`; en Chrome sin ventana visible, los nueve colores
y OFF, cambios rápidos, opacidad y color calculados, un snapshot inicial activo,
movimiento reducido y conexión de la demo. Se compararon los demás campos de
VehicleState antes y después de cada color: ninguno cambió. Estas comprobaciones
no sustituyen la evaluación de distracción y legibilidad por el autor.

## 6. Limitaciones y siguientes pasos

El resplandor está fijado a la pantalla: no ilumina materiales 3D ni sigue la
geometría del tablero cuando cambia la cámara. Su visibilidad depende del fondo y
no representa una intensidad física. Los colores cercanos pueden ser difíciles
de distinguir para algunas personas; no se usa esta señal para información de
seguridad. La intensidad aún debe validarse con el autor en conducción de día,
de noche y en ventanas pequeñas.

Con usuarios, pedir identificar encendido, apagado y cambio de color durante una
tarea de conducción, y observar si apartan la vista de la vía. Con un segundo día,
ajustar ubicación e intensidad según esas observaciones y explorar iluminación
3D si mejora la integración sin aumentar la distracción.
