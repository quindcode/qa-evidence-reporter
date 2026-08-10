// Flat ESLint config (ESLint 9.x).
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Regla de arquitectura (ver ARCHITECTURE.md "Regla de dependencia estricta"):
      // core/** es lógica de negocio pura y nunca debe conocer detalles de
      // transporte (CLI/HTTP) ni de UI. Bloqueamos cualquier import desde
      // src/core/** hacia src/adapters/** o src/ui/** para hacer cumplir esa
      // capa en tiempo de lint (más simple de mantener aquí que instalar
      // eslint-plugin-boundaries para un solo par de reglas).

      // Agregado en fase 5a (`adapters/server`): el middleware de manejo de
      // errores de Express se detecta por aridad (debe declarar exactamente
      // 4 parámetros — `(err, req, res, next)` — para que Express lo trate
      // como error handler en vez de middleware normal), aunque `req`/`next`
      // no se usen dentro del cuerpo. `argsIgnorePattern: '^_'` permite
      // nombrar esos parámetros `_req`/`_next` sin que
      // `@typescript-eslint/no-unused-vars` los marque (por defecto,
      // `args: 'after-used'` sí los marcaría, porque son los últimos
      // parámetros de la función). No afecta código existente: ningún
      // parámetro previo a esta fase usaba el prefijo `_`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '**/ui/**'],
              message:
                'src/core/** no puede importar de src/adapters/** ni src/ui/** (ver ARCHITECTURE.md, regla de dependencia estricta).',
            },
          ],
        },
      ],
    },
  },
  // Agregado en fase 5b (`src/ui/`, Preact): hace cumplir en tiempo de lint
  // la otra mitad de la misma regla de dependencia estricta de
  // ARCHITECTURE.md ("`ui/**` solo llama a `adapters/server` vía `fetch`
  // HTTP. Nunca importa `core`."). Hasta esta fase la regla equivalente solo
  // estaba escrita para `src/core/**` (ver el bloque de arriba) porque
  // `src/ui/` todavía no existía como código real. Se bloquea también
  // `**/adapters/**` (no solo `**/core/**`) por el mismo motivo que el
  // bloque de `core`: ninguna capa de transporte debería filtrarse a `ui/`
  // salvo a través de HTTP.
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/**', '**/adapters/**'],
              message:
                'src/ui/** no puede importar de src/core/** ni src/adapters/** (ver ARCHITECTURE.md, regla de dependencia estricta) — solo puede llamar a la API vía fetch.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
