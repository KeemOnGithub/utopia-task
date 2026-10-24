import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['apps/**/*.test.{ts,tsx}','packages/**/*.test.ts'],exclude:['**/*.integration.test.ts'],environment:'node',pool:'forks',maxWorkers:2}});
