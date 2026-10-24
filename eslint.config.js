import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['**/dist/**','build/**','test-results/**','playwright-report/**','node_modules/**']},...tseslint.configs.recommended,{rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});
