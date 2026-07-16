import {
	ParametricEqWasmError,
	compileParametricEqWasm,
} from './wasm-runtime.js';

export const PARAMETRIC_EQ_WASM_URL = new URL('./parametric-eq.wasm', import.meta.url);

let sharedModulePromise = null;

/** Compile the pinned artifact once on the main thread for structured cloning. */
export function loadParametricEqWasmModule(source = PARAMETRIC_EQ_WASM_URL) {
	if (source !== PARAMETRIC_EQ_WASM_URL) return loadModuleSource(source);
	if (!sharedModulePromise) {
		sharedModulePromise = loadModuleSource(source).catch((error) => {
			sharedModulePromise = null;
			throw error;
		});
	}
	return sharedModulePromise;
}

async function loadModuleSource(source) {
	if (source instanceof WebAssembly.Module
		|| source instanceof ArrayBuffer
		|| ArrayBuffer.isView(source)
		|| (typeof Response !== 'undefined' && source instanceof Response)) {
		return compileParametricEqWasm(source);
	}
	const url = source instanceof URL ? source : new URL(String(source), import.meta.url);
	if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
		const nodeFsSpecifier = 'node:fs/promises';
		const { readFile } = await import(/* @vite-ignore */ nodeFsSpecifier);
		return compileParametricEqWasm(await readFile(url));
	}
	if (typeof fetch !== 'function') {
		throw new ParametricEqWasmError('No loader is available for the parametric EQ WASM artifact.');
	}
	return compileParametricEqWasm(await fetch(url));
}
