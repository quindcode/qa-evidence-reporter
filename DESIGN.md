---
name: qa-evidence-reporter
description: Runner de sesiones QA y reporte HTML de evidencia entregable al cliente
colors:
  ink: "#1a1a1a"
  ink-muted: "#5f5f5f"
  paper: "#ffffff"
  paper-elevated: "#f6f6f7"
  hairline: "#dcdcdc"
  link: "#1d4ed8"
  pass: "#15803d"
  pass-tint: "#e0fcea"
  pass-on-tint-dark: "#4ade80"
  fail: "#b91c1c"
  fail-tint: "#fbd0cc"
  fail-on-tint-dark: "#f87171"
  skip: "#475569"
  skip-tint: "#e0e6ed"
  skip-on-tint-dark: "#94a3b8"
  pending: "#b45309"
  pending-tint: "#fdf4e7"
  pending-on-tint-dark: "#fbbf24"
  runner-canvas: "#f8fafc"
  runner-canvas-elevated: "#ffffff"
  runner-ink: "#0f172a"
  runner-ink-muted: "#475569"
  runner-hairline: "#e2e8f0"
  runner-focus: "#2563eb"
  quind-primary: "#1e3543"
  quind-accent: "#00c4e9"
  quind-highlight: "#ffb91c"
  quind-cta: "#ff5530"
typography:
  display:
    fontFamily: "'Baloo 2', Arial, 'Liberation Sans', Helvetica, sans-serif"
    fontSize: "clamp(3.25rem, 2.4rem + 4.2vw, 5.5rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Baloo 2', Arial, 'Liberation Sans', Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'Baloo 2', Arial, 'Liberation Sans', Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  pill: "999px"
spacing:
  sm: "12px"
  md: "20px"
  lg: "24px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.runner-focus}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  button-primary-hover:
    backgroundColor: "{colors.runner-focus}"
    textColor: "#ffffff"
  button-cta:
    backgroundColor: "{colors.quind-cta}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.9rem"
  card:
    backgroundColor: "{colors.paper-elevated}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  badge-pass:
    backgroundColor: "{colors.pass-tint}"
    textColor: "{colors.pass}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
  badge-fail:
    backgroundColor: "{colors.fail-tint}"
    textColor: "{colors.fail}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
  stat-pass:
    backgroundColor: "{colors.pass-tint}"
    textColor: "{colors.pass}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: qa-evidence-reporter

## Overview

**Creative North Star: "El Informe Distinguido"**

Dos superficies, un mismo producto, dos códigos de diseño con distinta densidad y paleta, pero una sola tipografía. El **runner** (Preact, corre en `localhost` mientras el QA trabaja) es una herramienta: paneles compactos, `min-width: 1280px` porque nadie lo usa en un teléfono, y cero ceremonia — su trabajo es no estorbar mientras alguien recorre steps durante horas. El **reporte HTML** (Handlebars, estático, el único artefacto que el cliente llega a ver) es el producto real: se comporta como un dictamen con más aire y jerarquía — número protagonista en el peso más marcado de Baloo 2 (la familia redondeada que comparten ambas superficies, ver Typography), un riel de color de resultado en el borde izquierdo de cada fila que se lee como un semáforo de inspección de arriba a abajo sin necesidad de leer una palabra, y aire generoso alrededor de cada tarjeta. La seriedad viene de los datos (el % de aprobación, no de un logo); el valor percibido viene de que ese dato está tratado con el mismo cuidado tipográfico que un certificado.

Ninguna de las dos superficies compite con el branding de marca cuando existe: el runner y el reporte reservan una sola franja de 3 colores vivos (`--brand-highlight`/acento/CTA) como firma reconocible, y todo lo demás — jerarquía, rieles de resultado, tipografía — se mantiene neutro para no diluirse contra la paleta de cualquier cliente que se configure.

**Key Characteristics:**
- Dos paletas de color paralelas (runner = herramienta neutra; reporte = documento con más aire), unidas por una sola familia tipográfica (Baloo 2, ver Typography) y por una única paleta semántica de resultado (`pass`/`fail`/`skip`/`pending`) que nunca cambia entre ambas.
- El riel de color izquierdo (`.qa-rail`) es la firma visual del reporte: estado legible por barrido vertical, sin leer texto.
- Cero fuentes de red: el reporte y el runner empaquetan su propia fuente (Baloo 2, WOFF2 subseteado a latín/dígitos, ~32KB) como asset local — igual que `echarts.custom.min.js` en el reporte —, nunca un `<link>` a Google Fonts ni ningún otro CDN. El reporte sigue abriendo con `file://` sin red; si por algún motivo el WOFF2 no carga, cae a `Arial, Liberation Sans, Helvetica, sans-serif`.
- Tema claro/oscuro real (no solo `prefers-color-scheme`): ambas superficies tienen un toggle que persiste en `localStorage` y gana con `[data-theme]` sobre la preferencia del sistema.
- El branding de cliente (logo + 4 colores) es una capa aditiva sobre el sistema base, nunca un reemplazo de él: apagado, el reporte y el runner se ven exactamente iguales a como se ven hoy sin ninguna configuración.
- La distribución de resultados se lee como chips de stat tono-sobre-tono (conteo real en Display font), no como una leyenda de gráfico de punto+texto; el donut que los acompaña ya no repite el % del hero en su centro cuando hay datos reales — solo lo muestra en el estado vacío ("Sin datos").
- Todo ícono del reporte (chevrons, toggle de tema, alerta de defecto, numeración de step) es un SVG de trazo único propio — cero emoji, cero entidades Unicode paradas como ícono.

## Colors

Paleta reducida y muy intencional: neutros de documento, un acento de enlace, cuatro colores semánticos de estado que **nunca** cambian con el branding, y una paleta de marca Quind opcional que se aplica encima.

### Primary
- **Enlace Documento** (`#1d4ed8` claro / `#7aa6ff` oscuro — `--qa-link`): el único acento de color libre en el reporte sin branding. Se usa exclusivamente en links de texto; cuando hay branding de cliente, este token se sobreescribe por `accentColor` con `!important` (ver Named Rule más abajo).
- **Foco del Runner** (`#2563eb` claro / `#60a5fa` oscuro — `--accent`): equivalente del runner al enlace del reporte — bordes de hover en botones, borde activo de dropzone, resaltado del step actual en el árbol lateral.

### Neutral
- **Tinta** (`#1a1a1a` reporte / `#0f172a` runner): texto principal. Dos valores de negro-azulado ligeramente distintos porque cada superficie tiene su propio sistema — no son el mismo token, no deben unificarse a la fuerza.
- **Tinta Atenuada** (`#5f5f5f` reporte / `#475569` runner): metadatos, captions, labels secundarias.
- **Papel** (`#ffffff` reporte / `#f8fafc` runner): fondo base.
- **Papel Elevado** (`#f6f6f7` reporte / `#ffffff` runner): tarjetas y superficies por encima del fondo — en el reporte el elevado es *más oscuro* que el fondo (papel sobre mesa); en el runner es *más claro* (panel flotante sobre canvas gris). Es una inversión deliberada de rol entre ambas superficies, no un error.
- **Línea Fina** (`#dcdcdc` reporte / `#e2e8f0` runner — `--qa-border`/`--border`): todos los bordes de tarjeta, separadores y contornos de input.

### Named Rules
**La Regla del Riel.** Cualquier fila o tarjeta que representa un resultado propio (feature en el dashboard, scenario en el detalle) lleva un `border-left` de 5px en el color semántico de ese resultado (`.qa-rail--pass/fail/skip/pending`). Es el único lugar del sistema donde el color de estado se usa como borde de contenedor completo en vez de como acento puntual — a propósito, para que se lea sin texto.
**La Regla del Contraste en Oscuro.** Los cuatro colores de estado (`pass`/`fail`/`skip`/`pending`) tienen un hex fijo que nunca cambia de tema, porque debe calzar exacto con `RESULT_COLORS` del SVG del donut (ver `charts.ts`) — pero ese mismo hex fijo, usado como texto o borde sobre una superficie oscura (chip de stat, badge, riel, callout de defecto), cae tan bajo como 1.98:1 de contraste en tema oscuro. Por eso cada uno tiene una variante "-on-tint" (`--qa-pass-on-tint`, etc.): igual a la base en tema claro, aclarada en tema oscuro (`pass-on-tint-dark` `#4ade80`, `fail-on-tint-dark` `#f87171`, `skip-on-tint-dark` `#94a3b8` — slate-400, para calzar con el nuevo `#475569` de Omitido —, `pending-on-tint-dark` `#fbbf24` — los mismos tonos que ya usa el runner para `--success`/`--danger`/`--warning` en oscuro, reutilizados a propósito en vez de inventar una segunda escala). Todo texto/borde de estado usa la variante on-tint; el hex fijo original solo se usa para el SVG del chart.
**La Regla del Cuarto Color.** La barra de progreso general reutiliza `pass` (verde) en vez de definir un quinto color para "completado": completar una sesión es conceptualmente lo mismo que aprobar, y el sistema se niega a introducir un color sin una etiqueta de texto que lo acompañe (ver JSDoc de `renderDonutChart`).
**La Regla del Acento Prestado.** Cuando hay branding de cliente configurado, `--qa-link`/`--brand-cta` se sobreescriben con los colores de marca — con `!important` en el reporte estático, con una simple variable CSS en el runner (el inline style de `App.tsx` ya gana por especificidad ahí). El acento de marca reemplaza al acento neutro; nunca convive con él.

### Estado (fijo, nunca afectado por branding)
- **Aprobado** (`#15803d` / fondo `#e0fcea` en tema claro, `#10281b` en oscuro): el único verde del sistema.
- **Fallido** (`#b91c1c` / fondo `#fbd0cc` claro, `#2c1414` oscuro): también el color del recuadro de defecto (`.qa-defect`).
- **Omitido** (`#475569` / fondo `#e0e6ed` claro, `#262b33` oscuro): slate frío — antes era un gris cálido (`#57534e`, "gris Word") que leía más a documento de oficina que a producto; el mismo slate que ya usaba `--text-muted` del runner, reutilizado a propósito en vez de inventar un tono nuevo. Deliberadamente el menos llamativo de los cuatro — sigue siendo el "neutro", no se le sumó vividez de tinte como a los otros tres (ver debajo).
- **Pendiente** (`#b45309` / fondo `#fdf4e7` claro, `#2b2110` oscuro): ámbar, el estado "todavía sin resolver".

El texto/borde de cada estado (el hex de arriba, o su variante on-tint en oscuro) se mantiene sin cambios respecto a la versión anterior: son tonos 700/800 elegidos para mantener contraste WCAG AA ≥ 4.5:1 como texto sobre fondo claro o sobre su propio fondo tintado — subir su vividez (ir a un 500/600 más brillante) rompe ese piso de contraste (verificado: `#16a34a` en vez de `#15803d` cae a 3.30:1, por ejemplo). Lo que SÍ se hizo más vívido, a pedido explícito de "que se vea más moderno/impactante", es el **fondo tintado** de pass/fail/pending — antes casi blanco (`#ecfdf3`/`#fef2f2`/`#fffbeb`), ahora un tinte con cuerpo real, calculado para que el texto de encima siga pasando AA con margen (≥4.6:1) tanto sobre blanco como sobre el tinte mismo. Omitido no sigue este mismo camino a propósito: seguir siendo el gris "sin urgencia" es parte de su trabajo (ver Regla del Cuarto Color, misma lógica de "un color con trabajo, no decoración"). Ningún componente depende solo del color para distinguir un resultado — siempre va acompañado de una etiqueta de texto (badge, chip de stat).

### Marca Quind (opcional, aditivo)
- **Azul Profundo Quind** (`#1e3543` — `primaryColor`): fondo del header/brandbar cuando hay branding. Serio, técnico, de confianza — nunca compite con los colores de estado porque solo aparece en el header, jamás en el cuerpo del reporte.
- **Cian Quind** (`#00c4e9` — `accentColor`): precisión técnica. Reemplaza el color de enlace/foco cuando hay branding; también el primer color de la franja de marca.
- **Ámbar Quind** (`#ffb91c` — `highlightColor`): punto de energía puntual, color medio de la franja de marca de 3 colores.
- **Naranja-Rojo Quind** (`#ff5530` — `ctaColor`): energía de acción — reservado para una única acción destacada por pantalla ("Exportar como ZIP"), nunca para navegación general ni para indicar un resultado (ver Regla del Cuarto Color).

## Typography

**Display Font:** `'Baloo 2', Arial, Liberation Sans, Helvetica, sans-serif` (reporte y runner)
**Body Font:** `'Baloo 2', Arial, Liberation Sans, Helvetica, sans-serif` (reporte y runner)

**Character:** Baloo 2 (OFL) es una sans-serif redondeada, empaquetada como asset local (WOFF2 subseteado a latín/dígitos, ~32KB — ver Named Rules más abajo y la nota de diseño en `partials/styles.hbs`), la misma familia en ambas superficies. La jerarquía ya no viene de una familia distinta (serif vs. sans) sino de PESO dentro de la misma familia: el número que protagoniza su bloque (el % del hero, el % de cada fila de feature) usa el peso 600 de Baloo 2 vía `--qa-font-display`; todo lo demás usa `--qa-font-body` en pesos más bajos. Reemplaza la combinación anterior (serif de documento + sans neutro) a pedido explícito de feedback visual — el reporte y el runner comparten ahora una sola identidad tipográfica más cálida.

### Hierarchy
- **Display** (800, `clamp(3.25rem, 2.4rem + 4.2vw, 5.5rem)`, line-height 1): el % de aprobación del hero del dashboard — el número más grande de todo el sistema, escalado con el viewport en vez de un tamaño fijo. Subido de 600 a 800 a pedido explícito de "más impactante" — Baloo 2 en su extremo alto de peso, no el semi-bold discreto de antes. El símbolo `%` que lo acompaña escala en paralelo (`clamp(1.75rem, 1.4rem + 1.8vw, 2.5rem)`), peso 500 y 70% de opacidad, para que el número entero (no el símbolo) sea lo primero que se lee — la brecha de peso entre el número (800) y el símbolo (500) se ensanchó en la misma pasada, reforzando el mismo contraste.
- **Título** (700, `clamp(1.5rem, 1.1rem + 1.8vw, 2.05rem)`, letter-spacing `-0.015em`): `<h1>` del header de cada página del reporte (clase compartida `.qa-page-title`, ver Navigation/Header) y `.app-header__title` del runner. Sin eyebrow arriba (ver Do's and Don'ts): el título lleva el peso completo de la jerarquía de encabezado, no lo comparte con una etiqueta.
- **Título de Fila** (800, `1.55rem`, en Display font): el % de cada feature en la lista del dashboard, y el conteo real de cada stat chip (`.qa-stat__count`) — mismo rol que el hero pero a escala de fila, por eso hereda el mismo peso 800.
- **Cuerpo** (400, `0.9–1rem`, line-height 1.5): texto corrido, descripciones de step, notas.
- **Label** (700, `0.72–0.85rem`, uppercase, letter-spacing `0.03–0.09em`): los headers de `.panel h3`/`.qa-section-heading`, los badges y chips de estado, los keywords Gherkin (`GIVEN`/`WHEN`/`THEN`) en el detalle de feature. Siempre mayúscula + tracking abierto — es como el sistema marca "esto es una etiqueta de sistema, no prosa".

### Named Rules
**La Regla del Protagonista.** El peso 800 de Display solo se usa para un número que es el sujeto de su propio bloque (el hero, el % de fila, el conteo de un stat chip). Nunca para texto, nunca para un número secundario dentro de una oración — su escasez es lo que le da peso de "informe formal" en vez de decoración. (Antes de la fuente redondeada, este rol lo cumplía una familia serif distinta a peso 600; el mecanismo cambió dos veces — primero de familia a peso, después de un peso discreto a uno extremo — pero el principio de escasez/protagonismo es el mismo.) El gauge del hero (ver `dashboard-charts-script.hbs`) replica este mismo peso 800 en su número central — el chart y el CSS nunca deben divergir en esto, son el mismo número mostrado dos veces.

**La Regla de la Fuente Empaquetada.** Baloo 2 viaja como asset local (WOFF2 subseteado, `assets/Baloo2-subset.woff2`) en el reporte y en el runner — nunca como `<link>` a Google Fonts ni ningún otro CDN. El reporte sigue abriendo con `file://` sin red: la fuente está en el mismo directorio que el HTML, igual que `echarts.custom.min.js`. Cualquier fuente nueva que se agregue al sistema debe seguir este mismo patrón (empaquetada + subseteada), nunca un link externo.

## Layout

Dos grillas completamente distintas, cada una calibrada para su tarea:

**Runner (Operate):** grilla fija de dos columnas `320px 1fr` (`.runner`) — árbol de steps sticky a la izquierda (`max-height: calc(100vh - 2rem)`, scroll propio), contenido principal a la derecha. `.app-main` limita a `max-width: 1400px` centrado. `body { min-width: 1280px }` — deliberadamente no responsive; es una herramienta de escritorio de uso prolongado, no una superficie que alguien abre desde el celular.

**Reporte (Read/premium deliverable):** columna única centrada, `max-width: 1100px` (`.qa-container`), responsive de forma natural por ser de una sola columna con `flex-wrap` en el hero y en cada fila de feature. El dashboard es una tarjeta (`.qa-card`) con el hero arriba (número + donut SVG + chips de distribución + barra de progreso, en `flex-wrap`) y la lista de features debajo. El detalle de feature apila `.qa-scenario` → `.qa-step` con numeración CSS real (`counter-increment`, ahora como chip circular, ver Shapes) porque "falló en el step 3" es información que el cliente necesita poder citar.

Cada `.qa-feature-row` agrupa count+badge+%+chevron en un solo bloque (`.qa-feature-row__meta`) que pasa a su propia línea completa por debajo de `560px` de ancho — antes de esto, esos elementos flotaban sueltos y se superponían con el nombre del feature cuando envolvía a dos líneas en mobile; agruparlos resuelve eso con un salto de línea real. Los chips de distribución (`.qa-stats`) bajan de 2 a 1 columna en el mismo breakpoint.

Ritmo de espaciado observado (sin variables CSS dedicadas, pero consistente): `12px` densidad interna de componentes chicos (badges, tags, chips de stat), `20px` padding estándar de fila/sección, `24–28px` separación entre bloques mayores, `32px` margen entre tarjetas principales del reporte — el reporte respira más que el runner a propósito, y respira un poco más ahora que antes (el ritmo subió un escalón completo en esta pasada).

## Elevation & Depth

Ya no es un sistema 100% plano en reposo — se revisó a pedido explícito de "que se vea más moderno/impactante" (el `box-shadow` cero era, junto con los bordes duros y la paleta apagada, uno de los motivos concretos por los que el conjunto leía a flat-design pre-2020). Ahora hay dos niveles de sombra, cada uno con un trabajo distinto:

1. **Ambiental, en reposo** (`--qa-card-shadow`, ver Named Rules): una sombra muy sutil en TODO `.qa-card`, "papel apenas levantado de la mesa" — offset chico + blur grande + opacidad baja, nunca un halo plano a offset 0. Solo existe en tema **claro**: en oscuro, `--qa-bg-elevated` ya es visiblemente más claro que `--qa-bg` (la tarjeta "flota" por contraste de tono, no por sombra), y una sombra negra sobre un fondo casi negro no se leería como profundidad — sería, además, físicamente incoherente (una superficie más clara que su fondo no proyecta una sombra oscura sobre él).
2. **De interacción, en hover** (`.qa-feature-row:hover`, ver Regla de la Elevación en Hover): mucho más marcada que la ambiental, porque confirma una interacción real (esa fila navega al detalle) — no es decoración, es afordancia. Desaparece con `prefers-reduced-motion` (queda el cambio de fondo, sin el desplazamiento); la ambiental NO se apaga con `prefers-reduced-motion` porque no es movimiento, es una propiedad estática de la tarjeta.

El runner sí define un `--shadow` sutil propio (`0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.08)`) pero lo usa en un solo lugar (`.feature-card`) — no es un vocabulario de elevación real, es un acento puntual para diferenciar tarjetas seleccionables de tarjetas de solo lectura; no se tocó en esta pasada.

También se admitió, por primera vez, UN gradiente en toda la superficie (ver Named Rules) — antes "cero gradientes" era regla absoluta; ahora es "cero gradientes salvo el glow del hero", con la misma lógica de escasez que ya regía la tipografía Display.

### Named Rules
**La Regla de lo Plano por Defecto.** El reporte transmite profundidad primero con tono de superficie (`paper` vs `paper-elevated`) y borde de 1px; la sombra es un refuerzo, nunca el único recurso. En reposo, la única sombra permitida es la ambiental de `--qa-card-shadow` (sutil, solo en claro) — nada más marcado que eso a menos que sea una interacción real (ver la Regla de la Elevación en Hover). El objetivo sigue siendo que el reporte se lea como documento, no como panel de software: una sombra ambiental sutil no rompe eso (el papel real también proyecta una sombra tenue), una sombra dura y marcada en reposo sí lo haría.

**La Regla de la Elevación en Hover.** `.qa-feature-row:hover` es la única superficie del reporte con una sombra marcada — `0 6px 16px -4px` en el color on-tint del propio resultado de esa fila (`.qa-rail--pass`/`fail`/`skip`/`pending`), nunca un gris genérico: la elevación queda teñida del mismo semáforo que ya lee el riel de 5px. Requisitos para que un elemento nuevo pueda sumarse a esta regla: (1) debe navegar o disparar una acción real al clickearlo — nunca decorativo; (2) la sombra debe tener offset+blur real, nunca un halo plano a offset 0; (3) debe desaparecer (junto con cualquier `transform`) bajo `prefers-reduced-motion: reduce`, conservando el cambio de color/fondo.

**La Regla del Glow Único.** `.qa-card--hero::before` es el único gradiente de todo el sistema — un glow radial muy sutil (`color-mix` con `--qa-link`, 16% de opacidad) anclado arriba-izquierda del hero, contenido dentro del propio card (`overflow: hidden`, nunca se sale del radio de 20px). Nunca en los demás `.qa-card` — la misma lógica de escasez de la Regla del Protagonista: si todas las tarjetas brillaran, ninguna se leería como la protagonista. Con branding de cliente configurado, el glow toma automáticamente `accentColor` sin código adicional — `--qa-link` se reasigna como variable CSS (`!important` sobre la propiedad custom, no sobre `color`, ver Regla del Acento Prestado), así que cualquier `var(--qa-link)` en la hoja, este `color-mix` incluido, ya lee el valor de marca.

## Motion

Agregado a pedido explícito de feedback visual ("me hacen falta ciertos efectos visuales interactivos... que las gráficas sean más llamativas") — hasta esta pasada el reporte no tenía vocabulario de movimiento propio más allá de la transición de acordeones. El principio: motion que confirma una interacción o autoriza UN momento (nunca decoración repetida en cada sección, ver reference/animate.md del skill de diseño).

**El momento autoral: el gauge del hero.** Es el único elemento con una animación de entrada deliberadamente larga (`animationDuration: 1400`, `cubicOut`) — el arco "se dibuja" en vez de aparecer, coherente con que es el número protagonista de todo el reporte (ver Regla del Protagonista). Ningún otro elemento compite por esa atención: el resto de las animaciones de entrada son más cortas o directamente utilitarias.

**Feedback de interacción (hover), no decoración:**
- `.qa-feature-row` (navega al detalle): `translateY(-2px)` + sombra teñida del color de resultado (ver Regla de la Elevación en Hover) + el chevron final se desliza `translateX(3px)` — tres señales de "esto te lleva a otro lado", ninguna nueva por sí sola si se mira aislada.
- Doughnut/barra apilada/sunburst (los 3 charts de ECharts con interacción real — hover en el doughnut, click+navegación en las barras, click-to-zoom en el sunburst): `emphasis.itemStyle` agrega una sombra real (`shadowBlur`/`shadowOffsetY`/`shadowColor`, nunca un halo plano) al segmento/nodo bajo el mouse, sumada al crecimiento (`scaleSize`) que el doughnut ya tenía. Las barras además hacen `cursor: 'pointer'` explícito (son clickeables) y entran con una cascada de ~90ms por fila en vez de todas a la vez.
- El gauge, el doughnut, la barra y el sunburst comparten la misma lógica de sombra (offset+blur real, nunca colored halo a offset 0) para que la "elevación" se lea como un mismo lenguaje en las 4 superficies del dashboard, no 4 tratamientos distintos.

**Reducción de movimiento.** `prefers-reduced-motion: reduce` apaga el `transform` (translateY/translateX) de `.qa-feature-row` y la duración de entrada de los 4 charts de ECharts (`option.animation = false`, ver `dashboard-charts-script.hbs`) — nunca el feedback de hover en sí (`box-shadow`/color/`scaleSize`), que sigue confirmando la interacción sin desplazamiento espacial. Ningún efecto de esta sección es un loop: todos son de una sola vez (entrada) o atados al mouse (hover), nunca continuos.

## Shapes

Dos escalas de radio conviviendo, sin fricción real porque casi nunca aparecen en el mismo elemento — y desde esta pasada, genuinamente DISTINTAS (antes solo diferían en unidad, px vs rem, con el mismo valor numérico de fondo; ahora el reporte subió un escalón completo en cada tier, a pedido explícito de "más moderno/impactante" — Baloo 2 volvió la tipografía redondeada y las formas se quedaron atrás, la brecha se cierra acá):

**Reporte** (subió un escalón):
- **6px** (`xs`): esquinas de miniaturas de evidencia (con `aspect-ratio: 4/3` fijo para que la grilla quede pareja sin importar el tamaño real de cada captura).
- **10px** (`sm`): chips de stat, badges, callout de defecto, fila de feature.
- **16px** (`md`): `.qa-scenario`.
- **20px** (`lg`): `.qa-card` — el radio "de documento", ahora notablemente más suave/redondeado, a la par de la fuente.
- **999px** (`pill`): sin cambios — ya era el máximo.

**Runner** (sin cambios, no se tocó en esta pasada):
- **8px** (`0.5rem`): toggles de tema, botones e inputs.
- **12px** (`0.75rem`): tarjetas y paneles.

- **999px** (`pill`): todo lo que es una etiqueta o estado en ambas superficies — badges, tags, barra de progreso, toggle de tema del runner, y el chip numerado de cada step (ver `.qa-step-header::before`). Ningún elemento de contenido (tarjeta, botón de acción) usa pill; está reservado exclusivamente al vocabulario de "etiqueta".

Bordes de 1px sólido en el color de línea fina en casi todo; el único borde grueso es el riel de 5px de color de resultado (ver Regla del Riel), que es información, no decoración. El borde ya no es el único recurso de separación del reporte — ver Elevation & Depth para la sombra ambiental que se le suma en reposo.

## Components

### Buttons (runner)
- **Shape:** radio `8px`, borde 1px sólido.
- **Primary:** fondo `--accent` (`#2563eb`/`#60a5fa`), texto blanco/`--accent-contrast`.
- **CTA puntual** (ej. "Exportar como ZIP"): fondo `--brand-cta` — igual a `--accent` sin branding, o el `ctaColor` de marca cuando existe. `hover` sube brillo (`filter: brightness(1.06)`), nunca cambia de color.
- **Semánticos de resultado** (`--pass`/`--fail`/`--skip`, ej. marcar Pass/Fail/Skip): outline, no filled — borde y texto en el color de estado, fondo transparente. Reservan el "filled" para acciones, no para marcar resultado.
- **Danger outline** (ej. "Cerrar sesión"): borde + texto en `--danger`, fondo transparente; tinte de 10% de danger solo en hover. Deliberadamente menos asertivo que un botón filled rojo — es una acción intencional pero no destructiva por sí sola.
- **Link:** sin borde ni fondo, color `--accent`, para acciones secundarias de bajo compromiso visual.

### Badges / Chips (reporte)
- **Shape:** pill (`999px`), borde 1px, `4px 11px` de padding, texto uppercase 0.74rem/700/tracking 0.04em.
- **4 variantes de estado**, cada una tono-sobre-tono: texto y borde en la variante on-tint del color de estado (ver Regla del Contraste en Oscuro), fondo en su tinte pálido correspondiente (nunca fondo sólido + texto blanco — el badge se lee como "etiqueta suave", no como alerta agresiva).
- **Tags** (`.qa-tag`, `.tag` en runner): variante neutra sin color de estado — borde fino, texto muted, mismo pill shape, para hashtags de Gherkin (`#smoke`, `#regression`).

### Stat Chips (reporte, dashboard y hero de feature)
- **Shape:** radio `10px` (`sm`), borde 1px en la variante on-tint del color al 28% de opacidad (`color-mix`), fondo en el tinte pálido del estado — misma familia tono-sobre-tono que los badges, pero como mini tarjeta en vez de pill.
- **Anatomía:** conteo real en Display font (1.3rem/800) + label + porcentaje, en vez de un punto de color seguido de texto plano — reemplaza la leyenda de gráfico clásica (punto+texto) por algo que se lee como dato, no como referencia.
- **Grilla:** 2 columnas, baja a 1 columna por debajo de 480px de ancho.

### Cards / Containers
- **Reporte** (`.qa-card`): radio 20px, fondo `paper-elevated`, borde 1px `hairline`, padding 28px, `margin-bottom: 32px`, sombra ambiental sutil en reposo (`--qa-card-shadow`, ver Elevation — solo en tema claro). El hero (`.qa-card--hero`) suma además el glow radial único del sistema (ver Regla del Glow Único).
- **Runner** (`.panel`, `.feature-card`, `.current-step`, `.progress-header`): radio 12px, mismo patrón fondo-elevado + borde, padding entre 12–20px según densidad del contenido. Sin cambios en esta pasada.
- **Riel de resultado:** cualquier card que representa un resultado agrega `.qa-rail--{result}` — ver Named Rule.

### Icons (reporte)
- **Trazo único, `currentColor`, sin librería:** cada ícono (chevron de disclosure, volver, toggle de tema, alerta de defecto) es un `<svg>` propio de ~15–16px, `stroke-width="2"`, `stroke-linecap="round"` — nunca un emoji ni una entidad Unicode (`→`, `&larr;`, `🌓`) parada como ícono, que fue como estaban antes de esta pasada. Vive como partial de Handlebars propio (`chevron-right.hbs`, `chevron-left.hbs`, `theme-icon.hbs`, `icon-alert.hbs`) para reusarse entre `index.hbs`/`feature-detail.hbs` sin duplicar el markup.
- **Numeración de step** (`.qa-step-header::before`): un chip circular pill (ver Shapes) con el número real del `counter-increment`, no un dígito suelto — mismo vocabulario visual que badges/tags.

### Inputs / Fields (runner)
- **Style:** borde 1px `hairline`, fondo `--bg` (no elevado — el input se hunde un nivel respecto de la tarjeta que lo contiene), radio 8px, `font: inherit`.
- **Required:** asterisco en color `--danger`.
- No hay tratamiento de foco custom definido más allá del navegador — punto a revisar si se toca accesibilidad de formularios.

### Evidence Grid (ambas superficies)
- **Runner:** grilla `auto-fill, minmax(160px, 1fr)`, thumbnail `110px` alto `object-fit: cover`, botón de eliminar circular superpuesto (`rgba(0,0,0,.6)` fondo, esquina superior derecha).
- **Reporte:** ítems de ancho fijo `160px` en `flex-wrap`, mismo radio 8px que el runner pero sin botón de eliminar (el reporte es de solo lectura) — imagen con link a tamaño completo (`target="_blank"`), video con controles nativos y poster propio, cualquier otro formato cae a un link "Abrir archivo". Imagen/video fuerzan `aspect-ratio: 4/3` + `object-fit: cover` — antes cada thumbnail tomaba la proporción real de su captura y la grilla quedaba dispareja.

### Navigation / Header
- **Runner:** `.app-header` fijo, logo 32px de alto + título + toggle de tema; variante `--branded` cambia solo fondo/color de texto al color de marca — nunca la tipografía ni el layout.
- **Reporte:** mismo patrón (`header.hbs`), logo 40px cuando hay branding, franja de marca de 5px debajo del header (`.qa-brand-stripe`) — el único lugar donde los 3 colores vivos de marca aparecen juntos y en orden fijo (acento → highlight → CTA). El `<h1>` usa la clase compartida `.qa-page-title` en ambas variantes (con y sin marca) en vez de un selector compuesto que nombre la clase de marca — así el HTML sin branding configurado no lleva ni el string de esa clase, no solo la deja sin usar.

### Signature Component: El Riel de Resultado
`.qa-rail` es el componente más distintivo del sistema: un `border-left` de 5px que convierte cualquier fila/tarjeta con resultado propio en parte de una columna de color escaneable de un vistazo, como la columna de banderines de una inspección real. Usa la variante on-tint del color (ver Regla del Contraste en Oscuro) — el hex fijo por sí solo cae hasta 2.10:1 contra el fondo neutro de la tarjeta en tema oscuro, ilegible para el componente que más depende de leerse sin texto. Se declara al final de la hoja de estilos a propósito — `.qa-card`/`.qa-scenario` fijan `border` en forma corta (4 lados), así que si `.qa-rail` se declarara antes, el orden en cascada lo pisaría silenciosamente pese a igual especificidad.

## Do's and Don'ts

### Do:
- **Do** reservar el peso 800 de Display (Baloo 2) exclusivamente para el número protagonista de su bloque (hero, % de fila, conteo de stat chip) — ver la Regla del Protagonista.
- **Do** transmitir estado con tono-sobre-tono (variante on-tint del color en texto/borde + `{color}-tint` fondo) en vez de fondo sólido + texto blanco, para cualquier badge, chip de stat o alerta de resultado — ver la Regla del Contraste en Oscuro.
- **Do** usar el riel de 5px (`border-left`, en su variante on-tint) en cualquier fila/tarjeta nueva que represente un resultado propio, siempre declarado al final del stylesheet respecto de reglas de `border` en forma corta que la afecten.
- **Do** dibujar cualquier ícono nuevo del reporte como SVG propio de trazo único (`currentColor`, `stroke-width="2"`) — nunca un emoji ni una entidad Unicode parada como ícono.
- **Do** mantener toda fuente/asset del reporte y del runner empaquetada localmente (ver la Regla de la Fuente Empaquetada) — cero `<link>`/`@import` a un CDN, el reporte debe abrir con `file://` sin red, siempre.
- **Do** aplicar el acento de marca (`accentColor`/`primaryColor`/etc.) como capa aditiva sobre el sistema neutro — el reporte y el runner sin branding configurado son el estado de referencia, nunca un caso degradado.
- **Do** usar `--qa-card-shadow` (sutil, solo claro) en cualquier `.qa-card` nuevo — es la única sombra permitida en reposo, ver la Regla de lo Plano por Defecto revisada.

### Don't:
- **Don't** introducir un quinto color de estado — reutilizar `pass` para "completado" es intencional, no un vacío por llenar (ver Regla del Cuarto Color).
- **Don't** usar el hex fijo de un color de estado (`--qa-pass`, etc.) para texto o borde sobre una superficie tintada u oscura — ese valor solo existe para calzar con el SVG del chart; todo lo demás usa su variante on-tint.
- **Don't** agregar una sombra marcada/oscura en REPOSO — la única permitida ahí es la ambiental de `--qa-card-shadow` (sutil, solo en claro); cualquier sombra más marcada que esa debe estar atada a una interacción real (hover), nunca a un estado de reposo — ver la Regla de la Elevación en Hover.
- **Don't** agregar un segundo gradiente al sistema — `.qa-card--hero::before` es el único, a propósito (ver la Regla del Glow Único); si otro elemento "necesita" un glow, la respuesta por defecto es que no lo necesita tanto como el hero.
- **Don't** poner un eyebrow/kicker arriba de un `<h1>` — el título lleva el peso completo de la jerarquía; si hace falta encuadrar el documento, ese texto va en el párrafo de metadata debajo del título, no en una etiqueta aparte.
- **Don't** usar el color naranja-rojo de marca (`ctaColor`) para navegación general o para indicar un resultado — está reservado a una única acción destacada por pantalla.
- **Don't** mezclar los radios de las dos superficies dentro del mismo componente — 8/12px es vocabulario del runner, 10/16/20px es vocabulario del reporte; no promediarlos "para unificar".
- **Don't** depender solo del color para comunicar un resultado — badge, chip de stat o texto siempre acompañan al color, en ambas superficies.
