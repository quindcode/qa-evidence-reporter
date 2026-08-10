# qa-evidence-reporter — Decisiones de arquitectura (fuente única de verdad)

Este documento fija TODAS las decisiones técnicas del proyecto para que distintos
agentes/sesiones de desarrollo construyan de forma consistente. Léelo por completo
antes de escribir código. Si necesitas desviarte de algo aquí, actualiza este
archivo primero y explica por qué en la sección "Cambios registrados" al final.

## Identidad del paquete

- Nombre npm: `qa-evidence-reporter`
- Bin CLI: `qa-evidence-reporter` (comandos: `init`, `run`, `report`)
- Lenguaje: TypeScript estricto (`strict: true` en tsconfig), target ES2022, module NodeNext.
- Package manager: npm. Node mínimo soportado: 18 LTS+.
- Monorepo: NO. Un solo paquete npm, pero con `ui/` como sub-build (Vite) cuyo `dist`
  se empaqueta dentro del paquete publicado y el server lo sirve como estáticos.

## Estructura de directorios (ya definida, no renombrar)

```
qa-evidence-reporter/
├── src/
│   ├── core/
│   │   ├── parser/
│   │   ├── session/
│   │   ├── evidence/
│   │   ├── report/
│   │   ├── config/          # carga/valida qa-config.json (vive en core: es lógica de negocio, no de transporte)
│   │   ├── logger/          # wrapper de pino, expone interfaz Logger propia (no acoplar a pino en el resto del core)
│   │   └── types/
│   ├── adapters/
│   │   ├── cli/
│   │   └── server/
│   └── ui/
├── templates/               # templates Handlebars del reporte
├── sample-project/
├── tests/                   # tests de integración end-to-end (unit tests viven junto a cada módulo: *.test.ts)
├── tsconfig.json
├── package.json
├── .eslintrc.cjs / eslint.config.js
└── .prettierrc
```

Regla de dependencia estricta (ESLint debe hacerla cumplir con
`eslint-plugin-boundaries` o reglas de `no-restricted-imports` si boundaries es
complejo de configurar — usar lo que sea más simple de mantener):
- `core/**` nunca importa de `adapters/**` ni de `ui/**`.
- `adapters/cli/**` y `adapters/server/**` importan de `core/**`, nunca entre sí
  directamente (server no importa cli ni viceversa).
- `ui/**` solo llama a `adapters/server` vía `fetch` HTTP. Nunca importa `core`.

## Stack tecnológico (decisiones firmes, no cambiar sin actualizar este doc)

| Área | Elección | Por qué |
|---|---|---|
| CLI framework | `commander` | Más simple que yargs para 3 comandos |
| Server | `express` | Estándar, simple, suficiente (no se necesita Fastify) |
| Comunicación UI↔server | REST puro (fetch), sin WebSocket | Un solo usuario por sesión local; WebSocket añade complejidad sin beneficio real aquí |
| UI framework | `preact` + `preact/hooks`, bundler `vite` (`@preact/preset-vite`) | Bundle más pequeño que React, JSX igual de ergonómico |
| Parser Gherkin | `@cucumber/gherkin` + `@cucumber/messages` | Oficial, robusto, soporta i18n (español vía `# language: es`, e inglés por defecto) |
| Templates de reporte | `handlebars` | Legible, soporta partials/helpers, fácil de tematizar |
| Charts del reporte | SVG generado server-side (funciones TS puras, sin librería) | Garantiza funcionamiento offline sin bundlear Chart.js |
| ZIP export | `archiver` | Streaming, maduro |
| Thumbnails de imagen | `jimp` (puro JS, sin binarios nativos) | Evita problemas de instalación cross-platform (requisito "cero config extra") |
| Thumbnails de video | NO se extrae frame real. Se usa un ícono genérico de video (SVG estático) | ffmpeg nativo es frágil de bundlear cross-platform; el spec permite explícitamente este fallback |
| Logging | `pino` envuelto en `core/logger` con interfaz propia `Logger` (`debug/info/warn/error`) | Nivel configurable desde `qa-config.json` |
| Tests | `vitest` | Rápido, buen soporte ESM/TS nativo |
| Lint/formato | `eslint` (flat config) + `prettier` | — |
| Validación de config | `zod` | Esquema tipado + validación runtime en un solo lugar |

## Contratos principales (`core/types/`)

Definir (mínimo, ampliar según se necesite, pero no romper estos nombres):

- `core/types/parser.ts`: `ParsedFeature`, `ParsedScenario`, `ParsedStep`,
  `GherkinParser` (interfaz: `parseFile(filePath): Promise<ParsedFeature>`,
  `parseDirectory(dirPath): Promise<ParsedFeature[]>`).
- `core/types/session.ts`: `SessionState` (con campo `version: number`),
  `FeatureExecution`, `ScenarioExecution`, `StepExecution`,
  `StepResult = 'pass' | 'fail' | 'skip' | 'pending'`, `SessionEngine`
  (interfaz: crear/cargar/guardar sesión, avanzar/retroceder step, setear
  resultado, adjuntar evidencia, notas, descripción de defecto).
- `core/types/evidence.ts`: `EvidenceFile`, `EvidenceKind = 'image' | 'video' | 'pdf' | 'other'`,
  `EvidenceStore` (interfaz: `save`, `getThumbnail`, `list`). Registro
  extensible de formatos soportados (mapa extensión→kind, no if/else).
- `core/types/report.ts`: `ReportData` (agregado completo desde `SessionState`
  + metadata de proyecto), `ReportGenerator` (interfaz: `generate(sessionState, outputDir, templateDir?): Promise<void>`),
  `TemplateEngine` (interfaz para permitir templates customizables).
- `core/types/config.ts`: `QaConfig` (esquema zod + tipo inferido), valores
  default documentados.
- `core/types/errors.ts`: clases de error custom (`FeatureParseError`,
  `EvidenceFileTooLargeError`, `SessionNotFoundError`, `UnsupportedEvidenceFormatError`,
  `ReportGenerationError`, `ConfigValidationError`), todas con `code: string` y
  extendiendo una base `QaError extends Error`.

## Formato de `qa-config.json` (valores default)

```json
{
  "$schema": "./node_modules/qa-evidence-reporter/config.schema.json",
  "projectName": "Mi Proyecto QA",
  "team": [],
  "featuresDir": "features",
  "evidenceDir": "evidence",
  "reportsDir": "reports",
  "server": { "port": 3000, "openBrowser": true },
  "evidence": { "maxFileSizeMB": 50, "allowedFormats": ["png", "jpg", "jpeg", "gif", "mp4", "webm", "pdf"] },
  "logging": { "level": "info" },
  "reportTemplate": null
}
```

## Formato de `session.json` (persistencia)

Debe incluir `version: 1` desde el inicio, para permitir migraciones futuras.
Se guarda en `.qa-evidence-reporter/session.json` dentro del proyecto del QA
(oculto, no en `reports/` ni `evidence/`). Debe permitir resumir tras cerrar el
navegador: guarda feature/scenario/step actual, resultados y evidencias ya
adjuntadas por step, notas, descripciones de defectos.

## Organización de evidencias en disco

`evidence/{featureSlug}/{scenarioSlug}/{stepIndex}-{stepSlug}/{originalFilename}`
Thumbnails junto al archivo original: mismo nombre + `.thumb.png` (jimp) o
ícono genérico compartido para video (un solo SVG en `templates/assets/`).

## API REST del server (adapters/server) — mínimo necesario

- `GET /api/features` — features + estado actual de la sesión (crea sesión si no existe)
- `POST /api/session/select` — elegir qué features correr, inicia ejecución
- `GET /api/session` — estado completo de la sesión actual
- `POST /api/session/step/:stepId/evidence` — subir archivo(s) (multipart, usar `multer`)
- `POST /api/session/step/:stepId/result` — marcar pass/fail/skip (+ notas / defecto)
- `POST /api/session/navigate` — moverse a step anterior/siguiente/arbitrario
- `POST /api/report/generate` — genera el reporte HTML en `reports/`
- `GET /api/report/export-zip` — devuelve el .zip del último reporte generado
- Estáticos: server sirve `evidence/` (para previews) y el build de `ui/`.

## Reporte HTML

- `reports/index.html` (dashboard) + `reports/features/{slug}.html` (detalle),
  auto-contenido: CSS/JS inline o copiados a `reports/assets/`, imágenes de
  evidencia copiadas a `reports/assets/evidence/...`. Debe abrir con
  `file://` sin servidor.
- Tema claro/oscuro vía `prefers-color-scheme` + toggle JS inline (sin dependencias).

## UX del runner (ui/)

- Atajos de teclado: P/F/S/N/B (deshabilitados si el foco está en un `<textarea>`/`<input>`).
- Paste de clipboard (`Ctrl+V`) sobre el área de evidencia → sube imagen.
- Drag & drop de archivos sobre la misma área.
- Tema claro/oscuro con toggle, persistido en `localStorage`.
- Responsive desde 1280px (no se exige mobile).

## Orden de construcción (fases) — no saltar pasos sin verificar el anterior

1. Scaffolding npm + tsconfig + eslint/prettier + `core/types` + `core/parser` + tests.
2. `core/session` + `core/evidence` + tests.
3. `core/report` (SVG charts + templates Handlebars) + tests.
4. `core/config` + `core/logger` + `adapters/cli` (init/run/report).
5. `adapters/server` (API REST) + `ui` (Preact runner completo).
6. `sample-project/` + test de integración end-to-end + export ZIP + pulido final (lint, README).

## Cambios registrados

### Fase 2 (`core/session` + `core/evidence`)

- **Nueva carpeta `src/core/shared/`** (no estaba en la estructura de
  directorios original de este documento): contiene `slugify.ts`, una
  utilidad pura usada tanto por `core/session` (para generar los ids
  legibles de feature/scenario/step) como por `core/evidence` (indirectamente,
  a través de esos mismos ids usados como nombres de carpeta). Se puso en un
  lugar neutral en vez de duplicarla o hacer que un módulo dependa del otro.
- **Esquema de ids de `FeatureExecution`/`ScenarioExecution`/`StepExecution`**:
  `"f{featureIndex}-{slug(name)}"`, `"{featureId}_s{scenarioIndex}-{slug(name)}"`,
  `"{scenarioId}_st{stepIndex}"` respectivamente. Cada nivel encadena el id
  de su padre, así que `StepExecution.id` termina siendo único en TODA la
  sesión (no solo dentro de su scenario) sin necesitar mantener un índice
  global aparte. Por esto, todas las operaciones de `SessionEngine` sobre un
  step puntual (`setStepResult`, `addEvidence`, `removeEvidence`, `addNotes`)
  reciben un `stepId: string` simple, no una terna compuesta.
- **`EvidenceStore.save`** usa `featureId`/`scenarioId`/`stepId` (la misma
  terna que devuelve `SessionEngine.getCurrentStep()`) directamente como los
  tres niveles de carpeta bajo `evidence/`. Como esos ids ya encadenan a su
  padre (ver punto anterior), el nombre de carpeta de scenario/step queda
  con el prefijo del padre incluido (p. ej.
  `evidence/f0-login/f0-login_s0-successful-login/f0-login_s0-successful-login_st0/`)
  en vez de solo `evidence/login/successful-login/0-.../`. Se aceptó esta
  redundancia cosmética a cambio de que `EvidenceStore` no necesite conocer
  ni confiar en el formato interno de los ids de `core/session` (acoplamiento
  mínimo entre ambos módulos) y de que cada nivel siga siendo, por
  construcción, único como nombre de carpeta.
- **`EvidenceFile.id`** es un hash corto y determinístico de
  `featureId:scenarioId:stepId:originalFilename` (no depende de timestamp ni
  de contenido del archivo). Esto permite que `EvidenceStore.list`/
  `getThumbnail` reconstruyan la metadata completa escaneando el filesystem
  (recalculando el mismo id a partir de la ruta de cada archivo encontrado),
  sin mantener un índice separado en disco o en memoria — útil para
  recuperación si `session.json` se corrompe. Efecto secundario documentado:
  subir dos veces el mismo `originalFilename` para el mismo step pisa el
  archivo anterior (mismo id, misma ruta).
- `ScenarioExecution`/`FeatureExecution` **no tienen un campo `result`
  persistido**: se calcula con las funciones puras `deriveScenarioResult`/
  `deriveFeatureResult` (exportadas desde `core/types/session.ts`) con la
  prioridad `fail > pending > skip > pass`, para evitar una fuente de verdad
  duplicada que se pueda desincronizar de `steps`.

### Fase 3 (`core/report`: charts SVG + templates Handlebars + `ReportGenerator`)

- **`TemplateEngine` ganó un tercer método, `getStaticAssetsDir(): string | null`**,
  además de `render`/`getAvailableTemplateNames` (los dos previstos en la
  sección de contratos de este documento). Es necesario porque
  `ReportGenerator.generate()` debe copiar assets estáticos del template
  (p. ej. `templates/default/assets/video-icon.svg`) a
  `outputDir/assets/`, y ese es el único paso del pipeline que necesita
  conocer una ruta de filesystem del lado del template en vez de solo
  strings renderizados. Una implementación custom de `TemplateEngine` que
  no tenga assets propios (todo en memoria) puede devolver `null` sin
  romper `generate()`.
- **`createReportGenerator` recibe un tercer parámetro `deps` opcional**
  (`ReportGeneratorDeps = { clock?, templateEngineFactory? }`), además de
  `(config, templateEngine)`. Mismo patrón que `SessionEngineDeps`
  (`clock`) y `EvidenceStoreDeps` (`imageProcessor`) de fase 2: dependencias
  opcionales con default de producción, para hacer testeable lo que sería
  no-determinístico (`generatedAt`) o lo que exigiría instanciar
  `handlebars` de verdad en un test (`templateEngineFactory`, usado
  únicamente cuando `generate()` recibe `options.templateDir` — ver
  siguiente punto).
- **`GenerateReportOptions.templateDir` no reconstruye un `TemplateEngine`
  llamando a `handlebars` directamente**: `reportGenerator.ts` nunca
  importa el paquete `handlebars` (solo la interfaz `TemplateEngine` y,
  como default de `templateEngineFactory`, la función
  `createHandlebarsTemplateEngine` de `templateEngine.ts` — el único
  archivo del módulo que sí toca `handlebars`). Así se respeta la regla de
  esta misma fase ("no instanciar Handlebars directamente dentro del
  generador") incluso en la rama donde `generate()` recibe un `templateDir`
  distinto al del `TemplateEngine` inyectado en la factory.
- **`FeatureReportView.slug` es literalmente `feature.id`**, no un slug
  recalculado a partir de `feature.name`. `FeatureExecution.id` (fase 2,
  `"f{featureIndex}-{slug(name)}"`) ya es un slug único y estable dentro de
  la sesión; volver a "sluggificar" el nombre por separado sería una
  segunda fuente de verdad para el mismo concepto y podría, en el caso de
  dos features con el mismo nombre, producir un slug igual para dos
  `detailPath` que deberían ser distintos.
- **Paleta de color única fuente de verdad**: los 4 colores de estado
  (`pass`/`fail`/`skip`/`pending`) se definen UNA vez, en hex, en
  `RESULT_COLORS` (`src/core/report/charts.ts`) — usados tanto por el SVG
  del donut como por el helper `resultLabel` de Handlebars (que también
  reexporta `RESULT_LABELS` del mismo archivo). El CSS de
  `templates/default/partials/styles.hbs` SÍ repite los mismos valores hex
  a mano (CSS no puede importar un módulo TypeScript) — está documentado
  con un comentario cruzado en ambos archivos para que no diverjan
  silenciosamente si se cambia uno.
- **Donut chart implementado con `stroke-dasharray`/`stroke-dashoffset`
  sobre `<circle>` apiladas** (técnica estándar de "donut de CSS/SVG"), no
  con `<path>` + arcos: evita la aritmética de arcos (`A rx,ry ...`) y sus
  casos límite (porciones de 100%, ángulos > 180°), y el agujero central es
  gratis (es solo el grosor del `stroke`, no hay que recortar nada).
- **Nueva devDependency `@xmldom/xmldom`**: usada solo en
  `charts.test.ts` para parsear el SVG generado y confirmar que es XML
  "well-formed" (lanza en `fatalError`, p. ej. tags sin cerrar) — no se
  agregó a dependencies porque `charts.ts` nunca la importa en tiempo de
  ejecución.
- **Nueva dependency `handlebars`** (prevista en la tabla de stack
  tecnológico de este documento, instalada recién en esta fase).
- **`.prettierignore` agrega `templates/**/*.hbs`**: no hay plugin de
  Prettier para Handlebars instalado, y el parser HTML por defecto de
  Prettier no reconoce `{{...}}` (falla con `SyntaxError` en cualquier
  expresión o partial). El linting/formato de `.ts` de `core/report` sí
  corre normalmente por `eslint`/`prettier`.

### Fase 4 (`core/config` + `core/logger` + `adapters/cli`)

- **Nuevas dependencies**: `zod` (prevista en la tabla de stack), `pino` +
  `pino-pretty` (prevista, "Logging"), `commander` (prevista, "CLI
  framework"), `open` (prevista, para abrir el navegador). **`open` queda
  instalada pero SIN USO todavía**: en esta fase no existe un servidor real
  que abrir (eso es fase 5, `adapters/server`, y es ahí donde
  `config.server.openBrowser` tiene efecto). Instalarla ahora en vez de en
  fase 5 es simplemente seguir el orden en que la consigna de esta fase la
  pidió; no se fuerza su uso prematuro en `init`/`run`/`report` para no
  abrir un navegador contra un reporte estático sin que el usuario lo haya
  pedido.
- **`QaConfigSchema` usa `.prefault({})`, no `.default({})`, en los tres
  objetos anidados (`server`/`evidence`/`logging`)**: se verificó a mano
  (antes de escribir `core/types/config.ts`) que en Zod v4 `.default(valor)`
  sustituye el input `undefined` por `valor` TAL CUAL, sin volver a
  pasarlo por el schema envuelto — `z.object({ port: z.number().default(3000) }).default({})`
  parseado sobre `undefined` da `{}`, no `{ port: 3000 }`. Esto rompía
  exactamente el caso "config parcial" pedido por la consigna (p. ej.
  `{ "server": { "port": 5000 } }` sin `openBrowser` debe completarse con el
  default `true` de `openBrowser`). `.prefault(valor)` sí vuelve a correr
  `valor` por el schema interno, aplicando sus propios defaults por campo, y
  es lo que finalmente se usó. Los campos hoja (strings/arrays/enums que no
  tienen a su vez sub-campos con defaults) siguen usando `.default()`
  normal, donde el comportamiento no importa.
- **`projectName` NO es obligatorio a nivel esquema**: tiene un default
  genérico (`DEFAULT_PROJECT_NAME = 'Mi Proyecto QA'`). Se decidió así (en
  vez de `z.string()` sin default, que haría fallar `QaConfigSchema.parse({})`)
  porque `loadConfig()` debe poder validar una config parcial escrita a mano
  sin `projectName` sin que eso sea, por sí solo, un error de validación —
  el nombre "genérico" resultante es una degradación aceptable (se muestra
  en el reporte), no una condición que deba bloquear `run`/`report`. En la
  práctica esto casi no se ejerce: `init` siempre escribe `projectName`
  explícito (del nombre de carpeta o `--name`).
- **`loadConfig` NUNCA asume defaults silenciosos si `qa-config.json` no
  existe**: se decidió que sea estricto (lanza `ConfigNotFoundError`, ver
  próximo punto) en vez de devolver `QaConfigSchema.parse({})`, con el mismo
  criterio que `SessionEngine.load()` (`SessionNotFoundError`, fase 1/2):
  un archivo de config faltante casi siempre significa "todavía no corriste
  `init`", y un fallback silencioso a defaults haría que `run`/`report`
  corran igual pero potencialmente apuntando a rutas equivocadas (p. ej. si
  el usuario ejecuta el comando desde el directorio equivocado) sin ninguna
  señal de que algo no se inicializó.
- **Nueva clase de error `ConfigNotFoundError extends QaError`**, ADEMÁS de
  `ConfigValidationError` (la única prevista explícitamente para esta fase
  en la sección "Contratos principales" de este documento). Se agregó
  porque el caso "el archivo no existe" y "el archivo existe pero su
  contenido es inválido" necesitan mensajes accionables distintos ("correé
  `init`" vs. "corregí este campo"), y el resto del código base ya sigue
  ese patrón (`SessionNotFoundError` es una clase separada de cualquier
  error de "sesión con datos inválidos"). No se considera una desviación de
  la lista de errores de este documento, sino una extensión consistente con
  su propio criterio de diseño.
- **`createConfigLoader(deps?)` sigue el mismo patrón de factory que
  `createGherkinParser`/`createSessionEngine`/`createEvidenceStore`/
  `createReportGenerator`** (en vez de una función suelta `loadConfig(path)`),
  por consistencia con el resto de `core/**` y para poder inyectar
  `readFile` en tests sin tocar el filesystem real (mismo patrón que
  `GherkinParserDeps.readFile`).
- **Interfaz `Logger` en `core/types/logger.ts`** (archivo nuevo, no
  mencionado explícitamente en la sección "Contratos principales" de este
  documento — se decidió agregarlo ahí, junto al resto de puertos de
  `core/**`, en vez de inline dentro de `core/logger/`, para que módulos
  hermanos como `core/parser` puedan importar el TIPO sin depender de la
  implementación concreta basada en `pino`). Expone únicamente
  `debug/info/warn/error(message, meta?)` — un subconjunto deliberado de los
  niveles de `pino` (sin `trace`/`fatal`), alineado 1:1 con
  `LOG_LEVELS`/`LogLevel` de `core/types/config.ts`.
- **`GherkinParserDeps.logger` (fase 1) se consolidó contra `Logger` real**:
  pasó de una forma ad-hoc local (`{ debug(message, meta?): void }`) a
  `Pick<Logger, 'debug'>`, importando el tipo real de
  `core/types/logger.ts`. Es un cambio compatible con cualquier caller
  existente (ningún test de `core/parser` pasaba `logger`) y con cualquier
  `Logger` real construido por `createLogger` (que sigue cumpliendo
  `Pick<Logger, 'debug'>` al ser un superset).
- **`createLogger(level, deps?)` acepta un `deps.destination` inyectable**:
  cuando se provee, `pino` escribe ahí SIN el transport `pino-pretty` (líneas
  JSON crudas, más fáciles de parsear en un test) — cuando no se provee
  (caso de producción real), usa `pino-pretty` para que la salida sea
  legible en una terminal interactiva. Los tests de `logger.test.ts`
  siempre inyectan `destination` (un `Writable` en memoria) para no
  depender de `process.stdout` real ni levantar el worker thread de
  `pino-pretty` (que esta interfaz `Logger` no expone ninguna forma de
  cerrar explícitamente).
- **Distinción `Logger` (diagnóstico) vs. `print`/`console.log` (salida de
  cara al usuario) en `adapters/cli`**: los 3 comandos aceptan tanto
  `deps.logger` (nivel configurable, pensado para diagnóstico/debug —
  "Config cargada", "Features cargadas", etc.) como `deps.print` (siempre
  visible, es la salida real que un QA lee en su terminal: próximos pasos
  de `init`, resumen de `run`, ruta del reporte de `report`). No están
  unificados en un solo canal porque tienen audiencias y ciclos de vida
  distintos: `print` es la interfaz de usuario del comando (se testea con
  asserts sobre el contenido, ver `commands/*.test.ts`) y `logger` es
  observabilidad interna cuyo nivel se configura en `qa-config.json` (un QA
  normal corriendo con `logging.level: "info"` no necesita ver "Config
  cargada" en `debug`, pero sí necesita ver "Reporte generado en ...").
- **Comandos de CLI como funciones puras en `adapters/cli/commands/*.ts`
  (`runInit`/`runRun`/`runReport`), `adapters/cli/index.ts` solo los conecta
  a `commander`**: permite testearlos llamándolos directamente (inyectando
  `cwd`, `logger`, `print`) sin pasar por parsing de `argv` ni por un
  subproceso real. Los tests de integración ligeros de esta fase (tests de
  `init`/`run`/`report`) quedaron colocados junto a cada comando como
  `*.test.ts` (`adapters/cli/commands/init.test.ts`, etc.), siguiendo la
  misma convención que el resto de `core/**` ("unit tests viven junto a
  cada módulo") en vez de en `tests/` — se los consideró "unitarios de un
  comando" más que "end-to-end de todo el sistema" (eso último, con
  `adapters/server` real, queda para fase 6).
- **Condiciones de error puramente de `adapters/cli` (nunca lanzadas por
  `core/**`) usan `QaError` instanciada directamente**, en vez de una
  subclase dedicada por caso: `CONFIG_ALREADY_EXISTS` (`init` sin
  `--force` sobre un proyecto ya inicializado), `FEATURES_DIR_NOT_FOUND`
  (`run` con `featuresDir` inexistente) y `NOTHING_TO_REPORT` (`report` sin
  sesión guardada — envuelve el `SessionNotFoundError` original en `cause`,
  con un mensaje más específico para este comando). `QaError` no es
  abstracta precisamente para permitir esto sin agregar tres clases de una
  sola línea a `core/types/errors.ts` para condiciones que solo existen a
  nivel de este adapter.
- **`init` deja un feature de ejemplo real (`features/example.feature`) en
  vez de un `.gitkeep`**, pero SÍ usa `.gitkeep` en `evidence/`/`reports/`:
  un QA nuevo abre `features/` primero, y un `.feature` real (comentado,
  editable/borrable) enseña el formato mejor que una carpeta vacía; no tiene
  sentido un "reporte" o una "evidencia" de ejemplo en las otras dos
  carpetas.
- **`adapters/cli/templatePaths.ts` resuelve `DEFAULT_TEMPLATE_DIR` con
  `fileURLToPath(import.meta.url)` + 3 niveles hacia arriba**, nunca con
  `process.cwd()`: el comando `report` corre con el cwd del proyecto del
  QA, sin relación con dónde está instalado `qa-evidence-reporter`. Como
  `tsconfig.json` mantiene `dist/` como espejo exacto de `src/` (mismo
  `rootDir`/`outDir` de fase 1), el archivo queda siempre exactamente 3
  niveles bajo la raíz del paquete tanto en `src/adapters/cli/templatePaths.ts`
  (tests corriendo sobre TS) como en `dist/adapters/cli/templatePaths.js`
  (binario real ya compilado) — la misma cuenta de `..` funciona en ambos
  casos.
- **Se agregó `"files": ["dist", "templates"]` a `package.json`**: no
  existía ningún campo `files` desde fase 1. Sin él, `npm publish` incluye
  todo lo no ignorado por `.gitignore` (que hoy también cubriría
  `templates/`), pero dejarlo implícito es fragil ante cambios futuros de
  `.gitignore`; con `report` dependiendo de que `templates/` viaje siempre
  junto al paquete publicado (ver punto anterior), se decidió declararlo
  explícitamente.
- **Corregida (post-fase 4, antes de iniciar fase 5) la limitación heredada
  de fase 2** descrita originalmente en este punto: `EvidenceStore`
  (`core/evidence/evidenceStore.ts`) anteponía SIEMPRE el segmento literal
  `"evidence"` a su `baseDir`, ignorando `config.evidenceDir`. Se cambió el
  contrato: `baseDir` ahora ES directamente la carpeta raíz de evidencias ya
  resuelta por el caller (`evidenceRoot = baseDir`, sin `join(baseDir,
  'evidence')` interno) — `core/evidence` sigue sin conocer
  `qa-config.json`, pero deja de asumir un nombre de carpeta fijo. En
  consecuencia, `EvidenceFile.path`/`.thumbnailPath` ya no llevan el prefijo
  `"evidence/"` (son relativos a `baseDir` tal cual), y `report`
  (`adapters/cli/commands/report.ts`) pasa
  `evidenceBaseDir: resolve(cwd, config.evidenceDir)` — antes pasaba `cwd` a
  secas. `config.evidenceDir` ahora tiene efecto real de punta a punta.
  Se corrigió en este punto (y no se dejó para fase 5) porque el server de
  fase 5 iba a heredar y agravar la misma inconsistencia al construir su
  propio `EvidenceStore` para los uploads reales.
- **`run` NO levanta ningún servidor HTTP real todavía** (no existe
  `adapters/server` hasta fase 5): carga config + parsea features +
  carga/detecta ausencia de sesión existente, e imprime un resumen — deja
  un mensaje explícito de que el servidor interactivo llega en la siguiente
  fase. Toda esa lógica de carga (la única responsabilidad real de esta
  fase) queda completamente testeada en `run.test.ts`, para que fase 5 solo
  tenga que conectar el servidor encima sin reescribir nada de esto.

### Fase 5a (`adapters/server`: API REST, sin `ui/` todavía)

- **`SessionEngine.removeEvidence` YA EXISTÍA desde fase 2** — no fue
  necesario agregarlo. La consigna original de esta fase asumía que podía
  ser "un hueco real de fase 2" a completar recién ahora, pero al revisar
  `core/types/session.ts` (interfaz `SessionEngine`) y
  `core/session/sessionEngine.ts` (implementación) antes de tocar nada, el
  método ya estaba completo y con test propio
  (`sessionEngine.test.ts`, `"addEvidence es idempotente y removeEvidence
  quita el id"`). Se deja esta aclaración explícita porque el encargo de
  fase 5a llegó con la instrucción de "implementarlo si no existe" — se
  verificó primero en el código real (no en la documentación) y no hizo
  falta ningún cambio en `core/session/**`. `DELETE
  /api/session/step/:stepId/evidence/:evidenceId` (ver más abajo) usa este
  método preexistente tal cual.
- **Endpoints finales implementados** (coincide con la lista original de
  ARCHITECTURE.md salvo el matiz explícito en `GET /api/features`, ver
  siguiente punto):
  - `GET /api/features`
  - `POST /api/session/select` (query opcional `?force=true`)
  - `GET /api/session`
  - `POST /api/session/step/:stepId/evidence` (multipart, campo `files`, uno o varios archivos)
  - `DELETE /api/session/step/:stepId/evidence/:evidenceId`
  - `POST /api/session/step/:stepId/result`
  - `POST /api/session/navigate`
  - `POST /api/report/generate`
  - `GET /api/report/export-zip`
  - Estáticos: `/evidence-files/*` → `evidenceBaseDir`, `/reports-static/*` → `reportsDir`, `/` (+ fallback SPA) → build de `ui/` o placeholder.
- **`GET /api/features` NO crea una sesión automáticamente**, a diferencia
  de la redacción original ("crea sesión si no existe" en la sección "API
  REST del server" de este documento). Es de solo lectura: devuelve las
  features encontradas en `featuresDir` más `{ exists: false }` si no hay
  sesión, o `{ exists: true, status, projectName }` si la hay. Crear la
  sesión es una acción explícita del QA (qué features correr), modelada
  como su propio endpoint (`POST /api/session/select`) — auto-crearla con
  TODAS las features en un `GET` no tiene sentido con ese flujo de
  selección explícita que pide la UI (ARCHITECTURE.md, "UX del runner").
- **Id de feature antes de seleccionarla (`GET /api/features` /
  `POST /api/session/select`)**: la ruta relativa del `.feature` respecto a
  `featuresDir` (siempre con `/`, ver `sessionQueries.ts`,
  `buildFeatureRefId`), NO el `FeatureExecution.id` de `core/session`
  (`"f{featureIndex}-{slug}"`). Ese id de sesión recién existe una vez
  creada la sesión (depende de la POSICIÓN dentro de las features YA
  seleccionadas) — antes de seleccionar, todas las features disponibles
  necesitan un identificador propio, estable mientras el archivo no se
  mueva/renombre.
- **`POST /api/session/select` sobre una sesión en curso**: si existe una
  sesión con `status !== 'completed'`, responde `409`
  (`SESSION_ALREADY_IN_PROGRESS`) salvo que se pase `?force=true`. Si la
  sesión existente ya está `'completed'`, se permite reseleccionar sin
  pedir confirmación (no hay progreso sin terminar que se pueda perder).
  Se eligió el query param de confirmación explícita (en vez de permitir
  pisar sin más, o de bloquear sin salida) porque re-enviar la pantalla de
  selección de la UI no debería destruir evidencia/resultados ya cargados
  por accidente, pero tampoco debe haber ningún estado del que no se pueda
  salir.
- **Contexto para `EvidenceStore.save` sobre un `stepId` arbitrario**:
  `SessionEngine` solo expone la terna `featureId`/`scenarioId` para el
  step de `currentPosition` (`getCurrentStep()`) — deliberado, ver su JSDoc
  en `core/types/session.ts`. Pero la UX de "volver a un step anterior para
  adjuntar/editar evidencia" implica que `POST
  /api/session/step/:stepId/evidence` puede apuntar a un step que no es el
  actual. En vez de ensanchar el contrato de `SessionEngine` para un caso
  de uso de transporte, `sessionQueries.ts` (`findStepContext`) recorre
  `SessionState` (estructura pública) con el mismo patrón que ya usa
  `core/report/reportGenerator.ts` para recorrer ese mismo árbol.
- **Multer con `memoryStorage()`, no `diskStorage()`, y SIN
  `limits.fileSize` configurado**: los archivos de evidencia de una sesión
  de QA manual local (un solo usuario, sin adversario remoto) son
  screenshots/videos cortos/PDFs, casi siempre bien por debajo del default
  de `evidence.maxFileSizeMB` (50MB). `memoryStorage` evita limpiar
  archivos temporales huérfanos cuando la validación de tamaño/formato
  rechaza el archivo después de que multer ya lo recibió, y evita una
  segunda copia de I/O (temporal → destino final). No fijar
  `limits.fileSize` es deliberado: se prefiere dejar que el buffer llegue
  completo y comparar su tamaño REAL contra
  `config.evidence.maxFileSizeMB` a mano (en la ruta), para poder lanzar
  `EvidenceFileTooLargeError` con el tamaño exacto del archivo rechazado,
  en vez de que multer aborte la conexión con su propio error genérico sin
  ese detalle. Todo el lote de archivos de una misma solicitud se valida
  (formato + tamaño) ANTES de guardar cualquiera, para no dejar guardados
  parciales de un lote rechazado a mitad de camino.
- **Nueva clase de error `UnsupportedEvidenceFormatError` en
  `core/types/errors.ts`** (prevista explícitamente en la sección
  "Contratos principales" de este documento, pendiente desde fase
  2/3/4 — ver el comentario que dejaba ese hueco marcado en
  `core/types/errors.ts`). Mismo criterio que `EvidenceFileTooLargeError`:
  vive en el dominio compartido porque es una condición de negocio
  ("formato no permitido") más allá de un solo adapter, aunque quien la
  lanza es únicamente `adapters/server` (el único módulo que cruza el
  archivo subido contra `qa-config.json` → `evidence.allowedFormats`).
- **Mapa código→status HTTP centralizado en `adapters/server/errors.ts`**
  (`ERROR_STATUS_BY_CODE`, con `statusForErrorCode` como único punto de
  lectura): `FEATURE_PARSE_ERROR`→400, `SESSION_NOT_FOUND`→404,
  `INVALID_STEP_TRANSITION`→400, `EVIDENCE_FILE_TOO_LARGE`→413,
  `UNSUPPORTED_EVIDENCE_FORMAT`→415, `REPORT_GENERATION_ERROR`→500,
  `CONFIG_VALIDATION_ERROR`→400, `CONFIG_NOT_FOUND`→404, más los códigos
  que solo existen en este adapter (mismo criterio de fase 4 para
  condiciones puramente de adapter — `QaError` instanciada directamente,
  sin subclase dedicada): `SESSION_ALREADY_IN_PROGRESS`→409,
  `NOTHING_TO_REPORT`→404 (mismo código/criterio que ya usaba `report.ts`
  de `adapters/cli`, reimplementado localmente porque `adapters/server` no
  puede importar de `adapters/cli`), `NO_REPORT_GENERATED`→404,
  `FEATURE_NOT_FOUND`→400, `INVALID_REQUEST_BODY`→400. Cualquier código de
  `QaError` no listado cae a 500 (fallback conservador). Cualquier error
  que NO sea `QaError` (bug real) siempre responde 500 genérico
  (`INTERNAL_SERVER_ERROR`, sin stack ni mensaje interno) pero se loguea
  completo vía `logger.error`.
- **`ServerContext` lleva rutas ya resueltas, no un `cwd` crudo** —mismo
  criterio que las dependencias de las factories de `core/**`
  (`SessionEngineDeps`, etc.): `{ config, logger, projectRoot,
  sessionFilePath, featuresDir, evidenceBaseDir, reportsDir, templateDir }`.
  `createApp(context)` construye sus propias instancias de
  `SessionEngine`/`EvidenceStore`/`GherkinParser` (una única vez, no por
  request — ver `services.ts`, `CoreServices`) a partir de esas rutas,
  igual que ya hacen los comandos de `adapters/cli`. Se agregó
  `buildServerContext(projectRoot, deps?)` (`context.ts`) para armar un
  `ServerContext` real replicando la misma resolución de rutas que
  `run.ts`/`report.ts`; no está conectada todavía a `qa-evidence-reporter
  run` (ver el punto de fase 4 "`run` NO levanta ningún servidor HTTP real
  todavía" — sigue pendiente para fase 5b o un ajuste posterior, no
  bloqueante para esta fase). Se usó para la prueba manual de esta fase
  (levantar `startServer` real contra un proyecto de ejemplo).
- **`adapters/cli/templatePaths.ts` se duplicó como
  `adapters/server/templatePaths.ts`** (mismo cálculo de 3 niveles hacia
  arriba desde `import.meta.url`, misma profundidad de archivo), y de la
  misma forma `adapters/cli/fsUtils.ts` → `adapters/server/fsUtils.ts`
  (`pathExists`) y el literal `".qa-evidence-reporter"` (nombre de la
  carpeta de sesión) se repite en `adapters/server/context.ts`: por la
  regla de dependencia estricta de este documento ("`adapters/cli/**` y
  `adapters/server/**` ... nunca entre sí directamente"), se prefirió
  duplicar estos fragmentos triviales antes que crear un import cruzado
  entre adapters o forzar ese conocimiento de rutas de filesystem del
  paquete instalado hacia `core/**` (que no debería tenerlo).
- **Ruta esperada del build de `ui/` (fase 5b): `<raíz del paquete>/dist/ui`**
  (`adapters/server/uiPaths.ts`, `UI_DIST_DIR`), NO `src/ui/dist`. Motivo:
  (1) co-ubicación con `dist/` ya declarado en `"files"` de `package.json`
  desde fase 4 — cualquier cosa bajo `dist/` se publica sin tocar ese
  campo; (2) resolución simétrica a `DEFAULT_TEMPLATE_DIR`
  (`templatePaths.ts`): mismo archivo, misma profundidad, misma cuenta de
  `..` hasta la raíz del paquete, tanto corriendo sobre `src/` (tests) como
  sobre `dist/` (binario compilado). Fase 5b debe configurar
  `build.outDir` de Vite (relativo a `src/ui/`) como `"../../dist/ui"`. Si
  `dist/ui/index.html` no existe (el caso normal durante toda esta fase),
  `GET /` y cualquier ruta no-`/api/*` devuelven un placeholder HTML fijo
  (`UI_NOT_BUILT_PLACEHOLDER_HTML`) en vez de un 404 o un crash de
  `express.static` contra un directorio inexistente.
- **`archiver@8` (la versión que instaló `npm install archiver` al momento
  de esta fase) reescribió su API pública a clases ESM con nombre**
  (`ZipArchive`/`TarArchive`/`JsonArchive`, todas extendiendo `Archiver`)
  en vez de la factory clásica `archiver(format, options)` de versiones
  anteriores — no hay `export default` ni `export =` en
  `@types/archiver@8`. `GET /api/report/export-zip` usa `new ZipArchive()`
  como equivalente exacto para `'zip'`. Se documenta acá porque cualquier
  ejemplo/tutorial de `archiver` visto antes de esta fecha probablemente
  muestra la API vieja.
- **`GET /api/report/export-zip` empaqueta el `reportsDir` COMPLETO tal
  cual está en disco en el momento de la llamada** (el último
  `generate()` ejecutado, sin importar cuándo) — no hay un estado
  "reporte pendiente de exportar" separado; simplemente se valida que
  `reportsDir/index.html` exista (si no, `404 NO_REPORT_GENERATED`) y se
  archiva el directorio entero con `archive.directory(reportsDir, false)`.
  Si el streaming del ZIP falla a mitad de camino (evento `'error'` de
  `archiver`), ya no es posible convertir eso a un JSON `{ error: {...} }`
  limpio (los headers/parte del body ya se enviaron) — se loguea completo
  y se corta la conexión con `res.destroy(error)`, en vez de reenviarlo al
  `errorHandler` central (pensado solo para errores ANTES de empezar a
  escribir la respuesta).
- **Nueva dependency `express`, `multer`, `archiver`** (previstas en la
  tabla de stack tecnológico de ARCHITECTURE.md: "Server" y "ZIP export";
  `multer` no estaba en esa tabla pero es la elección estándar de Express
  para `multipart/form-data`, mencionada explícitamente en la sección "API
  REST del server"). Nuevas devDependencies: `@types/express`,
  `@types/multer`, `@types/archiver`, `supertest` + `@types/supertest`
  (tests de integración de esta fase, `app.test.ts`).
- **`eslint.config.js`: `@typescript-eslint/no-unused-vars` ganó
  `{ argsIgnorePattern: '^_' }`** para el bloque `**/*.ts`. Necesario
  porque Express reconoce el middleware de manejo de errores por aridad
  (debe declarar exactamente 4 parámetros — `(err, req, res, next)` —
  aunque `req`/`next` no se usen en el cuerpo, ver
  `adapters/server/errors.ts`, `createErrorHandler`); sin este ajuste, el
  default (`args: 'after-used'`) marcaría como error el último parámetro
  no usado. No afecta código de fases anteriores (ningún parámetro previo
  usaba el prefijo `_`).
- **Tests de integración con `supertest` contra `createApp()` real, SIN
  levantar un puerto TCP** (`adapters/server/app.test.ts`, 12 casos):
  flujo completo select→evidencia→resultado→navigate→completar
  sesión→generar reporte→exportar ZIP (verificando la firma de archivo
  `"PK"` del ZIP recibido), más los casos de error explícitos de la
  consigna (`fail` sin `defectDescription`→400, archivo que excede
  `maxFileSizeMB`→413, formato no permitido→415, `DELETE` de evidencia,
  `409` al reseleccionar una sesión en curso sin `force`, `404` para
  `GET /api/session`/`POST /api/report/generate`/`GET
  /api/report/export-zip` sin sesión/reporte). Además, la prueba manual
  obligatoria de esta fase (`startServer` real en un puerto TCP real,
  contra un proyecto de ejemplo en un directorio temporal, golpeado con
  `curl` de punta a punta: `GET /`, `GET /api/features`, `GET
  /api/session`, selección de features, subida real de un archivo de
  evidencia con verificación en disco, marcado de resultados, navegación
  hasta completar la sesión, generación del reporte y descarga/validación
  del ZIP con `unzip -l`) se corrió y confirmó exitosa por fuera de la
  suite automatizada — no quedó como test de Vitest porque su propósito es
  específicamente validar el binario/proceso real escuchando un socket TCP
  real, algo que `supertest` deliberadamente evita.

### Fase 5b (`src/ui/`: runner Preact + Vite)

- **Scaffolding**: `src/ui/` con Vite (`@preact/preset-vite`) + `preact`.
  `src/ui/vite.config.ts` fija `root` explícitamente al propio directorio
  (`fileURLToPath(new URL('.', import.meta.url))`, no `process.cwd()`) y
  `build.outDir: '../../dist/ui'`, que resuelve EXACTAMENTE a
  `UI_DIST_DIR` (`adapters/server/uiPaths.ts`) — verificado leyendo ese
  archivo antes de escribir la config, tal como pedía la consigna de esta
  fase, en vez de asumir la ruta de memoria. `npm run build:ui` produjo
  `dist/ui/index.html` + `dist/ui/assets/*.{js,css}` en la primera corrida,
  sin ajustes. Scripts nuevos en `package.json`: `build:ui` (`vite build
  --config src/ui/vite.config.ts`), `dev:ui` (`vite --config
  src/ui/vite.config.ts`, con proxy de `/api`, `/evidence-files` y
  `/reports-static` hacia `http://localhost:{QA_DEV_SERVER_PORT ?? 3000}`
  — los mismos 3 prefijos no-`/` que monta `app.ts`, ver
  `staticPrefixes.ts`), y `build` raíz pasó de `tsc` a `tsc && npm run
  build:ui` (backend primero, UI después; no hay dependencia real entre
  ambos pasos, pero mantiene el orden "core primero" del resto del
  proyecto).
- **`tsconfig.json` raíz agrega `src/ui/**` a `exclude`** (además de
  `**/*.test.ts`, ya existente): sin esto, `tsc` (raíz, `module`/
  `moduleResolution: NodeNext`) intentaba compilar también los `.ts` sueltos
  de `src/ui/` (`api.ts`, `colors.ts`, `types.ts` — los `.tsx` ya quedaban
  afuera por extensión, pero los `.ts` planos SÍ matcheaban `src/**/*.ts`) y
  fallaba con `TS2835` ("Relative import paths need explicit file
  extensions..."): el código de `ui/` está escrito para el resolutor de
  módulos de Vite/esbuild (imports sin extensión, `import type { X } from
  './types'`), no para `NodeNext`. `ui/` nunca se compila con el `tsc` del
  backend — Vite/esbuild la transpila directamente a `dist/ui` sin pasar por
  `tsc` en ningún punto del pipeline de build real (`npm run build`).
  `src/ui/tsconfig.json` (nuevo, `jsx: "react-jsx"`, `jsxImportSource:
  "preact"`, `lib` con DOM, `moduleResolution: "Bundler"`) existe solo para
  que el editor/IDE tipe correctamente el código de `ui/` y para
  `npx tsc --noEmit -p src/ui` manual (corrido y verificado sin errores
  antes de cerrar esta fase) — no está conectado a ningún script de
  `package.json`, exactamente como especifica la consigna
  (`build:ui` es solo `vite build`).
- **Regla de dependencia estricta, mitad de `ui/**`, agregada a
  `eslint.config.js`**: hasta esta fase, `no-restricted-imports` contra
  `core/**`/`adapters/**` solo estaba escrita para `src/core/**` (porque
  `src/ui/` no existía como código real todavía). Se agregó un bloque
  gemelo para `src/ui/**/*.ts(x)` que bloquea imports de `**/core/**` y
  `**/adapters/**`, haciendo cumplir en lint la otra mitad de la regla de
  ARCHITECTURE.md ("`ui/**` solo llama a `adapters/server` vía `fetch`
  HTTP. Nunca importa `core`"). Verificado manualmente que dispara
  (`no-restricted-imports`) agregando un import de prueba de
  `core/types/session.js` a un archivo de `ui/` y confirmando el error antes
  de revertirlo.
- **Tipos de `src/ui/types.ts` DUPLICADOS de `core/types/session.ts` /
  `evidence.ts` / `parser.ts`, no importados**: consecuencia directa de la
  regla de dependencia estricta (ni siquiera un `import type` está
  permitido). Incluye también `deriveScenarioResult`/`deriveFeatureResult`
  (recalculadas sobre `SessionState` público, misma tabla de prioridad
  `fail > pending > skip > pass`) y una función nueva,
  `getCurrentStepFromSession(session)`, que reconstruye `CurrentStepInfo` a
  partir de `SessionState.currentPosition` — necesaria porque `POST
  .../evidence` y `DELETE .../evidence/:id` devuelven `{ session }` sin un
  `currentStep` ya resuelto (a diferencia de `select`/`result`/`navigate`),
  y subir/borrar evidencia nunca mueve `currentPosition`, así que
  recalcularlo en el cliente evita una request extra solo para volver a
  pedir el step actual. `src/ui/colors.ts` duplica igual `RESULT_COLORS`/
  `RESULT_LABELS` de `core/report/charts.ts` — mismo criterio ya usado en
  fase 3 para `templates/default/partials/styles.hbs` (comentario cruzado en
  ambos archivos para que no diverjan silenciosamente).
- **Endpoint nuevo, único cambio real a `adapters/server` de esta fase: `GET
  /api/session/step/:stepId/evidence`** (`routes/session.ts`), fuera de la
  lista de endpoints de ARCHITECTURE.md ("Fase 5a"). Se agregó como
  excepción explícita a "no modificar `adapters/server` salvo un bug
  bloqueante": `StepExecution` (`core/types/session.ts`) solo guarda
  `evidenceFileIds: string[]`, nunca la metadata completa
  (`kind`/`thumbnailPath`/`sizeBytes`/`originalFilename`) — antes de esta
  fase, la ÚNICA forma de que la UI conociera esa metadata era leer la
  respuesta de `POST .../evidence` en el momento mismo de subir el archivo.
  Eso bloqueaba por completo el requisito de UX "preview de evidencias ya
  adjuntadas" en cualquier otro momento (recargar la página, o el flujo
  explícitamente pedido en esta fase de "continuar una sesión existente" sin
  volver a subir nada). El único ingrediente de `core/**` que hacía falta,
  `EvidenceStore.list(stepId)`, ya existía completo desde fase 2 (reconstruye
  la metadata escaneando el filesystem) — la ruta nueva es una capa HTTP
  fina sobre algo ya implementado y testeado, sin tocar `core/**`. Se
  agregaron 2 casos a `app.test.ts` (200 con metadata completa incluyendo
  `thumbnailPath`, y 400 `INVALID_STEP_TRANSITION` para un `stepId`
  inexistente) — la suite pasó de 12 a 14 tests. Verificado además con
  `curl` contra un server real (ver más abajo).
- **`app.test.ts`, caso "`GET /` responde el placeholder..." reescrito para
  no asumir un único resultado fijo**: ese test (fase 5a) asumía que
  `dist/ui/index.html` nunca existe, lo cual dejó de ser universalmente
  cierto exactamente a partir de esta fase (`npm run build`/`build:ui` real
  ahora lo crea). `UI_DIST_DIR` es una ruta fija del paquete instalado, no
  inyectable vía `ServerContext` como el resto de rutas de este archivo de
  test (que sí usan `projectRoot` temporal aislado) — no hay forma de
  parametrizarla sin tocar `uiPaths.ts`/`app.ts`, algo que la consigna de
  esta fase no pedía y que hubiera sido un cambio de comportamiento real, no
  un bugfix. Se cambió el test para que verifique la respuesta CONSISTENTE
  con el estado real de `dist/ui` en el momento de correr (`<div id="app">`
  y ausencia del texto del placeholder si el build existe; el placeholder si
  no) — exactamente la lógica real de `uiBuildExists` en `app.ts`, en vez de
  fingir un estado de filesystem que ya no es el normal del repo tras esta
  fase.
- **Nuevas dependencies**: `preact` (prevista en la tabla de stack
  tecnológico). Nuevas devDependencies: `vite`, `@preact/preset-vite`,
  `jsdom`, `@testing-library/preact`, `@testing-library/jest-dom` (pedidas
  explícitamente por la consigna de testing de esta fase).
  `@testing-library/user-event` se instaló pero terminó sin uso real (los
  tests de esta fase cubrieron interacción con `fireEvent` — click, change,
  drop, paste — sin necesitar su simulación de más alto nivel) y se
  desinstaló antes de cerrar la fase, para no dejar una dependencia muerta.
- **Tests de componentes: `vitest` con `// @vitest-environment jsdom`
  por archivo** (no un `environment: 'jsdom'` global en un `vitest.config.ts`
  nuevo — este proyecto no tenía ninguno hasta ahora): así los tests de
  `core/**`/`adapters/**` (Node puro) no pagan el costo de levantar jsdom, y
  cada archivo de `src/ui/**/*.test.tsx` declara explícitamente que lo
  necesita. `src/ui/api.test.ts` es la única excepción real: corre en el
  entorno Node default (sin el pragma) porque solo ejercita `fetch`
  mockeado, y Node 18+/22 ya expone `fetch`/`File`/`FormData` nativos (no
  hace falta DOM para eso).
- **`@testing-library/preact` requiere registrar `afterEach(cleanup)` a
  mano en cada archivo de test que renderiza algo**: su auto-cleanup
  (`dist/esm/index.mjs`) solo se activa si detecta un `afterEach` GLOBAL
  (`typeof afterEach === 'function'` sin import), y este proyecto no
  habilita `test.globals` en Vitest (para no filtrar globals de test hacia
  el resto de la suite, que corre en Node puro). Sin este registro manual,
  el segundo test de un archivo que renderiza dos veces el mismo `role`
  (p. ej. dos botones con el mismo texto de dos renders no limpiados)
  fallaba con "Found multiple elements" — encontrado y corregido durante
  esta fase agregando `afterEach(cleanup)` explícito en los 5 archivos de
  test que usan `render`/`renderHook`.
- **Verificación de UI, en el orden de preferencia pedido por la consigna**:
  - (a) Navegador real: NO había ninguna herramienta `claude-in-chrome`
    conectada en este entorno (se verificó buscándola explícitamente antes
    de intentar usarla) — se pasó directamente a (b)/(c) sin fingir una
    verificación visual que no ocurrió.
  - (b) Tests de componentes (`vitest` + `@testing-library/preact` + jsdom):
    31 tests nuevos en 6 archivos (`FeatureSelect`, `StepResultPanel`,
    `EvidenceArea`, `ThemeToggle`+`useTheme`, `useKeyboardShortcuts`,
    `api`), cubriendo: render de la lista de features + selección + banner
    de "continuar sesión"; render de los 3 botones de resultado; el botón
    "Fail" deshabilitado mientras `defectDescription` esté vacío/solo
    espacios y habilitado con texto; los 5 atajos de teclado (`P`/`F`/`S`/
    `N`/`B`, case-insensitive) disparando su handler y siendo ignorados por
    completo con el foco en un `<input>`/`<textarea>`; adjuntar un archivo
    simulado (file input, drag&drop, paste fuera de un campo de texto, paste
    ignorado dentro de uno) disparando `onUpload`/la llamada `fetch`
    esperada (`fetch` global mockeado en `api.test.ts`, verificando método,
    URL y el `FormData` real incluyendo múltiples archivos bajo el campo
    `"files"`); toggle de tema con persistencia en `localStorage` y
    precedencia `prefers-color-scheme` solo cuando no hay elección explícita
    guardada.
  - (c) Integración real sin navegador: con `npm run build` (tsc + `vite
    build`) ya corrido, se levantó `startServer`/`buildServerContext` reales
    (compilados en `dist/`) contra un proyecto temporal con una feature real
    (`/tmp/.../curl-project`), y se ejercitó con `curl` el flujo COMPLETO:
    `GET /` devuelve el `index.html` real de la SPA (`<div id="app">`, sin
    el texto del placeholder) con sus `<script>`/`<link>` de assets con hash
    (`/assets/index-*.js`, `/assets/index-*.css`), ambos verificados con
    `200`/content-type correcto; una ruta de cliente arbitraria
    (`/some/client/route`) también devuelve `200` con el `index.html` (
    fallback de SPA); `/api/nope` sigue devolviendo `404` JSON (no HTML);
    selección de features → subida real de un archivo PNG real (no un mock)
    → `GET /api/session/step/:stepId/evidence` (el endpoint nuevo de esta
    fase) devolviendo la metadata completa con `thumbnailPath` real → el
    thumbnail servido como estático (`/evidence-files/...thumb.png`,
    `200`, `image/png`) → marcar pass/skip/fail (con `defectDescription`) →
    sesión completa → generar reporte → `GET /reports-static/index.html`
    (`200`) → exportar ZIP y verificar con `unzip -l` que contiene
    `index.html`, el HTML de detalle de la feature, y los archivos de
    evidencia + thumbnail reales.
- **`adapters/cli` sigue sin levantar `startServer`** (el punto ya dejado
  pendiente explícitamente en fase 5a, "Fase 5a o un ajuste posterior"):
  fuera del alcance de esta fase (`ui/` puramente frontend, sin tocar
  `adapters/cli`/`adapters/server` salvo el endpoint de evidencia ya
  documentado arriba). `qa-evidence-reporter run` sigue solo imprimiendo un
  resumen; conectar `run` a un server real con la UI ya construida queda
  para una fase de pulido posterior (fase 6, según el orden de construcción
  de este documento) o un ajuste dedicado.

### Fase 6 (`sample-project/` + test e2e + conectar `run` al server real + pulido final)

- **Excepción deliberada y documentada a la "Regla de dependencia estricta"**
  (sección inicial de este documento: "`adapters/cli/**` y
  `adapters/server/**` ... nunca entre sí directamente"):
  `adapters/cli/commands/run.ts` ahora importa `startServer`/`ServerContext`/
  `StartServerResult` de `adapters/server/index.ts`. Esta regla existía para
  evitar acoplar los dos adapters de transporte cuando no había ninguna razón
  real para que se conocieran entre sí (fase 5a duplicó a propósito
  fragmentos triviales — `templatePaths.ts`, `fsUtils.ts` — antes que violar
  la regla). Fase 6 es distinta: la ÚNICA razón de ser de
  `qa-evidence-reporter run` pasa a ser levantar ese server real (ver el
  siguiente punto) — sin importarlo, sería imposible cumplir el requisito
  original del proyecto ("`run` abre/levanta el server con la UI funcional
  real"). Se decidió importar `startServer` tal cual (no reimplementar su
  lógica de arranque/apertura de navegador en `adapters/cli`, que hubiera
  sido la alternativa para "no violar la regla") porque hubiera duplicado
  código no trivial (manejo de errores de `listen`, resolución del puerto
  real, la lógica de `open()` con su propio try/catch) que ya está escrito y
  testeado en fase 5a. No se tocó `eslint.config.js`: no existía ninguna
  regla `no-restricted-imports` entre `adapters/cli/**` y `adapters/server/**`
  (solo entre `core/**`/`ui/**` y el resto, ver fases 1 y 5b) — la regla de
  este documento era una convención sin verificación automática en lint para
  este par específico, y sigue así; si una fase futura quisiera revertir
  esta excepción, tendría que reintroducir la duplicación de fase 5a.
- **`runRun` conecta con el server real**: construye un `ServerContext` con
  las MISMAS rutas ya resueltas que el resto de esta función usaba para su
  resumen (`featuresDir`, `evidenceBaseDir = resolve(cwd, config.evidenceDir)`
  — la corrección de fase 4 —, `reportsDir`, `sessionFilePath`) más
  `templateDir` (una copia de la función `resolveTemplateDir` de
  `report.ts`, duplicada localmente en `run.ts` por el mismo motivo que
  `adapters/server/templatePaths.ts` documenta para su propia copia: es un
  cálculo trivial, y no vale la pena ensanchar más la superficie compartida
  entre adapters por esto), y llama a `startServer(context)`. **No se
  duplicó la lógica de "abrir el navegador si `config.server.openBrowser`"**:
  `startServer` (fase 5a) YA la implementa completa, con su propio
  try/catch que jamás hace fallar el arranque del server si `open()` falla
  (p. ej. sin entorno gráfico) — solo loguea un `warn`. Se verificó esto
  LEYENDO `adapters/server/index.ts` antes de escribir código (tal como pedía
  la consigna de esta fase) en vez de asumir que había que reimplementarlo en
  `run.ts`; duplicar esa lógica en dos lugares hubiera sido la fuente de bugs
  más probable de esta fase (p. ej. abrir el navegador dos veces).
- **Ciclo de vida del proceso (`SIGINT`/`SIGTERM` → cierre limpio)**: `runRun`
  no fuerza `process.exit()` en ningún punto. En vez de eso, `await` una
  promesa (`waitForShutdownSignal`, inyectable — ver siguiente punto) que se
  resuelve cuando llega `SIGINT` o `SIGTERM`, y solo entonces llama a
  `close()` (el `close` que devuelve `startServer`) antes de que `runRun`
  retorne. Como el servidor HTTP escuchando un socket TCP ya mantiene vivo el
  event loop de Node por sí solo, no hace falta ningún mecanismo adicional
  para "mantener el proceso vivo" — simplemente no se retorna de `runRun`
  hasta que el usuario interrumpe. Una vez que `close()` resuelve y no queda
  ningún handle abierto, el proceso termina solo (comportamiento normal de
  Node), sin necesitar `--no-verify` ni matar el proceso a la fuerza — se
  verificó esto manualmente contra el binario compilado real (ver la
  validación de esta fase, punto "empaquetado/instalación aislada").
- **`RunCommandDeps` gana `startServer` y `waitForShutdownSignal` inyectables**
  (mismo patrón `deps` que ya usan `init`/`report` desde fase 4): el default
  de producción de `startServer` es el real de `adapters/server`; el default
  de `waitForShutdownSignal` registra listeners reales de `process` para
  `SIGINT`/`SIGTERM` (con `process.once`, limpiando el listener que no
  disparó apenas se resuelve, para no dejar un listener huérfano). Los tests
  de `run.test.ts` inyectan ambos con fakes que nunca abren un socket TCP
  real ni esperan una señal real de proceso — excepto un test dedicado
  ("usa startServer real de adapters/server por defecto") que deliberadamente
  NO inyecta `startServer`, para probar que el default de producción funciona
  de punta a punta (abriendo un socket TCP real en un puerto fijo poco común,
  con `openBrowser: false`), inyectando solo `waitForShutdownSignal` para que
  el test no quede colgado esperando una señal real. La consigna original
  también sugería un dep inyectable para `open`: no se agregó por separado,
  porque `run.ts` nunca llama a `open()` directamente (esa responsabilidad ya
  es 100% de `startServer`, ver el punto anterior) — inyectar un `open` en
  `RunCommandDeps` que nunca se usa hubiera sido una dependencia decorativa
  sin ningún efecto real que testear desde este módulo.
- **`sample-project/`**: 3 `.feature` reales (`login.feature` en español con
  `# language: es`, `busqueda.feature` en inglés, `carrito-compras.feature`
  en español con `Antecedentes`/`Background` y un `Esquema del
  escenario`/`Scenario Outline` con 2 filas de `Ejemplos`/`Examples`),
  sumando 12 scenarios concretos (3 + 5 + 4, contando cada fila de Outline
  expandida como su propio scenario) y 52 steps en total. `qa-config.json`
  con un nombre de proyecto y equipo de ejemplo realistas.
- **`sample-project/simulate-session.mjs`**: script standalone (`node
  sample-project/simulate-session.mjs`, sin flags) que usa la API HTTP REAL
  del server (`startServer`/`buildServerContext`, importados desde
  `dist/adapters/server/index.js` — requiere `npm run build` corrido antes)
  para simular una sesión de punta a punta: selecciona las 3 features,
  adjunta evidencia real (PNG generado con `jimp`, sin binarios nativos, el
  mismo patrón que ya usa `app.test.ts`) en el primer step y en el primer
  step marcado `fail`/`skip` de cada corrida, marca una mezcla determinística
  de pass/fail(con `defectDescription`)/skip (regla fija: cada 7mo step
  `skip`, cada 5to `fail`, el resto `pass`), navega hasta completar la
  sesión, genera el reporte y exporta el ZIP. **Decisión de diseño (dónde
  queda todo lo generado)**: el script NUNCA escribe dentro de
  `sample-project/` — cada corrida crea un directorio de trabajo nuevo y
  aislado bajo `os.tmpdir()` (`qa-evidence-reporter-sample-<random>/`), con
  su propio `qa-config.json` cuyo `featuresDir` es la ruta ABSOLUTA a
  `sample-project/features` (evita depender de qué `projectRoot` se le pase a
  `buildServerContext` para encontrar las features reales, que son de solo
  lectura) mientras que `evidenceDir`/`reportsDir`/`.qa-evidence-reporter/`
  quedan relativos a ese directorio de trabajo. Así, correr el script muchas
  veces nunca ensucia el repo ni dos corridas pueden pisarse. El script
  imprime la ruta completa del directorio de trabajo, del reporte HTML y del
  ZIP al final. Verificado corriendo el script real tras `npm run build`:
  52 steps ejecutados (36 pass / 9 fail / 7 skip), reporte HTML con el
  defecto simulado embebido, ZIP de 20 archivos válido (`unzip -l`).
- **`tests/e2e.test.ts`**: usa `createGherkinParser` real sobre
  `sample-project/features/` (sin mocks) para confirmar que las 3 features
  parsean con el contenido esperado (idiomas, tags, cantidad de scenarios
  expandidos desde los `Scenario Outline`), y `createApp` real (misma factory
  que usa `startServer`/`run.ts`) vía `supertest` — mismo patrón que
  `adapters/server/app.test.ts` (fase 5a) pero sobre las features reales del
  sample project — para ejercitar selección → evidencia real → resultados
  mixtos (pass/fail con defecto/skip) → navegación (incluyendo hacia atrás
  sobre una sesión ya completada) → generación del reporte → export ZIP.
  Verifica el HTML generado en disco (nombres reales de features, badges de
  estado incluyendo `qa-badge--fail`/"Fallido", el texto del defecto
  simulado, ausencia de cualquier `src=`/`href=` externo para reconfirmar
  que el reporte funciona offline) y el ZIP exportado descomprimiéndolo de
  verdad con el binario `unzip` del sistema (`unzip -l`/`unzip -p`, mismas
  flags que la verificación manual de fase 5a) — no se agregó ninguna
  devDependency nueva de lectura de ZIP porque `unzip` ya es la herramienta
  que este proyecto usa para esa verificación. Un tercer test ("permite
  pausar y retomar una sesión...") crea DOS instancias independientes de
  `createApp` sobre el mismo `ServerContext` (el mismo `sessionFilePath`):
  la segunda instancia nunca cargó nada en memoria, así que si el estado
  (posición actual, resultado ya asignado, evidencia ya subida) sobrevive al
  consultarla, es una prueba real de autosave + `SessionEngine.load()` — no
  un mock — de "cerrar y retomar" (ver el ítem del checklist original).
  Suite completa: 141 tests (138 previos + 3 nuevos de este archivo; los
  9 de `run.test.ts` reemplazan/extienden los 4 anteriores de esa fase, ver
  el punto de arriba).
- **`README.md` nuevo en la raíz** (no existía ninguno hasta esta fase):
  instalación, flujo `init`→`.feature`→`run`→`report`, tabla de atajos de
  teclado, tabla de campos de `qa-config.json`, y una sección de arquitectura
  deliberadamente breve que remite a este documento para el detalle completo
  (no se duplicó contenido).
- **Verificación de empaquetado/instalación real, en un prefix npm AISLADO**
  (nunca la instalación global real del sistema): `npm pack` en la raíz +
  `npm install -g --prefix <scratchpad>/fake-global <tarball>` +
  ejercitar el binario resultante (`PATH` con ese prefix anexado solo para
  los comandos de verificación) en una carpeta de trabajo temporal separada:
  `init` → copiar `sample-project/features/login.feature` → editar
  `qa-config.json` generado para `openBrowser: false` → `run` en background →
  `curl` confirma que sirve la SPA real de `dist/ui` (no el placeholder,
  `<div id="app">` con assets con hash) y que `GET /api/features` devuelve la
  feature copiada → `SIGINT` al proceso (no `kill -9`) → el proceso termina
  solo (confirmando el cierre limpio del punto anterior) → `report` genera
  el HTML. Usa EXCLUSIVAMENTE lo que viaja en el tarball (`dist/`,
  `templates/`, `package.json` — el campo `files` ya declarado desde fase 4),
  nunca archivos sueltos de `src/` del repo fuente. Ver el reporte de cierre
  de esta fase para los comandos y la salida real completa.

### Post-fase 6 — bugfix: eliminar evidencia no borraba el archivo físico

Reportado por un usuario real probando la UI en vivo: al adjuntar una
evidencia por error y borrarla con el botón "×", la evidencia volvía a
aparecer. Causa raíz confirmada leyendo el código (no era un malentendido de
UI): `SessionEngine.removeEvidence` (fase 2) solo quitaba el id de
`step.evidenceFileIds` en `session.json`, pero `EvidenceStore` (también fase
2) NUNCA tuvo un método para borrar el archivo físico — la fase 5a incluso
documentó esto explícitamente como comportamiento aceptado en un test
(`"DELETE evidencia la quita de la lista del step SIN borrar el archivo
físico"`). Esto quedó oculto hasta la fase 5b, cuando la UI empezó a llamar
a `GET /api/session/step/:id/evidence` para refrescar previews — ese
endpoint usa `EvidenceStore.list()`, que reconstruye la lista ESCANEANDO EL
FILESYSTEM (fuente de verdad independiente de `session.json`, ver su JSDoc
original) — así que el archivo, todavía físicamente presente, volvía a
aparecer en cada refresh sin importar qué dijera `session.json`.

Corrección:
- `EvidenceStore` (interfaz en `core/types/evidence.ts` + implementación en
  `core/evidence/evidenceStore.ts`) gana un método nuevo:
  `remove(stepId, evidenceFileId): Promise<void>`, que localiza el archivo
  reutilizando el mismo escaneo que `list`/`getThumbnail` y borra el
  original y su thumbnail (`unlink`, ignorando `ENOENT` — no-op/idempotente
  si ya no existe, mismo criterio de "best effort" que ya usa
  `tryGenerateThumbnail`).
- `DELETE /api/session/step/:stepId/evidence/:evidenceId`
  (`adapters/server/routes/session.ts`) ahora llama a
  `evidenceStore.remove(...)` ANTES de `sessionEngine.removeEvidence(...)`
  — en ese orden deliberado: si el borrado físico fallara, se prefiere dejar
  una referencia "huérfana" pero recuperable en `session.json` antes que una
  sesión que ya no referencia un archivo que sigue ocupando disco.
- Se corrigió el test de fase 5a que documentaba el bug como comportamiento
  esperado, y se agregaron tests dedicados de `EvidenceStore.remove` (borrado
  real, no reaparece en `list()`, no-op sobre id inexistente, idempotencia)
  y un test de integración HTTP que reproduce el flujo completo (subir →
  borrar → refrescar lista → confirmar vacía → borrar de nuevo sin error).
- Verificado además manualmente contra el binario compilado real
  (`dist/`), reproduciendo el flujo exacto reportado (subir evidencia,
  borrarla, listar de nuevo) vía `curl` sobre un server real.
