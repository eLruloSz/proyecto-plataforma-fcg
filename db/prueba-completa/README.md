# Prueba completa del proceso (etapas 1 a 5)

Datos inventados para recorrer la plataforma de punta a punta, generados con
`scripts/generar_prueba_completa.py` (semilla fija: siempre salen los mismos).

| Archivo | Para qué |
|---|---|
| `1_nominas/nomina_liceo_XX.xlsx` | Nómina de notas de cada liceo (27; el 12 no participa) |
| `2_Forms_confirmacion_interes_2026.xlsx` | Respuestas del formulario 1 (Microsoft Forms) → Invitados › Importar respuestas |
| `3_Ranking_Preseleccion_N1_2026.xlsx` | Ranking de la fundación (sin columna Finalistas). Cargar la pestaña `35.40.25` (sobre 100) |
| `GUIA_prueba_completa.xlsx` | Paso a paso y quién avanza / no avanza en cada etapa |

Embudo: 160 invitados → 146 → 139 → 60 a entrevista → 20 al comité → 10 becarios.

**Para que los Id calcen** con el ranking y la guía: invitar liceo por liceo en orden
de código (01, 02, 03… sin el 12), cada uno de una sola vez con "mejores del liceo"
y el N de la hoja *Liceos* de la guía. Partir de una base desde cero.

Regenerar:

```bash
python3 scripts/generar_prueba_completa.py db/nominas-demo/nomina_liceo_02.xlsx db/prueba-completa
```
