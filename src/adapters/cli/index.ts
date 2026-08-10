#!/usr/bin/env node
import { Command } from 'commander';

import { QaError } from '../../core/types/errors.js';
import { runInit } from './commands/init.js';
import { runReport } from './commands/report.js';
import { runRun } from './commands/run.js';

/**
 * Entrypoint del binario `qa-evidence-reporter` (ver `package.json`, campo
 * `bin`: apunta a `dist/adapters/cli/index.js`, el archivo que compila este
 * mismo módulo). Define los 3 comandos previstos en ARCHITECTURE.md
 * ("Identidad del paquete"): `init`, `run`, `report`.
 *
 * Decisión de diseño (comandos como funciones puras en `./commands/*.ts`,
 * este archivo solo los conecta a `commander`): así los comandos se pueden
 * testear llamándolos directamente (ver `commands/*.test.ts`) sin pasar por
 * `commander` ni por un subproceso real — este archivo, en cambio, no tiene
 * tests unitarios propios porque su única responsabilidad es "parsear
 * argv y delegar", que se valida con la prueba manual del binario real
 * (`node dist/adapters/cli/index.js ...`, ver la validación de esta fase).
 *
 * Decisión de diseño (manejo de errores centralizado en `withErrorHandling`):
 * ver la consigna de esta fase — ningún comando debe dejar escapar un stack
 * trace crudo de Node como única salida para un error esperado del dominio.
 * Cualquier `QaError` (`core/types/errors.ts`, la única familia de errores
 * que puede cruzar el límite de `core/**`) se imprime como
 * `Error [code]: message`; cualquier otra excepción (un bug real, no un
 * error de dominio) se imprime de forma más genérica, y solo muestra el
 * stack completo si `QA_EVIDENCE_REPORTER_DEBUG` está seteado, para no
 * confundir a un usuario final con un stack trace de Node por defecto pero
 * sin perder esa información para debugging.
 */
const program = new Command();

program
  .name('qa-evidence-reporter')
  .description(
    'Captura evidencia de QA manual sobre features Gherkin y genera reportes HTML auto-contenidos.',
  )
  .version('0.1.0');

program
  .command('init')
  .description(
    'Inicializa un proyecto QA en el directorio actual: crea features/, evidence/, reports/ y qa-config.json.',
  )
  .option(
    '--name <projectName>',
    'Nombre del proyecto (por defecto, el nombre de la carpeta actual)',
  )
  .option('--force', 'Sobreescribe "qa-config.json" si ya existe', false)
  .action(async (options: { name?: string; force?: boolean }) => {
    await withErrorHandling(() => runInit(process.cwd(), options));
  });

program
  .command('run')
  .description(
    'Levanta el server interactivo de QA (runner paso a paso) para el proyecto actual y, si está habilitado, abre el navegador.',
  )
  .action(async () => {
    await withErrorHandling(() => runRun(process.cwd()));
  });

program
  .command('report')
  .description('Genera el reporte HTML final del proyecto actual a partir de la sesión guardada.')
  .action(async () => {
    await withErrorHandling(() => runReport(process.cwd()));
  });

async function withErrorHandling(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof QaError) {
      console.error(`\nError [${error.code}]: ${error.message}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nError inesperado: ${message}\n`);
      if (process.env.QA_EVIDENCE_REPORTER_DEBUG && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
    process.exitCode = 1;
  }
}

await program.parseAsync(process.argv);
