import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  // Ignorar artefactos de build y dependencias: solo se analiza NUESTRO código
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
