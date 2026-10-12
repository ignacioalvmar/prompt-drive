# Nota de diseño: `fog_lights`

**Autor:** Ian Saonni Rodríguez Pulido.  
**Equipo:** Ian_Rodriguez_Pulido. **Cohorte:** COH2.  
**Campo de VehicleState:** `fog_lights`.

## 1. Qué viste en el estudio

El catálogo indica que activar exploradoras cambia el estado sin mostrar nada.
En t07 el asistente enciende las bajas y las antiniebla: observar luz en la vía
no basta para distinguir ambas. El diseño parte de esa situación documentada
en el guion del reto, sin atribuir al autor una observación personal del estudio.

## 2. Qué debería percibir quien maneja

La persona debe reconocer el estado de las exploradoras mediante un indicador
persistente y ver un haz bajo sobre el suelo. El testigo comunica el estado
aceptado inmediatamente; la luz acompaña el cambio suavemente. No hace falta
otra confirmación hablada ni un botón adicional.

## 3. Alternativas consideradas

- Solo un aviso temporal: confirma la acción, pero deja de informar el estado.
- Solo iluminar el camino: resulta inmersivo, pero es ambiguo respecto a las
  luces bajas y puede ser poco perceptible de día.
- Testigo persistente y luces 3D independientes: da una señal explícita y un
  efecto ambiental. Se eligió esta combinación.

Una primera aproximación con una malla amarilla sobre el suelo no resultó
visible en la captura, pese a existir en la escena. Se sustituyó por luces
nativas que afectan al material real de la carretera.

## 4. Diseño elegido

Un pictograma y texto `EXPL. ON` en ámbar, o `EXPL. OFF` en gris, debajo del
velocímetro. Dos focos amarillos (`0xffce48`) se sitúan por debajo de los faros
originales y apuntan al suelo. El haz sigue el vehículo sin dibujar una mancha
fija sobre la pantalla. La intensidad se aproxima al objetivo con una constante
de unos 100 ms; alcanza el valor final en menos de un segundo. La primera
representación y el movimiento reducido usan el objetivo inmediatamente.

El catálogo sugiere verde para el testigo. Aquí se escogió ámbar para conservar
la correspondencia con el haz amarillo solicitado; el texto distingue el
estado además del color. Es una elección para el prototipo, pendiente de
revisar si se busca reproducir convenciones normalizadas de vehículos reales.

## 5. Implementación

`src/feedback/features/fog_lights.js` registra exclusivamente `fog_lights`.
Recupera constructores nativos desde los faros existentes y añade dos
SpotLights al contenedor de luces del vehículo. No usa sombras adicionales.
Cada foco tiene alcance 40, ángulo 0,22, penumbra 0,8 e intensidad máxima 7.

El indicador es una textura y una malla propia, hija del panel del cuadro de
instrumentos. No modifica `InstrumentCluster.js`, su dibujo ni su estado.
Los handles ausentes se esperan sin bloquear el arranque; los recursos se
retiran y liberan al sustituir el montaje o llamar a `dispose`. Desactivar
`CabinFeedback` oculta el testigo y reduce la intensidad a cero.

No se llama a `VehicleState.set`, no se añaden dependencias y no hay imágenes
externas. El API y las órdenes del asistente conservan su comportamiento.
Prueba: ejecutar t07 y x02b; también activar las exploradoras con las bajas
apagadas para comprobar su independencia. Comparar estado antes/después del
dibujo, recargar con estado inicial activo y comprobar benchmark.

## 6. Limitaciones y siguientes pasos

No se modelan ópticas certificadas ni dispersión de niebla. El resultado depende
de la iluminación y del material de la carretera; bajo sol intenso puede ser
menos visible. El indicador mantiene información explícita en ese caso. Los
valores físicos de intensidad y alcance son ajustes del motor, no especificaciones
de un faro real. El texto del indicador no cambia de idioma.

Con usuarios, probar si distinguen bajas y exploradoras con una mirada breve,
comparar día/noche y comprobar que el testigo no distrae. Un segundo día
permitiría ajustar el haz y estudiar la convención cromática del indicador.
