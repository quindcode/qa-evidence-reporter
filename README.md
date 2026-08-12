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

Este paquete todavía no está publicado en el registro de npm, así que hoy se
instala desde el código fuente. Requiere **Node.js 18 LTS o superior** — no
hay dependencias nativas ni binarios externos que instalar aparte (los
thumbnails de imagen se generan con `jimp`, puro JavaScript).

```bash
git clone https://github.com/quindcode/qa-evidence-reporter.git
cd qa-evidence-reporter
npm install
npm run build   # compila CLI/server (tsc) + la UI (vite build)
npm link        # deja el comando "qa-evidence-reporter" disponible en cualquier carpeta
```

Confirmá que quedó instalado:

```bash
qa-evidence-reporter --version
```

> Cuando el paquete se publique en el registro de npm, este paso se va a
> reducir a `npm install -g qa-evidence-reporter` — mientras tanto, `npm link`
> desde el repo clonado cumple exactamente la misma función.

## Flujo de uso

Tu proyecto de QA (los `.feature`, la evidencia, los reportes) **vive en una
carpeta separada del repo de esta herramienta** — el repo es el programa, no
el lugar donde guardás tus casos de prueba reales.

```bash
# 1. Creá (o entrá a) la carpeta de tu proyecto de QA, en cualquier lugar de tu máquina:
mkdir mi-proyecto-qa && cd mi-proyecto-qa

# 2. Inicializala:
qa-evidence-reporter init

# 3. Escribí tus .feature en features/ (ver la sección siguiente para la
#    estructura exacta) — init deja uno de ejemplo que podés editar o borrar.

# 4. Levantá el runner interactivo:
qa-evidence-reporter run

# 5. Cuando termines la sesión (o en cualquier momento, sobre el progreso
#    ya guardado), generá el reporte HTML final:
qa-evidence-reporter report
```

### 1. `init`

Crea, en el directorio actual:

- `features/` (con un `.feature` de ejemplo, comentado y editable/borrable)
- `evidence/` y `reports/` (vacíos)
- `qa-config.json` (ver formato completo más abajo)
- `run.sh` / `run.command` / `run.bat` / `run.desktop`: lanzadores de doble
  clic (Linux, macOS, Windows, y un `.desktop` adicional para Linux —
  ver nota abajo) que corren `qa-evidence-reporter run` sin necesitar abrir
  una terminal — útil si quien ejecuta la sesión de QA no está familiarizado
  con la línea de comandos.

  > **Linux**: usá `run.desktop`, no `run.sh`. Muchos gestores de archivos
  > (Nautilus/GNOME Files, el default en Ubuntu y otras distros) tratan los
  > `.sh` ejecutables como texto y los abren en un editor al doble clic en
  > vez de correrlos — es una preferencia del gestor de archivos, no algo
  > que el permiso de ejecución del archivo pueda forzar. `run.desktop`
  > sigue la convención real de "acceso directo ejecutable" de Linux
  > (especificación freedesktop.org) y sí es reconocido como aplicación por
  > Nautilus/KDE/XFCE/etc. Si el doble clic sobre `run.desktop` tampoco
  > funciona, probá clic derecho → "Permitir lanzamiento"/"Confiar y
  > ejecutar" (algunos gestores de archivos piden esa confirmación una sola
  > vez por archivo, la primera vez).

```bash
qa-evidence-reporter init --name "Mi Proyecto" # opcional, si no se toma el nombre de la carpeta
qa-evidence-reporter init --force              # sobreescribe qa-config.json si ya existe
```

### 2. Escribir tus `.feature`

**Importante: el parser solo entiende Gherkin.** Cualquier archivo `.feature`
que no use las palabras clave de Gherkin (`Feature`, `Scenario`, `Given`,
`When`, `Then`, etc. — lista completa abajo) no es un formato válido: no se
puede escribir en texto libre, Markdown, ni una lista de pasos cualquiera.
Si el archivo no respeta la sintaxis, `run`/`report` van a fallar con un
error claro (`FEATURE_PARSE_ERROR`) señalando el archivo y el motivo.

**Estructura mínima válida** — un archivo `.feature` necesita, como mínimo,
una línea `Feature:` con un nombre, y al menos un `Scenario:` con al menos un
step:

```gherkin
Feature: Nombre de la funcionalidad a probar

  Scenario: Nombre de un caso de prueba concreto
    Given una condición inicial
    Then un resultado esperado
```

**Ejemplo completo**, con todo lo que el parser soporta (guardalo como
`features/login.feature`):

```gherkin
# Los tags se muestran en el reporte y en el selector del runner
# (no filtran la ejecución todavía — ver "Usarlo para un test plan completo").
@smoke
Feature: Inicio de sesión
  Como usuario registrado
  quiero iniciar sesión con mis credenciales
  para acceder a mi cuenta.

  # Background: steps que se repiten al principio de cada Scenario de este Feature.
  Background:
    Given estoy en la página de inicio de sesión

  @regression
  Scenario: Inicio de sesión exitoso con credenciales válidas
    When ingreso un usuario y contraseña válidos
    And hago clic en "Ingresar"
    Then accedo correctamente a mi cuenta
    And veo mi nombre en la cabecera del sitio

  Scenario: Inicio de sesión fallido con contraseña incorrecta
    When ingreso un usuario válido con una contraseña incorrecta
    And hago clic en "Ingresar"
    Then veo un mensaje de error indicando credenciales inválidas

  # Scenario Outline + Examples: el mismo caso se ejecuta una vez por cada
  # fila de la tabla, sustituyendo los valores entre <> en cada step.
  Scenario Outline: Validación de campos obligatorios
    When dejo el campo "<campo>" vacío
    And hago clic en "Ingresar"
    Then veo un mensaje pidiendo completar "<campo>"

    Examples:
      | campo       |
      | usuario     |
      | contraseña  |
```

**Palabras clave de Gherkin que el parser reconoce:**

| Categoría   | Palabras clave                                                                     |
| ----------- | ---------------------------------------------------------------------------------- |
| Encabezados | `Feature`, `Background`, `Scenario`, `Scenario Outline`                            |
| Steps       | `Given`, `When`, `Then`, `And`, `But`                                              |
| Datos       | `Examples`, con una tabla de valores debajo (usada junto a `Scenario Outline`)     |
| Tags        | `@cualquier-palabra` (ej. `@smoke`, `@regression`) antes de `Feature` o `Scenario` |

**En español:** agregá `# language: es` como primera línea del archivo para
poder usar los equivalentes en español (`Característica`, `Antecedentes`,
`Escenario`, `Esquema del escenario`, `Dado`, `Cuando`, `Entonces`, `Y`,
`Pero`, `Ejemplos`) en vez de las palabras en inglés. Sin esa línea, el
archivo se interpreta en inglés por defecto (que siempre funciona, con o sin
la directiva). Podés mezclar archivos en español e inglés dentro del mismo
proyecto (cada `.feature` declara su propio idioma). Más ejemplos reales de
las tres variantes (simple, con `Background`, con `Scenario Outline`) en
[`sample-project/features/`](./sample-project/features/).

Subcarpetas dentro de `features/` están permitidas (se recorren
recursivamente) — útil para organizar por módulo o área del proyecto.

### 3. `run`

Levanta el server HTTP interactivo (`http://localhost:{puerto}`, configurable
en `qa-config.json`) y, si `server.openBrowser` es `true`, intenta abrir el
navegador automáticamente (si falla — p. ej. sin entorno gráfico — el
servidor sigue disponible igual por URL, solo se avisa por log). Si el
puerto configurado ya está en uso (por ejemplo, porque hay otro proyecto de
QA corriendo en paralelo en la misma máquina), prueba automáticamente los
siguientes puertos hasta encontrar uno libre — nunca hace falta editar
`qa-config.json` a mano solo para poder correr dos sesiones a la vez; el
navegador se abre igual, apuntando al puerto real que consiguió. Además del
comando de terminal, también se puede arrancar con doble clic en
`run.command`/`run.bat`/`run.desktop` (ver `init` más arriba — en Linux
usá `run.desktop`, no `run.sh`). Desde ahí:

1. Seleccionás qué features correr.
2. Recorrés cada step, adjuntando evidencia (file picker, drag&drop o
   `Ctrl+V` sobre el área de evidencia) y marcando el resultado.
3. El progreso se autoguarda en `.qa-evidence-reporter/session.json` en cada
   acción — se puede cerrar la terminal/navegador y retomar exactamente donde
   quedó volviendo a correr `run`.
4. Al terminar (o en cualquier corte), generás el reporte y lo exportás
   como `.zip` desde el panel de "Reporte". Cuando ya no necesitás seguir
   viendo esa sesión, el botón **"Cerrar sesión"** (al lado de "Exportar
   como ZIP") la da por terminada — para empezar una selección nueva sin
   que el sistema te pida confirmar que descartás progreso (ver "Qué NO
   hacer" más abajo). No borra evidencia ni reportes ya generados.

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
  pensarlo.** Si la sesión tiene progreso registrado (algún resultado
  marcado, evidencia adjunta, o notas) — esté "en curso" **o ya
  "completada"** — `run` te va a pedir confirmación explícita, porque
  **selecciona de nuevo = descarta todo lo no exportado a un reporte**.
  Una sesión "completada" NO es sinónimo de "ya está a salvo": es
  justamente el estado normal justo ANTES de generar el reporte, así que
  puede tener evidencia real que todavía no exportaste. Si no estás
  seguro, generá y exportá el reporte primero.
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
  "branding": {
    "logoPath": null,
    "primaryColor": null,
    "accentColor": null,
    "highlightColor": null,
    "ctaColor": null
  },
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
| `branding.logoPath`       | `string \| null`                         | Ruta al logo de tu empresa/cliente (relativa al proyecto), o `null` para no mostrar ninguno.         |
| `branding.primaryColor`   | `string \| null`                         | Color del header del reporte/runner (hex, ej. `"#1e3543"`). `null` = header neutro de siempre.       |
| `branding.accentColor`    | `string \| null`                         | Color de acento: links, botones, foco. `null` = acento neutro de siempre.                            |
| `branding.highlightColor` | `string \| null`                         | Color de detalle de marca (franja distintiva bajo el header).                                        |
| `branding.ctaColor`       | `string \| null`                         | Color de una acción destacada puntual (ej. "Exportar como ZIP").                                     |
| `reportTemplate`          | `string \| null`                         | Ruta a un template Handlebars custom, o `null` para usar el template embebido (`templates/default`). |

Los colores semánticos de resultado (verde=Pass, rojo=Fail, gris=Skip,
ámbar=Pending) **nunca** se ven afectados por `branding` — siguen siendo
fijos, para no perder la lectura instantánea del estado de cada step.

## Proyecto de ejemplo (opcional)

No hace falta para usar la herramienta en un proyecto real — es solo
material de referencia. `sample-project/` (dentro de este repo) contiene un
proyecto completo de ejemplo (3 `.feature` reales, mezclando español e
inglés, con tags, `Background` y `Scenario Outline`) y
`sample-project/simulate-session.mjs`, un script que ejercita el server real
de punta a punta (selección, evidencia real, resultados mixtos, reporte,
ZIP) sin necesitar un navegador. Útil como referencia de sintaxis Gherkin o
para explorar rápido cómo se ve un reporte ya generado.

## Cómo dar feedback

Cualquier hallazgo (bug, algo confuso, una mejora) — abrilo como
[Issue en el repo](https://github.com/quindcode/qa-evidence-reporter/issues)
para que quede registrado y se pueda priorizar. Si es sobre un reporte HTML
generado, adjuntá el `.zip` exportado (botón "Exportar como ZIP") para poder
reproducir exactamente lo que viste.

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
