# Nota de diseño: autonomy_handover

**Estado que escucha:** ctx.handles().autodrive (observable del motor; no es un campo de VehicleState)
**Autora:** Tannia Lucia Hernandez, COH1

## 1. Problema observado

En t13 (“Maneja tú”), el carro puede cambiar a conducción autónoma sin una señal periférica que aclare quién tiene el control. La activación es un cambio relevante: la persona pasa de conducir a supervisar.

## 2. Qué quiero que perciba quien maneja

Al activarse la autonomía aparece por tres segundos una etiqueta breve: “Control automático activo · el vehículo maneja”. Después permanece solo un borde tenue, periférico y sin ámbar, que indica el estado persistente sin cubrir la vía. Cuando vuelve el control manual, aparece durante tres segundos un aviso ámbar: “Toma el control · manejas tú”; luego se oculta. No hay parpadeo ni cuenta regresiva. El motor ya reproduce auto_on al activar autonomía, así que no agrego un sonido redundante.

## 3. Alternativas que descarté

- **Un mensaje grande en el centro:** cubriría la vía durante una transferencia que debe percibirse rápido.
- **Una cuenta regresiva:** el estado cambia de inmediato en el motor; añadir una cuenta inventaría una espera que no existe.
- **Un sonido adicional:** la simulación ya emite auto_on, por lo que duplicarlo sería redundante. La teoría de recursos múltiples de Wickens también me lleva a evitar estímulos que no aportan información nueva.
- **Modificar autodrive desde la feature:** convertiría el feedback en un actor que cambia el estado evaluado. Esta feature solo observa el observable.
- **Mantener el ámbar durante todo el modo autónomo:** lo reservé para el aviso breve de devolución del control; el estado autónomo queda como borde tenue.

## 4. Decisión de diseño

Uso solo el perímetro, con grosor máximo de 0,6vw, para dejar despejado el centro de la carretera. Antes de que el simulador exponga los handles no aparece nada. Sondeo ctx.handles() una vez por segundo hasta encontrar autodrive; si el observable expone addListener/removeListener, registro el listener una sola vez y detengo el sondeo. Si no los expone, leo .value cada 500 ms. La primera lectura renderiza el estado existente sin transición; una recarga no parece una activación nueva. Si la autonomía ya está activa al cargar, aparece solo el borde tenue. La etiqueta de tres segundos se reserva para una activación que ocurre después de la carga.

## 5. Implementación y verificación

La feature declara fields: [], no usa PromptDrive.dynamic.set ni llama a autodrive.set, y elimina el listener/temporizadores al disponerla. En la reproducción local completa observé t13 y el aviso al devolver el control; Tannia confirmó que pudo retomar el manejo con el teclado. Después del último cambio, una comprobación focal verificó que el estado activo en la primera lectura muestra solo el borde tenue y que una activación posterior conserva la etiqueta de tres segundos. No hice una comprobación visual específica de recarga con la autonomía activa ni una revisión sistemática de consola.

## 6. Limitaciones

El borde indica el estado de autonomía del simulador, no si la persona está preparada para retomar el control ni si el sistema puede conducir con seguridad. La duración del aviso no se ha evaluado con participantes. Como evaluación futura, propondría medir si las personas identifican quién controla el vehículo y cuánto tardan en responder a la devolución del control, con y sin el indicador, en una simulación; no realicé ese estudio. El borde es una convención visual para este reto, no un testigo normalizado de un vehículo real.

Referencia de diseño: [Wickens, “Multiple Resources and Mental Workload”](https://journals.sagepub.com/doi/10.1518/001872008X288394).
