import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: [
			"main.js",
			"node_modules/**",
			"coverage/**",
			"dist/**",
			"tests/**",
			"scripts/**",
			"scratch/**",
			".lina-local/**",
			"esbuild.config.mjs",
			"vitest.config.ts",
		],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: ["Lina"],
					acronyms: ["IA"],
					enforceCamelCaseLower: true,
				},
			],
		},
	},
]);
