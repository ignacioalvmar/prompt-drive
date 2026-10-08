## Cabina Abierta: feedback feature(s)

**Team / autores:**
**Cohorte (COH1 a COH4):**
**Video (max 3 min, inglés):**

### Features en este PR (1 a 3)

| id (`src/feedback/features/<id>.js`) | Campos de VehicleState o estado del agente | Qué percibe quien maneja |
| --- | --- | --- |
| | | |

### Notas de diseño

Enlace a `docs/feedback/<id>.md` por cada feature (problema, alternativas consideradas, decisión, limitaciones).

### Checklist

- [ ] Solo toqué `src/feedback/features/` (y `docs/feedback/`); no edité `static/js/*.js` a mano
- [ ] `npm run build:feedback` corre sin errores y el bundle regenerado está en el commit
- [ ] Ninguna feature escribe en `VehicleState` (el feedback muestra el estado, no lo cambia)
- [ ] Funciona desde el inicio de la simulación y tras recargar la página (estado inicial correcto)
- [ ] Probado con `demo/` del reto o con `api-test.html` (pestaña Vehicle)
- [ ] Sin dependencias nuevas ni cambios en el orden de carga de `index.html`
- [ ] `REFLEXION.md` y `AI_LOG.md` en la raíz de mi fork (no en este PR)
