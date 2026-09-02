// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.opencode/**",
      "**/e2e/**",
      "**/test/**",
      "**/artifacts/**",
      "**/packages/storybook/.storybook/**",
      "**/packages/ui/src/**/*.stories.tsx",
      "**/*.gen.ts",
    ],
    
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    
    rules: {
      // Temporarily disable these to reduce noise
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/consistent-return": "off",
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-self-assign": "off",
      "no-undef": "off",
      "prefer-const": "warn",
      
      // Keep these enabled
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-namespace": "warn",
      "require-yield": "warn",
    }
  }
);
