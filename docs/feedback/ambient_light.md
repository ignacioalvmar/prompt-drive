# Nota de diseño: `ambient_light`

**Campos de VehicleState o estados del agente a los que reacciona:** `ambient_light` (`OFF`, `RED`, `GREEN`, `BLUE`, `YELLOW`, `WHITE`, `PINK`, `ORANGE`, `PURPLE`, `CYAN`). No usa estados del agente.
**Autores:** Julian Esteban Cadena Rojas (COH2)

## 1. Qué viste en el estudio

Durante el estudio, fue difícil hacer que el asistente me entendiera, y casi que todas las acciones que le pedí no se realizaron, además de que me hablaba en inglés. Además, cuando pedí encender la luz ambiental, el asistente no respondió y no había una prueba gráfica que me mostrara que efectivamente la luz ambiental hubiese cambiado de color o encendido. 

## 2. Qué debería percibir quien maneja

**Información:** que la luz ambiental cambió al color que se le especificó al asistente, o que se apagó. 

**Canal:** visual periférico. Al tratarse de una luz ambiental, que es una función de confort más que de seguridad, la persona no debería apartar la mirada de la vía, y debería notar por su visión periférica que la luz cambió de color. 

**Tiempo:** el cambio debe ser casi instantáneo, pues se trata de una función que se puede activar y desactivar rápidamente. Se pensó como un pulso leve al inicio, para recalcar que la luz ambiental se ha encendido, y después el nivel de intensidad de la luz baja a un punto tenue y constante. 

**Qué NO debe pasar:** 
- Tapar o teñir la vía.
- Deslumbrar al conductor (sobre todo de noche).
- Confundirse con una alerta.
- Cambiar de golpe de un color a otro. 

## 3. Alternativas que consideraste

**Alternativa 1:** consideré hacer la luz ambiental como un tenue tono que ocupara parte de la pantalla para simular que la luz inundaba todo el ambiente del auto. Lo descarté porque era muy invasivo y podría distraer al conductor. 

**Alternativa 2:** después de la alternativa 1, consideré hacer una línea a lo largo del tablero, como existe en la vida real, y modelarla como una imagen en 2D sobre el tablero del auto. Descarté esta opción porque, al ser una imagen 2D, sus coordenadas eran fijas, y al darme cuenta de que el simulador permite cambiar la posición de la cámara, así como el lado del conductor, esta imagen 2D quedaba completamente desubicada. 

## 4. Diseño elegido

Decidí hacer la luz ambiental como una tira LED que hiciera parte del modelo 3D del carro, para que así quedara fija y no se viera afectada si el usuario cambiaba las configuraciones de la cámara o de vista. 

**Forma y posición:** una línea delgada con un halo, que recorre de lado a lado la cara frontal del tablero, unos 4 cm por debajo de su borde superior. Se desvanece en los extremos, junto a las puertas. Como está pegada al modelo, el volante y el cluster la tapan donde quedan delante, igual que en un carro real, y nunca toca el parabrisas ni la vía.

**Color:** el que pide el asistente (`RED`, `GREEN`, `BLUE`, `YELLOW`, `WHITE`, `PINK`, `ORANGE`, `PURPLE`, `CYAN`), con un centro un poco más blanco, como un LED. No depende de la iluminación de la escena: brilla igual de día y de noche, sin deslumbrar porque es fina.

**Tiempos:**
- Al cambiar de color: transición suave de 600 ms entre el color anterior y el nuevo, para que no cambie de golpe.
- Al mismo tiempo, un brillo más ancho alrededor de la línea sube en 350 ms, se mantiene 1,5 s y baja en 1,2 s. Es la señal para la visión periférica; después solo queda la línea, tenue y constante.
- Al encender desde `OFF`: aparece en 500 ms con el mismo brillo.
- Al apagar (`OFF`): se desvanece en 800 ms.
- Al recargar la página: muestra el color actual de una vez, sin brillo ni animación.

**Sonido:** ninguno. El asistente ya confirma por voz, y la luz es la confirmación visual; un tono más competiría con la voz y con el ruido del motor.

**Referencias:**
- La iluminación ambiental de carros actuales como el Mercedes-Benz Clase S o los BMW, que usan tiras finas de LED en el tablero y las puertas, con colores configurables.
- Las guías de distracción de la NHTSA, que piden que ninguna mirada fuera de la vía dure más de 2 s: por eso el cambio se percibe con la visión periférica, sin tener que mirar.
- En algunos carros la luz ambiental también se usa para advertencias (por ejemplo, destellos rojos de punto ciego). Por eso el brillo de confirmación es suave y no parpadea: no debe confundirse con una alerta.

## 5. Implementación

**Nivel:** escena 3D, sin capa DOM. Todo está en `src/feedback/features/ambient_light.js`; no toqué el motor ni otros subsistemas.

**Cómo está hecha:**
- Tres mallas en forma de cinta (`feedback_ambient_core`, `feedback_ambient_halo` y `feedback_ambient_bloom`) que se añaden junto al interior del carro (`z_interior_Cube.008`), igual que el cluster de instrumentos. Siguen la cara frontal del tablero, cuyas aristas saqué de los vértices reales de esa malla.
- Material sin iluminación (`MeshBasicMaterial`), transparente, con una textura de canvas blanca que da el perfil suave de la línea y el desvanecido en los extremos. El color se aplica sobre el material, así que cambiar de color no exige redibujar la textura.
- Las transiciones (cruce de color, brillo, encendido y apagado) usan un `requestAnimationFrame` que solo corre mientras dura la transición y se detiene solo. En reposo no hay ningún bucle por cuadro.

**Qué parte del API usé:**
- `CabinFeedback.register` con `fields: ['ambient_light']` y `onChange`, que solo lee el valor; la feature nunca escribe en `VehicleState`.
- `ctx.handles()` para llegar al carro (`ego.geo`) y al módulo `THREE` del motor. Como es `null` antes de **begin**, la tira se crea de forma perezosa: el estado inicial se guarda y se aplica en cuanto el carro existe, sin animación.
- Una comprobación ligera cada segundo vuelve a montar la tira si un cambio de vehículo reconstruye el carro.

**Qué fue difícil:**
- **Las versiones 2D no encajaban.** Una línea dibujada sobre la pantalla con coordenadas fijas se desubicaba al cambiar la cámara o el lado del conductor, e incluso con la cámara quieta se movía unos píxeles porque la cámara cabecea con la pendiente de la vía. Eso me llevó a integrarla al modelo.
- **Encontrar dónde poner la tira.** El modelo no tiene una pieza "tablero" con nombre claro: tuve que leer los vértices del interior para encontrar la cara frontal (su borde superior y el inferior) y medirla en el sistema de coordenadas del carro.
- **El `THREE` del motor está minificado.** Clases como `MeshBasicMaterial` o `BufferGeometry` no se exportan con su nombre (por ejemplo, el material se llama `C`), así que tomé los constructores de las mallas que ya existen en la escena.

## 6. Limitaciones y siguientes pasos

**Limitaciones:**

- **Solo está en el tablero.** En carros reales la luz ambiental suele seguir también por las puertas y la consola; aquí no la extendí.
- **No ilumina la cabina.** La línea brilla, pero no proyecta luz sobre las superficies cercanas como lo haría un LED real; el brillo al cambiar de color lo imita solo alrededor de la línea.
- **No sé si el brillo se nota de verdad con la visión periférica.** Lo diseñé para eso y al menos en mi experiencia noto la luz cuando cambia, pero habría que probar en más personas. 

**Cómo lo probaría con usuarios:**
Una prueba en el simulador en la que la persona maneja siguiendo la vía y, en momentos al azar, el asistente cambia el color de la luz ambiental. Le pediría que diga "cambió" en cuanto lo note, sin apartar la mirada de la vía. Mediría:
- cuánto tarda en notar el cambio;
- si acierta el color nuevo;
- cuántas veces mira el tablero (con una grabación de la cara o seguimiento ocular).

Compararía la versión sin brillo de confirmación con la versión actual, de día y de noche. Al final le preguntaría si la luz le pareció útil o si le molestó.

**Siguientes pasos:**
- Extender la tira a las puertas y ajustar su intensidad según la hora del día del simulador.
- Simular que la luz ilumina las superficies cercanas del tablero.
