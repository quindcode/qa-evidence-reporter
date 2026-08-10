# qa-evidence-reporter

Herramienta de línea de comandos para ejecutar sesiones de **QA manual** sobre
features Gherkin (`.feature`), capturar evidencia (imágenes/videos/PDFs) paso
a paso desde una UI web local, y generar un **reporte HTML auto-contenido**
(dashboard + drill-down por feature, funciona offline, exportable a `.zip`).

> Para el detalle completo de arquitectura, decisiones técnicas y el
> historial de cambios de cada fase de construcción, ver
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) — este README solo cubre lo que un
> usuario final necesita para instalar y usar la herramienta.

## Instalación

```bash
npm install -g qa-evidence-reporter
```

> **Nota:** este paquete todavía no está publicado en el registro de npm — el
> comando de arriba es el flujo final una vez publicado. Mientras tanto,
> instalalo desde el repo (ver sección siguiente).

Requiere Node.js 18 LTS o superior. No hay dependencias nativas ni binarios
externos que instalar aparte (thumbnails de imagen con `jimp`, puro
JavaScript; ver `ARCHITECTURE.md` para el resto del stack).

## Probarlo desde el repo (para revisores / sin publicar en npm)

Pensado para alguien que solo quiere clonar y ver la herramienta andando, sin
instalar nada de forma global ni tocar otros proyectos.

```bash
git clone https://github.com/quindcode/qa-evidence-reporter.git
cd qa-evidence-reporter
npm install
npm run build          # compila CLI/server (tsc) + la UI (vite build)
```

**Camino más rápido — demo con datos reales (`sample-project/`):**

```bash
cd sample-project
node ../dist/adapters/cli/index.js run
```

Esto levanta el runner en `http://localhost:4173` con 3 features ya escritos
(Login, Búsqueda, Carrito de compras — 12 escenarios) para poder seleccionar,
ejecutar steps, adjuntar evidencia y generar un reporte sin escribir nada
antes. Ctrl+C en la terminal lo detiene.

**Camino "de cero", como lo usaría un QA real:**

```bash
mkdir mi-prueba-qa && cd mi-prueba-qa
node ../dist/adapters/cli/index.js init
# escribí un .feature en features/, o copiá alguno de sample-project/features/
node ../dist/adapters/cli/index.js run
```

**Para tener el comando `qa-evidence-reporter` corto** (en vez de
`node ../dist/adapters/cli/index.js`), desde la raíz del repo:

```bash
npm link
qa-evidence-reporter run   # ahora funciona desde cualquier carpeta
```

### Cómo dar feedback

Cualquier hallazgo (bug, algo confuso en el flujo, una mejora) — abrilo como
[Issue en el repo](../../issues) para que quede registrado y se pueda
priorizar. Si es sobre el reporte HTML generado, adjuntá el `.zip` exportado
(botón "Exportar como ZIP") para que se pueda reproducir exactamente lo que
viste.

## Flujo de uso

```bash
# 1. Dentro de la carpeta de tu proyecto de QA (puede estar vacía):
qa-evidence-reporter init

# 2. Escribí/editá tus .feature en features/ (init deja uno de ejemplo).

# 3. Levantá el runner interactivo:
qa-evidence-reporter run

# 4. Cuando termines la sesión (o en cualquier momento, sobre el progreso
#    ya guardado), generá el reporte HTML final:
qa-evidence-reporter report
```

### 1. `init`

Crea, en el directorio actual:

- `features/` (con un `.feature` de ejemplo, comentado y editable/borrable)
- `evidence/` y `reports/` (vacíos)
- `qa-config.json` (ver formato completo más abajo)

```bash
qa-evidence-reporter init --name "Mi Proyecto" # opcional, si no se toma el nombre de la carpeta
qa-evidence-reporter init --force              # sobreescribe qa-config.json si ya existe
```

### 2. Escribir/editar `.feature`

Cualquier `.feature` válido en Gherkin, en `features/` (subcarpetas
permitidas). Soporta español (agregando `# language: es` como primera línea
del archivo) e inglés (por defecto), tags (`@smoke`, `@regression`, etc.),
`Background`/`Antecedentes` y `Scenario Outline`/`Esquema del escenario` con
`Examples`/`Ejemplos` (cada fila se ejecuta como un escenario concreto
independiente). Ver `sample-project/features/*.feature` para ejemplos reales
de las tres variantes.

### 3. `run`

Levanta el server HTTP interactivo (`http://localhost:{puerto}`, configurable
en `qa-config.json`) y, si `server.openBrowser` es `true`, intenta abrir el
navegador automáticamente (si falla — p. ej. sin entorno gráfico — el
servidor sigue disponible igual por URL, solo se avisa por log). Desde ahí:

1. Seleccionás qué features correr.
2. Recorrés cada step, adjuntando evidencia (file picker, drag&drop o
   `Ctrl+V` sobre el área de evidencia) y marcando el resultado.
3. El progreso se autoguarda en `.qa-evidence-reporter/session.json` en cada
   acción — se puede cerrar la terminal/navegador y retomar exactamente donde
   quedó volviendo a correr `run`.

El proceso queda corriendo en primer plano hasta que lo interrumpís con
`Ctrl+C` (`SIGINT`) — cierra el servidor de forma prolija antes de terminar.

### 4. `report`

Genera el reporte HTML final (`reports/index.html` + `reports/features/*.html`)
a partir de la última sesión guardada. El reporte es auto-contenido (CSS/JS
inline, imágenes de evidencia copiadas junto al HTML) y funciona abriendo
`index.html` directamente con `file://`, sin necesitar ningún servidor. Desde
la UI del runner (o llamando a `POST /api/report/generate` +
`GET /api/report/export-zip`) también se puede exportar como `.zip` para
compartirlo.

## Usarlo para ejecutar un test plan completo

La herramienta no reemplaza un test plan formal (objetivos de negocio,
riesgos, cronograma, criterios de entrada/salida siguen siendo una decisión
tuya, documentada aparte) — lo que hace es estandarizar la **ejecución**,
**evidencia** y **reporte** de un conjunto de casos ya definidos como
`.feature`. Esta es la forma recomendada de usarla para ese fin, y las
trampas reales del modelo actual que conviene conocer antes de empezar.

### Paso a paso

1. **Definí el alcance como estructura de carpetas/archivos, no solo como
   tags.** La selección de qué correr en `run` es **por archivo `.feature`
   completo** (todos sus scenarios se incluyen, no hay selección por
   scenario ni por tag desde la UI todavía). Si tu test plan necesita poder
   ejecutarse por partes (por ejemplo "solo smoke" o "solo el módulo de
   pagos"), organizá esa división como archivos/carpetas separados dentro de
   `features/` (`parseDirectory` es recursivo), no confíes solo en tags para
   poder cortar el alcance después.
2. **Escribí los `.feature`** cubriendo todo el alcance del plan: usá
   `Background` para precondiciones compartidas dentro de un feature,
   `Scenario Outline` + `Examples` para variantes de datos, y tags
   (`@smoke`, `@regression`, `@critico`, lo que tenga sentido para tu equipo)
   para clasificar — hoy son informativos (se muestran en el reporte y en el
   selector) pero no filtran la ejecución.
3. **Configurá `qa-config.json`** antes de arrancar: `projectName`, `team`
   (quiénes ejecutan), y `evidence.maxFileSizeMB`/`evidence.allowedFormats`
   si vas a adjuntar screen recordings pesados o formatos fuera del default.
4. **`init`** (si el proyecto todavía no existe) y ubicá tus `.feature` en
   `features/`.
5. **`run`**, seleccioná los features que forman esta corrida del plan, y
   recorré cada step adjuntando evidencia real, marcando el resultado y
   completando notas/descripción de defecto donde corresponda. Si el plan es
   grande, hacelo en varias sesiones de trabajo — el progreso se autoguarda
   y `run` retoma exactamente donde quedaste.
6. **Al completar la corrida (o en cualquier corte que necesites reportar
   parcialmente)**, generá el reporte y **exportá el `.zip` inmediatamente**
   — es tu snapshot de esa corrida.
7. **Archivá ese `.zip` con un nombre que identifique la corrida** (fecha,
   sprint, versión — `reports/report-2026-08-10-sprint-14.zip`, por
   ejemplo) ANTES de volver a correr `report` sobre una sesión nueva (ver
   el punto 2 de "qué NO hacer" — se sobreescribe).
8. **Compartí el `.zip`** (o el link al `reports-static/` si el server
   sigue corriendo) con tus líderes, y usá los Issues del repo para
   centralizar el feedback que te den.

### Qué NO hacer

- **No edites los `.feature` esperando que una sesión ya en curso los
  "recoja".** Al seleccionar features, sus scenarios/steps quedan
  congelados dentro de `session.json` en ese momento — editar el archivo
  fuente después no actualiza la sesión activa. Terminá o descartá la
  sesión actual (ver punto siguiente) antes de editar y volver a
  seleccionar.
- **No vuelvas a pasar por la pantalla de selección "para actualizar" sin
  pensarlo.** Si hay una sesión sin completar, `run` te va a pedir
  confirmación explícita porque **selecciona de nuevo = descarta el
  progreso no exportado a un reporte**. Si no estás seguro de haber
  guardado lo que ya avanzaste, generá y exportá el reporte primero.
- **No corras dos instancias de `run` en paralelo sobre el mismo
  proyecto.** Todas comparten el mismo `.qa-evidence-reporter/session.json`
  sin bloqueo de archivo — escrituras concurrentes se pueden pisar entre
  sí. Un server por proyecto a la vez.
- **No asumas que un reporte anterior queda guardado solo.** `report`
  escribe siempre sobre la misma carpeta `reports/`; generar uno nuevo
  sobreescribe `index.html` y las páginas de feature. Si necesitás
  historial entre corridas (por sprint, por release), archivá el `.zip`
  exportado antes de la siguiente — la herramienta no versiona reportes por
  vos.
- **No adjuntes lo que el `qa-config.json` no permite** (formatos fuera de
  `evidence.allowedFormats`, o archivos más grandes que
  `evidence.maxFileSizeMB`) esperando que "simplemente funcione" — se
  rechazan con error (`415`/`413`); ajustá la config antes si lo necesitás.
- **No esperes trazabilidad automática a Jira/Azure DevOps/etc.** La
  "descripción del defecto" vive solo en la sesión y en el reporte; si tu
  proceso requiere un ticket, copiala manualmente al sistema que usen.
- **No la uses como el único documento del test plan.** Cubre ejecución +
  evidencia + reporte de casos ya escritos como `.feature`, no la
  planificación (objetivos, riesgos, cronograma, criterios de
  entrada/salida) ni la gestión de casos fuera de Gherkin — eso seguí
  documentándolo donde ya lo hacías.
- **No dejes que dos personas ejecuten sobre el mismo server sin
  coordinarse.** Es una sesión compartida en tiempo real: dos personas
  marcando resultados o navegando steps a la vez sobre el mismo proceso van
  a pisarse (última acción gana, sin "carriles" por usuario).

## Atajos de teclado (runner)

Activos mientras el foco NO esté sobre un campo de texto (notas, descripción
de defecto) — ahí se desactivan por completo para no interferir con lo que
estés escribiendo.

| Tecla | Acción                                                                |
| ----- | --------------------------------------------------------------------- |
| `P`   | Marcar el step actual como **Pass**                                   |
| `F`   | Marcar el step actual como **Fail** (requiere descripción de defecto) |
| `S`   | Marcar el step actual como **Skip**                                   |
| `N`   | Ir al step **siguiente**                                              |
| `B`   | Ir al step **anterior**                                               |

También: `Ctrl+V` sobre el área de evidencia sube una imagen del portapapeles,
y se puede arrastrar y soltar (drag & drop) uno o más archivos sobre esa misma
área. El tema claro/oscuro tiene un toggle propio y se persiste en
`localStorage`.

## `qa-config.json`

```json
{
  "$schema": "./node_modules/qa-evidence-reporter/config.schema.json",
  "projectName": "Mi Proyecto QA",
  "team": [],
  "featuresDir": "features",
  "evidenceDir": "evidence",
  "reportsDir": "reports",
  "server": { "port": 3000, "openBrowser": true },
  "evidence": {
    "maxFileSizeMB": 50,
    "allowedFormats": ["png", "jpg", "jpeg", "gif", "mp4", "webm", "pdf"]
  },
  "logging": { "level": "info" },
  "reportTemplate": null
}
```

Todos los campos son opcionales (una config parcial se completa con estos
defaults); `qa-evidence-reporter init` escribe siempre el archivo completo.

| Campo                     | Tipo                                     | Descripción                                                                                          |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `projectName`             | `string`                                 | Nombre mostrado en el header del runner y del reporte.                                               |
| `team`                    | `string[]`                               | Lista libre de integrantes del equipo (informativo, se muestra en el reporte).                       |
| `featuresDir`             | `string`                                 | Carpeta (relativa al directorio del proyecto) donde viven los `.feature`.                            |
| `evidenceDir`             | `string`                                 | Carpeta donde se guardan los archivos de evidencia subidos (organizados por feature/scenario/step).  |
| `reportsDir`              | `string`                                 | Carpeta donde `report` escribe el HTML final.                                                        |
| `server.port`             | `number`                                 | Puerto HTTP donde escucha `run`.                                                                     |
| `server.openBrowser`      | `boolean`                                | Si `run` intenta abrir el navegador automáticamente al arrancar.                                     |
| `evidence.maxFileSizeMB`  | `number`                                 | Tamaño máximo por archivo de evidencia; archivos más grandes se rechazan (`413`).                    |
| `evidence.allowedFormats` | `string[]`                               | Extensiones permitidas (sin el punto); cualquier otra se rechaza (`415`).                            |
| `logging.level`           | `"debug" \| "info" \| "warn" \| "error"` | Nivel de log interno (diagnóstico, no la salida de usuario de los comandos).                         |
| `reportTemplate`          | `string \| null`                         | Ruta a un template Handlebars custom, o `null` para usar el template embebido (`templates/default`). |

## Sample project

`sample-project/` contiene un proyecto de ejemplo completo (3 `.feature`
reales, mezclando español e inglés, con tags y un `Scenario Outline`) y
`sample-project/simulate-session.mjs`, un script que ejercita el server real
de punta a punta (selección, evidencia real, resultados mixtos, reporte, ZIP)
sin necesitar un navegador. Ver los comentarios de ese archivo para el detalle
de dónde queda el reporte generado.

## Arquitectura (resumen)

- **`core/`**: lógica de negocio pura (parser Gherkin, motor de sesión,
  almacenamiento de evidencia, generación de reportes, config, logger) — sin
  conocimiento de HTTP/CLI/UI.
- **`adapters/cli/`**: los 3 comandos (`init`/`run`/`report`), sobre
  `commander`.
- **`adapters/server/`**: API REST (`express`) que `run` levanta para la UI
  interactiva.
- **`src/ui/`**: runner web (Preact + Vite), habla con el server solo por
  `fetch`.
- **`templates/`**: templates Handlebars del reporte HTML.

Ver [`ARCHITECTURE.md`](./ARCHITECTURE.md) para las decisiones técnicas
completas, los contratos de cada módulo y el historial detallado de cada fase
de construcción.
