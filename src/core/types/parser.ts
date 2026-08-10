/**
 * Un paso (`Given`/`When`/`Then`) ya normalizado, listo para ser mostrado o
 * ejecutado manualmente por un QA.
 *
 * Decisión de diseño (i18n): `keyword` siempre es la forma canónica en
 * inglés (`'Given' | 'When' | 'Then'`), sin importar el idioma original del
 * archivo `.feature` (p. ej. "Dado"/"Cuando"/"Entonces" en español, o
 * "And"/"Y"/"But"/"Pero" que heredan el tipo del paso anterior). Esto evita
 * que `core/session` y `core/report` tengan que conocer los ~80 idiomas que
 * soporta Gherkin: solo necesitan distinguir 3 tipos de paso. El texto tal
 * cual aparece en el `.feature` (ya interpolado si viene de un
 * Scenario Outline) se conserva en `text`.
 *
 * La clasificación se obtiene de `@cucumber/gherkin` (vía el `Pickle`
 * compilado), que ya resuelve "And"/"But" al tipo del paso anterior no
 * conjuntivo. Un paso sin clasificación posible (p. ej. un `*` como primer
 * paso del escenario, sin `Given/When/Then` previo) cae por convención en
 * `'Given'` como fallback seguro.
 */
export interface ParsedStep {
  /** Forma canónica en inglés del tipo de paso. */
  keyword: 'Given' | 'When' | 'Then';
  /** Texto del paso, ya interpolado si proviene de una fila de Examples. */
  text: string;
  /**
   * `true` si este paso proviene de un bloque `Background`/`Antecedentes`
   * de la feature (ver decisión de modelado de Background más abajo, en
   * `ParsedScenario`).
   */
  fromBackground: boolean;
}

/**
 * Un escenario ya "compilado": listo para ejecutarse tal cual, sin que el
 * consumidor tenga que resolver Background ni Scenario Outline por su
 * cuenta.
 *
 * Decisión de diseño (Background): los pasos de un bloque `Background` se
 * incrustan al inicio de `steps` de CADA escenario de la feature (marcados
 * con `fromBackground: true`), en lugar de modelarse como una lista
 * separada en `ParsedFeature`. Motivo: el flujo de ejecución real de un QA
 * (`core/session`) avanza paso a paso de forma lineal por escenario; tener
 * el Background ya mezclado evita que cada consumidor tenga que
 * reimplementar la regla "primero corre el Background, luego el
 * escenario". El flag `fromBackground` permite a la UI/reporte mostrarlos
 * atenuados o agruparlos si se desea. Esta expansión reutiliza el
 * compilador oficial de Pickles de `@cucumber/gherkin` (el mismo mecanismo
 * que usa cucumber-js para ejecutar features), en vez de reimplementar la
 * fusión a mano.
 *
 * Decisión de diseño (Scenario Outline + Examples): un `Scenario Outline`
 * con `Examples` se EXPANDE a un `ParsedScenario` concreto por cada fila de
 * la tabla de ejemplos (de nuevo vía Pickles de `@cucumber/gherkin`, que ya
 * hace la interpolación de `<placeholder>` de forma robusta, incluyendo
 * escapes). Motivo: todo lo que consuma `ParsedFeature` (sesión de
 * ejecución, reporte) necesita una lista plana de escenarios ejecutables
 * con texto final; no queremos que cada consumidor reimplemente la
 * interpolación de variables. El outline original no se pierde del todo:
 * cada escenario expandido conserva `isOutlineExample: true` y
 * `exampleValues` con los valores de esa fila, para que el reporte pueda
 * agruparlos o mostrar de qué fila de Examples vino.
 */
export interface ParsedScenario {
  /** Nombre del escenario. Si viene de un Outline, ya con placeholders interpolados. */
  name: string;
  /** Tags declarados directamente en el escenario (NO incluye los tags heredados de la Feature). */
  tags: string[];
  /** Pasos ejecutables en orden, con el Background (si existe) ya al inicio. */
  steps: ParsedStep[];
  /** `true` si este escenario proviene de una fila de `Examples` de un `Scenario Outline`. */
  isOutlineExample: boolean;
  /**
   * Valores de la fila de `Examples` que generó este escenario (clave =
   * nombre de columna, valor = celda). Solo presente cuando
   * `isOutlineExample` es `true`.
   */
  exampleValues?: Record<string, string>;
}

/**
 * Modelo de una feature `.feature` ya parseada y normalizada.
 */
export interface ParsedFeature {
  /** Nombre de la Feature/Característica. */
  name: string;
  /** Descripción libre debajo del nombre de la Feature (puede ser cadena vacía). */
  description: string;
  /** Tags declarados directamente en la Feature. */
  tags: string[];
  /** Código de idioma detectado (p. ej. `'en'`, `'es'`), tomado de `# language:` o el default `'en'`. */
  language: string;
  /** Ruta absoluta (o la que se le pasó a `parseFile`) del archivo `.feature` de origen. */
  filePath: string;
  /** Escenarios ya expandidos (ver decisiones de Background/Outline arriba). */
  scenarios: ParsedScenario[];
}

/**
 * Puerto (interfaz) para parsear archivos Gherkin `.feature` a nuestro
 * modelo `ParsedFeature`. La implementación de referencia
 * (`createGherkinParser` en `core/parser/gherkinParser.ts`) usa
 * `@cucumber/gherkin` + `@cucumber/messages`.
 *
 * Ambos métodos deben rechazar (nunca lanzar de forma síncrona) con un
 * `FeatureParseError` (ver `core/types/errors.ts`) cuando un archivo no es
 * Gherkin válido — nunca deben propagar la excepción cruda del parser de
 * cucumber ni un `Error` genérico.
 */
export interface GherkinParser {
  /** Parsea un único archivo `.feature`. */
  parseFile(filePath: string): Promise<ParsedFeature>;
  /**
   * Busca recursivamente archivos `*.feature` dentro de `dirPath` y los
   * parsea todos. El orden del array resultante es determinístico (orden
   * alfabético de ruta), para que los reportes generados sean estables
   * entre corridas.
   */
  parseDirectory(dirPath: string): Promise<ParsedFeature[]>;
}
