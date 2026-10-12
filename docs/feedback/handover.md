# Nota de diseño: `handover`

**Campos de VehicleState o estados del agente a los que reacciona:** ninguno. El modo autónomo vive en el motor (`controls.autodrive`), no en `VehicleState`. La feature lo lee con `PromptDrive.on('tick')` y, si el tick no lo trae, con `PromptDrive.get('controls.autodrive')`.
**Autores:** Sofía Morato

## 1. Qué viste en el estudio

Cuando la persona dijo "maneja tú", el asistente respondió "listo, tomo el control" y el carro empezó a moverse solo, sin ningún cambio en la cabina que mostrara quién conducía. Lo mismo al devolver el control: no había aviso de que ya había que tomar el timón.

## 2. Qué debería percibir quien maneja

- Que cambió **quién conduce**, y en qué estado está ahora, de un vistazo y sin leer frases.
- Un canal periférico (el borde de la pantalla) para el estado permanente, y un sonido corto para marcar la transición.
- El cambio tiene que ser claro pero no urgente: la entrega dura 2,5 s al activar y 1,5 s al desactivar.
- **No debe** tapar la vía ni el cluster, confundirse con una alerta de seguridad (por eso no usa rojo ni ámbar) ni pisar los colores que ya usa el asistente (cian, ámbar, blanco, verde, rojo).

## 3. Alternativas que consideraste

- **Mensaje de texto grande ("El carro tiene el control").** Era la idea del catálogo. La descarté: obliga a leer en un momento en que la atención debería estar en la vía, y el diseño pide solo "AUTO" y "MANUAL".
- **Cuenta regresiva antes de devolver el control.** Descartada por una razón técnica, no de diseño: la feature solo ve el cambio cuando ocurre; no sabe que la entrega va a suceder.
- **Cambiar el color del borde según el estado (por ejemplo ámbar al devolver el control).** Descartada: los colores cálidos y el verde ya significan cosas del asistente y de seguridad. El violeta no los usa, y el cambio de estado se marca con la desaparición del borde y la etiqueta MANUAL.
- **Voz del navegador (`ctx.audio.say`).** Descartada: el asistente ya habla en la entrega y se pisarían.
- **Indicador en la franja de la consola central.** Descartada: la pantalla se proyecta sobre una malla pequeña y con calidad gráfica baja pierde legibilidad, y no es periférico.
- **Mostrar solo la transición, sin estado permanente.** Descartada: después de 3 s no habría forma de saber si el carro sigue conduciendo solo.

## 4. Diseño elegido

- **Modo autónomo activo:** borde fino violeta tenue alrededor del lienzo (`inset box-shadow`) y una pastilla pequeña, abajo al centro y por encima de la barra inferior, con un ícono de timón y la palabra AUTO. Nunca en el centro del parabrisas.
- **Al activarse:** el borde entra desde los costados durante 2,5 s, la pastilla aparece y suenan dos tonos ascendentes (volumen 0,15).
- **Al desactivarse:** el borde se desvanece en 1,5 s, suena un tono descendente y la pastilla pasa a MANUAL durante 2 s y desaparece.
- **Ya activo al cargar:** estado permanente aparece de golpe, sin animación y sin sonido.
- **`prefers-reduced-motion`:** solo cambian opacidades, el borde no se expande.
- **Referencias:** SAE J3016 define los niveles de automatización de la conducción y la entrega del control entre sistema y persona. No cito fuentes para la elección del violeta; es una decisión por exclusión de los colores ya usados.

## 5. Implementación

Capa DOM sobre el lienzo ([handover.js](../../src/feedback/features/handover.js)): dos elementos (borde y pastilla) con transiciones CSS, sin bucles por cuadro. Solo trabaja cuando el valor de `autodrive` cambia respecto al anterior; la primera lectura válida se toma como estado base y se aplica sin animación. La suscripción a `tick` se cancela en `dispose()`. La feature no escribe en `VehicleState` ni llama a `dynamic.*` ni a `vehicle.set`.

Lo difícil fue que el estado no está en `VehicleState`, y que la lectura depende de que el motor ya haya arrancado (el `tick` empieza cuando se adjuntan los handles). Durante las pruebas el navegador sirvió una copia en caché de `feedback.js` (el `<script>` lleva `?v=...`), y la feature parecía no hacer nada hasta recargar sin caché.

## 6. Limitaciones y siguientes pasos

- **Solo refleja el cambio.** No puede anticipar una entrega futura ni avisar de que pronto habrá que tomar el timón.
- **Latencia de hasta unos 100 ms**: el `tick` se emite a unos 10 Hz.
- **Sin leer antes de begin:** si el motor aún no arrancó, no hay lectura; el estado inicial se aplica al primer `tick`.
- **Audio** bloqueado por el navegador hasta la primera interacción; antes de eso la transición es solo visual.
- **No comprobado a mano:** los tiempos exactos de las transiciones y la posición de la pastilla respecto al cluster. En una prueba con Chrome sin ventana comprobé la lógica (etiquetas, número de tonos, estado inicial sin animación), pero no los tiempos.
- **Con usuarios** probaría: si el violeta se asocia con "automático" sin explicación, cuánto tarda alguien en notar la entrega, y si 2,5 s de entrada es el tiempo adecuado o se siente lento.
- **Con un segundo día:** una entrega con aviso previo, que requeriría que el motor publique la intención antes del cambio.
