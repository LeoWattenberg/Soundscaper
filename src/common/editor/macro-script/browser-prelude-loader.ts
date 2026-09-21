/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Make Vite's emitted prelude asset a dependency of the generated blob module.
 *
 * A blob URL has no useful directory for a relative import. Resolving the
 * emitted URL against the current document also preserves custom-scheme
 * packaged renderers while leaving the prelude as an independently observable
 * first-party script for coverage.
 */
export function macroPreludeImportSource(moduleUrl: string, documentUrl: string): string {
	return `import ${JSON.stringify(new URL(moduleUrl, documentUrl).href)};`;
}
