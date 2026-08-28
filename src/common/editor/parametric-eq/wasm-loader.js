// @ts-check

import {
	ParametricEqWasmError,
	compileParametricEqWasm,
} from './wasm-runtime.js';

export const PARAMETRIC_EQ_WASM_URL = new URL('./parametric-eq.wasm', import.meta.url);

/** @typedef {WebAssembly.Module | Response | URL | string | ArrayBuffer | ArrayBufferView} ParametricEqWasmSource */

/** @type {Promise<WebAssembly.Module> | null} */
let sharedModulePromise = null;

/**
 * Compile the pinned artifact once on the main thread for structured cloning.
 *
 * @param {ParametricEqWasmSource} [source]
 * @returns {Promise<WebAssembly.Module>}
 */
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

/**
 * @param {ParametricEqWasmSource} source
 * @returns {Promise<WebAssembly.Module>}
 */
async function loadModuleSource(source) {
	if (source instanceof WebAssembly.Module
		|| source instanceof ArrayBuffer
		|| ArrayBuffer.isView(source)
		|| (typeof Response !== 'undefined' && source instanceof Response)) {
		return compileParametricEqWasm(source);
	}
	const url = source instanceof URL ? source : new URL(String(source), import.meta.url);
	if (url.protocol === 'file:' && isNodeRuntime()) {
		const nodeFsSpecifier = 'node:fs/promises';
		const { readFile } = await import(/* @vite-ignore */ nodeFsSpecifier);
		return compileParametricEqWasm(await readFile(url));
	}
	if (typeof fetch !== 'function') {
		throw new ParametricEqWasmError('No loader is available for the parametric EQ WASM artifact.');
	}
	return compileParametricEqWasm(await fetch(url));
}

function isNodeRuntime() {
	const processValue = Reflect.get(globalThis, 'process');
	const versions = processValue && typeof processValue === 'object'
		? Reflect.get(processValue, 'versions') : null;
	return Boolean(versions && typeof versions === 'object' && Reflect.get(versions, 'node'));
}
