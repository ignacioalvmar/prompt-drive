# Nota de diseño: cabin_openings

**Campos que escucha:** window_driver_position, window_passenger_position, window_driver_rear_position, window_passenger_rear_position, sunshade_position, sunroof_position, air_conditioning
**Autora:** Tannia Lucia Hernandez, COH1

## 1. Problema observado

En el guion de Cabina Abierta, el asistente puede decir “listo” después de mover una ventana o abrir el techo, pero la acción no siempre tiene una señal visible que permita comprobar cuál apertura cambió y cuánto. Si el A/C está encendido o empieza a llover, tampoco queda claro de un vistazo qué apertura sigue expuesta. El problema concreto es: “dijo listo y no vi nada”, por ejemplo después de t10.

## 2. Qué quiero que perciba quien maneja

Un pictograma superior del carro ubica las cuatro ventanas y el techo según el puesto real del conductor. El porcentaje y el tamaño de la zona abierta comunican la posición; el color es una señal adicional, no la única. La tarjeta aparece en el lado de la pantalla opuesto al conductor. En detalle ocupa cerca del 18vw y pasa, tras 2,5 segundos, a una vista compacta cercana al 11vw mientras haya una ventana o el techo abierto.

Si todo queda cerrado, aparece una sola confirmación neutral y breve, y luego se oculta. Cambiar solo el A/C cuando no hay aperturas no muestra una tarjeta falsa de “Todo cerrado”. Si el techo figura abierto con la cortinilla cerrada o parcialmente retraída, el diagrama muestra el techo abierto y lo resalta en ámbar; la cifra no contradice el dibujo. Cuando el guion está retirando la cortinilla hasta abrirla por completo, la animación del techo espera a que termine ese recorrido para hacer visible el orden de AUT-POL:005. Con movimiento reducido, se muestra directamente el estado final.

El riesgo aparece en ámbar, sin destellos, mientras haya una ventana abierta con el A/C o con lluvia, o el techo abierto con lluvia. Si la API de clima falla o entrega una lista vacía, la feature sigue mostrando aperturas y no inventa una alerta de lluvia. No agrego sonido: el asistente ya habla y el simulador tiene ruido de viento; un tono no diría qué ventana cambió ni cuánto.

## 3. Alternativas que descarté

- **Animar el vidrio en la escena 3D:** depende de la cámara, del modelo y del motor; no garantiza que la persona vea el lado que cambió.
- **Usar solo sonido:** confirma que ocurrió algo, pero no identifica la apertura ni su porcentaje. Además, el asistente ya comunica el resultado hablando.
- **Usar la franja de estado de la consola:** las features comparten ese rectángulo y agent_indicator ya lo ocupa; una segunda visualización se superpondría.
- **Una lista de texto sin pictograma:** obliga a relacionar nombres con asientos. El mapa espacial pone cada apertura en el lado que ocupa en el carro y mantiene el porcentaje disponible como texto.
- **Un pictograma 3D de puertas o vidrios:** dependería de la cámara y del motor; mantengo el diagrama 2D independiente de la vista de conducción.

## 4. Decisión de diseño y referencias

Elegí un SVG de vista superior, con el frente hacia arriba, que se refleja para el conductor a la derecha. La tarjeta es pequeña y permanece fuera del centro de la vía. La correspondencia espacial entre la ubicación de una apertura en el carro y su indicador es una hipótesis basada en compatibilidad espacial estímulo-respuesta; no afirmo que mejore la conducción sin medirlo. Los tableros de vehículos también usan pictogramas para indicar puertas o portón abiertos; tomo esa convención como referencia visual, no copio un símbolo normalizado.

Tomé la guía de NHTSA como objetivo de diseño: permitir reconocer la señal con una mirada breve; sus criterios para tareas visuales recomiendan limitar cada mirada fuera de la vía a 2 segundos y el tiempo acumulado a 12 segundos. La actualización se hace sin interacción. ISO 15008 trata contraste y legibilidad de información visual dinámica a bordo; aquí la tomo como referencia, no afirmo conformidad con la norma. ISO 2575 especifica símbolos convencionales de controles e indicadores. El pictograma de carro de esta feature es propio. La teoría de recursos múltiples de Wickens orienta la decisión de no añadir un tono redundante mientras el asistente ya habla.

Referencias: [NHTSA, Visual-Manual Driver Distraction Guidelines](https://www.nhtsa.gov/document/visual-manual-nhtsa-driver-distraction-guidelines-vehicle-electronic-devices-0); [ISO 15008:2017](https://www.iso.org/standard/62784.html); [ISO 2575:2021 y enmienda de 2024](https://www.iso.org/standard/68409.html); [Wickens, “Multiple Resources and Mental Workload”](https://journals.sagepub.com/doi/10.1518/001872008X288394); [compatibilidad espacial en alertas vehiculares, PubMed](https://pubmed.ncbi.nlm.nih.gov/22103964/); [testigo de puerta o portón abierto, guía oficial Honda Pilot](https://owners.honda.com/utility/download?path=%2Fstatic%2Fpdfs%2F2011%2FPilot%2Fpilot_dashboard.pdf).

## 5. Implementación y verificación

cabin_openings solo lee los campos declarados y escucha weatherChange para el contexto. No llama a APIs de escritura. Los valores no finitos se tratan como cero y los demás se limitan a 0–100. La primera lectura y el reset representan el estado restaurado sin animar ni anunciar una acción nueva. Cambios cercanos se agrupan durante 150 ms; CSS retargetea una transición en curso en vez de crear un ciclo permanente. Las dimensiones de la interfaz usan unidades relativas.

Después de reducir la tarjeta y corregir la representación de estados ejecuté Reproducir todo en la demo local. Observé la apertura de la ventana en t10, la confirmación neutra al cerrarla en t11 y el orden cortinilla-techo en x01. El paso t03 mantiene las aperturas cerradas; la lógica evita mostrar una tarjeta por un cambio aislado de A/C. Una prueba manual anterior cubrió los avisos de A/C y lluvia. El guion t11 no modifica el clima, así que no presento esa reproducción como validación de lluvia real. No hice una revisión sistemática de la consola ni probé un paso dedicado al techo abierto con la cortinilla cerrada.

## 6. Prueba individual y limitaciones

La prueba es individual; no haré un miniestudio ni presentaré estos resultados como evidencia de usabilidad general. No probé por separado el estado de techo abierto con la cortinilla cerrada ni hice una revisión sistemática de consola. Como evaluación futura, propondría pedir a participantes que identifiquen qué apertura cambió y cuánto, con y sin la tarjeta, en una simulación controlada; mediría precisión y tiempo de respuesta. Esa evaluación no se ha realizado. La señal se diseñó para un simulador en pantalla, no para certificar una interfaz de vehículo real. La animación representa un recorrido aunque VehicleState cambie de golpe; el esquema requiere revisión visual en distintos tamaños de pantalla.
