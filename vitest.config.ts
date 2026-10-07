import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    // Les suites d'intégration rejouent des parcours entiers sur une vraie base (parcours héros : demande,
    // alertes, SMS, transfusion) : sur le lanceur de la CI, avec la couverture, 5 s ne suffisent pas.
    testTimeout: 30_000,
    hookTimeout: 90_000,
    coverage: { provider: 'v8', include: ['src/**/*.service.ts', 'src/common/**/*.ts'], reporter: ['text', 'lcov'] },
    env: { DEMO_MODE: 'true' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unitaires',
          include: ['test/**/*.spec.ts'],
          exclude: [...configDefaults.exclude, 'test/**/*.integration.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.integration.spec.ts'],
          // Ces suites partagent une seule base seedée que chaque test remet en état : lancées en parallèle,
          // elles se marchent dessus (stock de pharmacie, alertes d'un même donneur). Un seul processus,
          // les fichiers l'un après l'autre.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
