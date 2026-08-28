// @ts-check
/*
 * Load the pinned PFFFT artifact on the main thread so AudioWorklets do not
 * depend on fetch, URL, or importScripts in AudioWorkletGlobalScope.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const PFFFT_WASM_URL = new URL(
	'../../../node_modules/@echogarden/pffft-wasm/dist/simd/pffft.wasm',
	import.meta.url,
);

/** @typedef {WebAssembly.Module | Response | URL | string | ArrayBuffer | ArrayBufferView} PffftWasmSource */

/** @type {Promise<WebAssembly.Module> | null} */
let sharedModulePromise = null;

/**
 * Compile the pinned artifact once for structured cloning into AudioWorklets.
 *
 * @param {PffftWasmSource} [source]
 * @returns {Promise<WebAssembly.Module>}
 */
export function loadPffftWasmModule(source = PFFFT_WASM_URL) {
	if (source !== PFFFT_WASM_URL) return loadModuleSource(source);
	if (!sharedModulePromise) {
		sharedModulePromise = loadModuleSource(source).catch((error) => {
			sharedModulePromise = null;
			throw error;
		});
	}
	return sharedModulePromise;
}

/**
 * @param {PffftWasmSource} source
 * @returns {Promise<WebAssembly.Module>}
 */
async function loadModuleSource(source) {
	if (source instanceof WebAssembly.Module) return source;
	let bytes = source;
	if (source instanceof URL || typeof source === 'string') {
		const url = source instanceof URL ? source : new URL(source, import.meta.url);
		if (url.protocol === 'file:' && isNodeRuntime()) {
			const nodeFsSpecifier = 'node:fs/promises';
			const { readFile } = await import(/* @vite-ignore */ nodeFsSpecifier);
			bytes = await readFile(url);
		} else {
			if (typeof fetch !== 'function') throw new Error('No loader is available for the PFFFT WASM artifact.');
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Could not load PFFFT WASM (${response.status} ${response.statusText}).`);
			bytes = await response.arrayBuffer();
		}
	} else if (typeof Response !== 'undefined' && source instanceof Response) {
		if (!source.ok) throw new Error(`Could not load PFFFT WASM (${source.status} ${source.statusText}).`);
		bytes = await source.arrayBuffer();
	}
	if (ArrayBuffer.isView(bytes)) {
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
		bytes = copy.buffer;
	}
	if (!(bytes instanceof ArrayBuffer)) {
		throw new TypeError('PFFFT WASM source must be a WebAssembly.Module, Response, URL, ArrayBuffer, or typed array.');
	}
	try {
		return await WebAssembly.compile(bytes);
	} catch (error) {
		throw new Error(
			`Could not compile PFFFT WASM: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

function isNodeRuntime() {
	const processValue = Reflect.get(globalThis, 'process');
	const versions = processValue && typeof processValue === 'object'
		? Reflect.get(processValue, 'versions') : null;
	return Boolean(versions && typeof versions === 'object' && Reflect.get(versions, 'node'));
}
