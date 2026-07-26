/* SPDX-License-Identifier: AGPL-3.0-only */

const VIRTUAL_MODULE_ID = '\0soundscaper:pffft-node-module-browser-shim';
const PFFFT_VENDOR_MODULE = /\/node_modules\/@echogarden\/pffft-wasm\/dist\/(?:non-simd|simd)\/pffft\.js$/u;

/**
 * The pinned Emscripten bundle contains a dynamic import of Node's `module`
 * package behind its Node-only environment branch. Vite still resolves that
 * dead browser branch and otherwise emits a browser-external warning and shim.
 * Keep this adapter scoped to that exact pinned vendor module.
 */
export function createPffftNodeModuleBrowserShim() {
	return {
		name: 'soundscaper:pffft-node-module-browser-shim',
		enforce: 'pre',
		resolveId(source, importer) {
			if (source !== 'module' || typeof importer !== 'string') return null;
			return PFFFT_VENDOR_MODULE.test(importer.replaceAll('\\', '/'))
				? VIRTUAL_MODULE_ID
				: null;
		},
		load(id) {
			if (id !== VIRTUAL_MODULE_ID) return null;
			return [
				'export function createRequire() {',
				"\tthrow new Error('PFFFT Node-only createRequire path cannot run in a browser build.');",
				'}',
			].join('\n');
		},
	};
}
