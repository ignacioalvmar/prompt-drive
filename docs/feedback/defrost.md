# Nota de diseño: `defrost`

**Campos de VehicleState o estados del agente a los que reacciona:** `window_front_defrost` y `window_rear_defrost` (`true`/`false`). Lee `fan_speed` (0 a 5) solo para ajustar el volumen del ventilador. No usa estados del agente.
**Autores:** Julian Esteban Cadena Rojas (COH2)

## 1. Qué viste en el estudio

Durante el estudio, fue difícil hacer que el asistente me entendiera, y casi que todas las acciones que le pedí no se realizaron, además de que me hablaba en inglés. En cuanto al panorámico empañado, no noté ninguna prueba visual o cambio gráfico en el que pudiera notar que efectivamente el desempañador estuviera activado, también el asistente no respondió a mi petición. 

## 2. Qué debería percibir quien maneja

**Información:** que el desempañador del auto, ó el aire condicionado en el parabrisas está encendido.

**Canal:** 
- Visual central: el parabrisas se debe ir desempañando poco a poco y es justo donde el conductor está viendo la via. Es el canal principal.
- Sonido: el sonido del ventilador sube al activarse y se apaga cuando el panoramico termina de desempañarse. 
- Visual periférico: un testigo en el tablero (en el simulador, un icono ambar en la esquina inferior izquierda), que indique que el desempañador del carro está activo.  

**Tiempos:** la confirmación debe ser inmediata, pero el resultado es gradual, como en un carro real.
- Al activar, el empañamiento aparece en menos de medio segundo y el sonido del ventilador sube en 1,5 s, así que se sabe enseguida que la acción empezó.
- Luego el parabrisas se despeja de abajo hacia arriba en unos 14 s. Un desempañador real tarda minutos, pero lo comprimí para que se vea completo sin hacer esperar a quien maneja.
- El sonido se apaga justo cuando el vidrio queda limpio, lo que marca el final.
- El testigo se enciende al instante y se queda mientras el desempañador esté activo; al apagarlo se desvanece en menos de un segundo.

**Qué NO debe pasar:**
- Que el vidrio empañado tape la vía por completo: siempre debe dejar ver la carretera.
- Que el empañamiento se quede puesto o vuelva a aparecer después de despejarse.
- Que el empañamiento invada el tablero, la pantalla central o los pilares: solo va sobre el vidrio.
- Que el sonido del ventilador sea fuerte o compita con la voz del asistente.
- Que el testigo parpadee o use rojo, porque se confundiría con una alerta.
- Que se anime al recargar la página: si el desempañador ya estaba encendido, se muestra el testigo y el vidrio limpio, sin repetir el despeje.

## 3. Alternativas que consideraste

**Alternativa 1:** consideré hacer el efecto de vidrio empañado como una capa en 2d. Esta capa tiene coordenadas fijas, y al descubrir que el simulador permite campiar la posición del conductor y de la cámara, esta capa quedaba completamente desubicada.

**Alternativa 2:** consideré desempañar el vidrio instantaneamente desde que se enciende el desempañador, pero no parecia real, y el cambio era muy abrupto. 

## 4. Diseño elegido

Decidí hacer el empañamiento como parte del modelo 3D del carro, sobre el vidrio del parabrisas, para que quedara fijo en su lugar sin importar la cámara, el lado del conductor o la vista.

**Forma y posición:** una película de condensación que cubre todo el parabrisas y sigue su curvatura. El techo, el tablero y los pilares la tapan donde quedan delante, así que nunca se sale del vidrio. La pantalla central se dibuja por encima del empañamiento, como en un carro real donde está dentro de la cabina.

**Aspecto:** gris claro, casi blanco, con una textura irregular. Su opacidad varía entre 0,55 y 0,93: nubla la vista, pero la carretera se sigue viendo. Recibe la misma iluminación que la cabina, así que de día se ve pálido y de noche se oscurece con la escena, en vez de brillar.

**Cómo se despeja:** de abajo hacia arriba, con un borde suave, porque en los carros las salidas de aire del desempañador están en la base del parabrisas y el vidrio se aclara primero por ahí. El despeje empieza lento, acelera en el medio y termina suave.

**Tiempos:**
- Al activar: el empañamiento aparece en 400 ms y empieza a despejarse.
- Despeje completo: 14 s. Al terminar, el empañamiento desaparece y no vuelve.
- Al desactivar: el empañamiento se quita y el sonido se detiene; el testigo se desvanece en 700 ms.
- Al recargar la página: el testigo muestra el estado actual y el vidrio queda limpio, sin animación.

**Testigo:** el símbolo estándar del desempañador delantero (parabrisas con tres flechas onduladas hacia arriba, ISO 7000-0635) y el del trasero (rectángulo con flechas onduladas, ISO 7000-0636), en ámbar, pequeños, en la esquina inferior izquierda. Se encienden en 250 ms y se quedan mientras el desempañador esté activo. Usé ámbar y no rojo para que no se confundan con una alerta.

**Sonido:** un soplido de ventilador sintetizado (ruido filtrado, sin archivos de audio). Sube en 1,5 s al activar y se apaga en los últimos 3 s, justo cuando el vidrio termina de despejarse. Su volumen sube con la velocidad del ventilador (`fan_speed`), entre 0,12 y 0,25, para no competir con la voz del asistente. El desempañador trasero solo hace un clic corto, como un relé, porque su vidrio no se ve desde la cabina.

**Referencias:**
- Los símbolos ISO 7000-0635 y 0636, que son los que se usan en los controles de desempañado de los carros reales.
- El funcionamiento de un desempañador real: el aire sale por la base del parabrisas y el vidrio se aclara de abajo hacia arriba.
- La teoría de recursos múltiples de Wickens: la información llega por la vista y por el oído al mismo tiempo, así que el sonido confirma la acción sin que quien maneja tenga que buscar nada con la mirada.

## 5. Implementación

**Nivel:** combinación de escena 3D (el empañamiento) y capa DOM (los testigos). Todo está en `src/feedback/features/defrost.js`; no toqué el motor ni otros subsistemas.

**Cómo está hecha:**
- El empañamiento es una malla curva que se añade junto al interior del carro, igual que el cluster de instrumentos. Su contorno sale de los vértices reales de la carrocería (`z_map_body.004`): el borde del techo y la base del parabrisas, del centro hacia los pilares.
- La malla usa el mismo tipo de material que la cabina (`MeshPhongMaterial`), transparente, para que reciba la misma luz de día y de noche. Su textura es un canvas: el ruido de la condensación se genera una sola vez y, durante el despeje, solo se redibuja la máscara que sube de abajo hacia arriba.
- El despeje usa un `requestAnimationFrame` que corre solo durante los 14 s y se detiene solo. Después la malla queda oculta; en reposo no hay ningún bucle por cuadro.
- Los testigos son dos íconos SVG en la capa DOM (`ctx.layer`), visibles solo en la cámara en primera persona, con transiciones CSS.
- El sonido se sintetiza con WebAudio (ruido marrón con un filtro pasabanda), reutilizando el contexto de audio de la capa de feedback. El clic del trasero usa `ctx.audio.tone`.

**Qué parte del API usé:**
- `CabinFeedback.register` con `fields: ['window_front_defrost', 'window_rear_defrost']` y `onChange`, que solo lee el estado. `fan_speed` se lee del `snapshot` para el volumen; la feature nunca escribe en `VehicleState`.
- `ctx.handles()` para llegar al carro (`ego.geo`), al módulo `THREE` y a la cámara en primera persona (`firstPerson`). Como es `null` antes de **begin**, la malla se crea de forma perezosa la primera vez que hace falta, y se vuelve a crear si un cambio de vehículo reconstruye el carro.
- `ctx.layer` para los testigos y `ctx.audio` para el sonido.

**Qué fue difícil:**
- **La versión 2D no encajaba.** Una capa sobre la pantalla con coordenadas fijas se desubicaba al cambiar la cámara, el lado del conductor o el tamaño de la ventana. Además, Chrome no aplica bien una máscara a un elemento que también tiene `backdrop-filter` (el difuminado), y aparecían franjas grises sobre el techo. Eso me llevó a integrar el empañamiento al modelo.
- **Encontrar el contorno del parabrisas.** El modelo no tiene una pieza de vidrio: el parabrisas es un hueco en la carrocería, así que tuve que leer sus vértices para encontrar las esquinas.
- **La pantalla central atraviesa el vidrio.** En el modelo, el borde superior de la pantalla central queda unos 2 cm por fuera del parabrisas, así que el empañamiento se dibujaba encima. La solución fue añadir una copia de la pantalla y su marco que se dibuja después del empañamiento, solo mientras el empañamiento está visible.
- **El `THREE` del motor está minificado.** Clases como `CanvasTexture` o `BufferGeometry` no se exportan con su nombre, así que tomé los constructores de las mallas que ya existen en la escena.

## 6. Limitaciones y siguientes pasos

**Limitaciones:**
- **El empañamiento aparece al activar el desempañador.** El simulador no tiene un estado de "vidrio empañado" previo, así que el empañamiento se muestra justo cuando el asistente enciende el desempañador, para que se vea qué está resolviendo. En un carro real el vidrio ya estaría empañado antes de pedirlo.
- **No difumina lo que hay detrás.** La versión 2D difuminaba la vía, pero en 3D no hay una forma barata de hacerlo; el empañamiento es una película translúcida con textura y la carretera detrás se ve más nítida que en un entorno real.
- **El tiempo de despeje es fijo.** Siempre tarda 14 s; no depende de la velocidad del ventilador, de la dirección del aire ni del aire acondicionado, aunque en un carro real sí influyen.
- **El trasero no tiene efecto visual.** El vidrio trasero no se ve desde la cabina, así que solo tiene el testigo y un clic.
- **La pantalla central se redibuja encima del empañamiento.** Es una solución a un detalle del modelo (la pantalla atraviesa el vidrio); si ese modelo cambia, habría que revisarla.

**Cómo lo probaría con usuarios:**
Una prueba en el simulador en la que la persona maneja y, en algún momento, el asistente enciende el desempañador. Mediría:
- si entiende qué está haciendo el carro sin que se lo expliquen (preguntándole después "¿qué pasó?");
- cuándo cree que el vidrio ya quedó limpio, comparado con el momento real;
- cuántas veces aparta la mirada de la vía para buscar el testigo (con una grabación de la cara o seguimiento ocular);
- si el empañamiento afecta su manejo, con las métricas del propio simulador (por ejemplo, cuánto se desvía del carril mientras el vidrio se despeja).

Compararía tres versiones: solo el testigo, testigo con sonido, y la versión completa con el empañamiento. Al final le preguntaría si le pareció realista o si le distrajo.

**Siguientes pasos:**
- Hacer que el despeje sea más rápido o más lento según `fan_speed`, la dirección del aire hacia el parabrisas y el aire acondicionado.
- Añadir un difuminado real de la vía detrás del empañamiento.
- Mostrar el testigo dentro del cluster de instrumentos, en lugar de una esquina de la pantalla.
