# Nota de diseño: `fog_lights`

**Campos de VehicleState o estados del agente a los que reacciona:** `fog_lights`
**Autores:** DanielMolina (dafeshark), COH-4 — implementación asistida por IA (ver `AI_LOG.md` en el fork)

## 1. Qué viste en el estudio

"Prende las exploradoras": el asistente confirmaba por voz, `fog_lights` cambiaba a `true` y en la cabina no aparecía ni un testigo ni cambio en la vía. Si la confirmación de voz se perdía (ruido, otra conversación), no había forma de comprobarlo.

## 2. Qué debería percibir quien maneja

- **Que se prendieron/apagaron:** clic de relé corto (doble tic, < 100 ms) y testigo verde.
- **Estado persistente:** el testigo verde se queda mientras estén prendidas, en el borde inferior izquierdo (zona del cluster), visible en visión periférica.
- **Efecto en la vía:** un resplandor cálido, bajo y ancho en la parte inferior de la imagen, como el haz plano de una antiniebla.
- **Qué NO debe pasar:** brillo en el centro de la vía, colores de alerta (rojo/ámbar parpadeante), animaciones repetitivas.

## 3. Alternativas que consideraste

1. **Haz de luz 3D en la escena (SpotLight en el carro).** Más realista, pero exige depender de `ctx.handles()` y del motor; en calidad gráfica mínima puede no verse y afecta rendimiento. Descartado para esta versión.
2. **Solo el testigo.** Cumple la convención, pero no transmite el efecto físico ("ahora veo más abajo y más ancho"). Se mantuvo como canal principal y se complementó.
3. **Notificación textual en la consola central.** Requiere leer y compite con la franja del asistente. Descartado.
4. **Haz amarillo intenso.** Se confundía con un aviso y tapaba la vía. Se bajó a opacidad 0.22 con mezcla `screen`.

## 4. Diseño elegido

- Testigo SVG verde `#3ddc84` con el símbolo ISO 2575 de antiniebla delantera (lámpara, rayos inclinados, línea ondulada), en pastilla oscura semitransparente abajo a la izquierda, transición de 250 ms con leve escala.
- Resplandor elíptico cálido (`rgba(255,236,190,0.22)`) en el 16 % inferior, fundido de 400 ms.
- Doble tic de relé (onda cuadrada, 25 ms, volumen ≤ 0.05).
- Referencia: los testigos verdes de antiniebla delantera de cualquier tablero (verde = sistema activo, sin urgencia).

## 5. Implementación

Capa DOM (`ctx.layer`), `ctx.audio.tone`. Sin escena 3D, sin escritura en `VehicleState`. El primer `onChange` aplica el estado inicial sin sonido. El testigo tiene `role="status"` y `aria-label` para lectores de pantalla.

## 6. Limitaciones y siguientes pasos

- El resplandor no depende de la oscuridad/clima de la escena; de día debería ser casi invisible. Con un segundo día lo modularía con la hora del simulador o lo llevaría a la escena 3D.
- No hay testigo de antiniebla trasera (el estado no la distingue).
- Prueba con usuarios: ¿se detecta el testigo en visión periférica en < 1 s? ¿se confunde el resplandor con las luces bajas?
