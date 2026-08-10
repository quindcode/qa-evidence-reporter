import { readdir, readFile as readFileFs } from 'node:fs/promises';
import { join } from 'node:path';

import { generateMessages } from '@cucumber/gherkin';
import {
  IdGenerator,
  SourceMediaType,
  PickleStepType,
  type Envelope,
  type Feature,
  type Scenario,
  type Pickle,
  type PickleStep,
} from '@cucumber/messages';

import { FeatureParseError } from '../types/errors.js';
import type { Logger } from '../types/logger.js';
import type { GherkinParser, ParsedFeature, ParsedScenario, ParsedStep } from '../types/parser.js';

/**
 * Punto de extensión mínimo para inyectar dependencias en
 * `createGherkinParser` sin tocar la interfaz pública `GherkinParser`
 * (que solo tiene `parseFile`/`parseDirectory`).
 *
 * `logger` se tipa como `Pick<Logger, 'debug'>` (fase 4, `core/types/logger.ts`)
 * en vez de la interfaz `Logger` completa: este módulo solo llama a
 * `logger.debug(...)`, así que exigir los 4 métodos sería un requisito más
 * estricto de lo necesario para quien construye este parser a mano (p. ej.
 * un test que solo necesita un stub de `debug`). Cualquier `Logger` real
 * (`createLogger` de `core/logger`) sigue siendo válido acá sin cambios, ya
 * que `Logger` es un superset estructural de `Pick<Logger, 'debug'>`. Antes
 * de que `core/logger`/`core/types/logger.ts` existieran (fases 1-3), este
 * campo usaba una forma ad-hoc local equivalente; se consolidó contra el
 * tipo real en fase 4 sin romper ningún caller existente (ningún test de
 * este módulo pasa `logger`, ver `gherkinParser.test.ts`).
 */
export interface GherkinParserDeps {
  logger?: Pick<Logger, 'debug'>;
  /** Inyectable principalmente para tests; por defecto lee del filesystem real. */
  readFile?: (filePath: string) => Promise<string>;
}

/**
 * Factory del `GherkinParser` de referencia, basado en `@cucumber/gherkin`
 * + `@cucumber/messages` (la API oficial del proyecto Cucumber).
 *
 * No hay estado que mockear en `@cucumber/gherkin` en sí (es una librería
 * pura, sin I/O ni singletons), así que no necesita inyectarse: se usa
 * directamente. Lo único inyectable es el acceso a filesystem (`readFile`)
 * y un logger opcional, ver `GherkinParserDeps`.
 */
export function createGherkinParser(deps: GherkinParserDeps = {}): GherkinParser {
  const readFile = deps.readFile ?? ((filePath: string) => readFileFs(filePath, 'utf-8'));
  const logger = deps.logger;

  async function parseFile(filePath: string): Promise<ParsedFeature> {
    logger?.debug('Parsing feature file', { filePath });

    let source: string;
    try {
      source = await readFile(filePath);
    } catch (error) {
      throw new FeatureParseError(filePath, 'no se pudo leer el archivo', { cause: error });
    }

    const newId = IdGenerator.uuid();
    const envelopes: readonly Envelope[] = generateMessages(
      source,
      filePath,
      SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
      {
        includeGherkinDocument: true,
        includePickles: true,
        newId,
      },
    );

    const parseError = envelopes.find((envelope) => envelope.parseError);
    if (parseError?.parseError) {
      throw new FeatureParseError(filePath, parseError.parseError.message);
    }

    const gherkinDocumentEnvelope = envelopes.find((envelope) => envelope.gherkinDocument);
    const feature = gherkinDocumentEnvelope?.gherkinDocument?.feature;
    if (!feature) {
      throw new FeatureParseError(
        filePath,
        'el archivo no contiene una Feature/Característica válida',
      );
    }

    const pickles = envelopes
      .filter((envelope) => envelope.pickle)
      .map((envelope) => envelope.pickle as Pickle);

    const { scenariosById, backgroundStepIds } = indexFeature(feature);

    return {
      name: feature.name,
      description: feature.description.trim(),
      tags: feature.tags.map((tag) => tag.name),
      language: feature.language,
      filePath,
      scenarios: pickles.map((pickle) =>
        toParsedScenario(pickle, scenariosById, backgroundStepIds),
      ),
    };
  }

  async function parseDirectory(dirPath: string): Promise<ParsedFeature[]> {
    logger?.debug('Scanning directory for .feature files', { dirPath });
    const files = (await findFeatureFiles(dirPath)).sort();
    return Promise.all(files.map((filePath) => parseFile(filePath)));
  }

  return { parseFile, parseDirectory };
}

/** Recorre `dirPath` recursivamente y devuelve las rutas de todos los `*.feature` encontrados. */
async function findFeatureFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFeatureFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      files.push(fullPath);
    }
  }

  return files;
}

interface FeatureIndex {
  /** Escenarios originales (sin expandir) indexados por su id de AST. */
  scenariosById: Map<string, Scenario>;
  /** Ids de los steps que pertenecen a un bloque Background (de la Feature o de una Rule). */
  backgroundStepIds: Set<string>;
}

/**
 * Indexa la Feature original (antes de compilar a Pickles) para poder,
 * dado un Pickle ya expandido, recuperar: sus tags propios (no heredados),
 * y si cada uno de sus steps venía de un Background.
 *
 * Nota: se recorren también los `Rule` (si los hubiera) por robustez, aunque
 * ARCHITECTURE.md no exige soporte explícito de `Rule` en esta fase.
 */
function indexFeature(feature: Feature): FeatureIndex {
  const scenariosById = new Map<string, Scenario>();
  const backgroundStepIds = new Set<string>();

  for (const child of feature.children) {
    if (child.background) {
      for (const step of child.background.steps) backgroundStepIds.add(step.id);
    }
    if (child.scenario) {
      scenariosById.set(child.scenario.id, child.scenario);
    }
    if (child.rule) {
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) {
          for (const step of ruleChild.background.steps) backgroundStepIds.add(step.id);
        }
        if (ruleChild.scenario) {
          scenariosById.set(ruleChild.scenario.id, ruleChild.scenario);
        }
      }
    }
  }

  return { scenariosById, backgroundStepIds };
}

function toParsedScenario(
  pickle: Pickle,
  scenariosById: Map<string, Scenario>,
  backgroundStepIds: Set<string>,
): ParsedScenario {
  // Por construcción del compilador de Pickles de @cucumber/gherkin:
  // astNodeIds = [scenario.id] para un Scenario normal, o
  // astNodeIds = [scenario.id, examplesRow.id] para una fila expandida de
  // un Scenario Outline.
  const scenarioId = pickle.astNodeIds[0];
  const rowId = pickle.astNodeIds[1];
  const scenario = scenarioId ? scenariosById.get(scenarioId) : undefined;
  const isOutlineExample = rowId !== undefined;

  return {
    name: pickle.name,
    tags: scenario ? scenario.tags.map((tag) => tag.name) : [],
    isOutlineExample,
    exampleValues: isOutlineExample && scenario ? findExampleValues(scenario, rowId) : undefined,
    steps: pickle.steps.map((step) => toParsedStep(step, backgroundStepIds)),
  };
}

function toParsedStep(step: PickleStep, backgroundStepIds: Set<string>): ParsedStep {
  return {
    keyword: keywordFromPickleStepType(step.type),
    text: step.text,
    fromBackground: step.astNodeIds.some((id) => backgroundStepIds.has(id)),
  };
}

function keywordFromPickleStepType(type: PickleStepType | undefined): ParsedStep['keyword'] {
  switch (type) {
    case PickleStepType.CONTEXT:
      return 'Given';
    case PickleStepType.ACTION:
      return 'When';
    case PickleStepType.OUTCOME:
      return 'Then';
    default:
      // Ver decisión documentada en el JSDoc de ParsedStep: fallback seguro.
      return 'Given';
  }
}

/**
 * Busca, en las tablas `Examples` originales de `scenario`, la fila con id
 * `rowId` y construye el mapa columna->valor para esa fila. Un escenario
 * puede tener varios bloques `Examples`; se busca en todos.
 */
function findExampleValues(scenario: Scenario, rowId: string): Record<string, string> | undefined {
  for (const examples of scenario.examples) {
    if (!examples.tableHeader) continue;
    const row = examples.tableBody.find((tableRow) => tableRow.id === rowId);
    if (!row) continue;

    const values: Record<string, string> = {};
    examples.tableHeader.cells.forEach((headerCell, index) => {
      values[headerCell.value] = row.cells[index]?.value ?? '';
    });
    return values;
  }
  return undefined;
}
