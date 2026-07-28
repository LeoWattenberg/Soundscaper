/*
 * Load the pinned PFFFT artifact on the main thread so AudioWorklets do not
 * depend on fetch, URL, or importScripts in AudioWorkletGlobalScope.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const PFFFT_WASM_URL = new URL(
	'../../../node_modules/@echogarden/pffft-wasm/dist/simd/pffft.wasm',
	import.meta.url,
);

let sharedModulePromise = null;

/** Compile the pinned artifact once for structured cloning into AudioWorklets. */
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

async function loadModuleSource(source) {
	if (source instanceof WebAssembly.Module) return source;
	let bytes = source;
	if (source instanceof URL || typeof source === 'string') {
		const url = source instanceof URL ? source : new URL(source, import.meta.url);
		if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
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
		bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
