/* SPDX-License-Identifier: AGPL-3.0-only */

/** Function-only import authority shared by the six direct bundled WebAssembly codecs. */

type AllowedImport = (...arguments_: number[]) => number | void;

export async function instantiateDirectBundledAudioCodecWasm(
	source: Uint8Array,
	allowedImports: Readonly<Record<string, AllowedImport>>,
	forbiddenImport: (key: string) => Error,
	options: Readonly<{
		readonly expectedImportCount?: number;
		readonly changedImportInventory?: () => Error;
	}> = {},
): Promise<WebAssembly.Exports> {
	const ownedSource = new Uint8Array(source.byteLength);
	ownedSource.set(source);
	const module = await WebAssembly.compile(ownedSource);
	const descriptors = WebAssembly.Module.imports(module);
	if (options.expectedImportCount !== undefined
		&& descriptors.length !== options.expectedImportCount) {
		throw options.changedImportInventory?.()
			?? new TypeError('The reviewed bundled codec import inventory changed.');
	}
	const imports: Record<string, Record<string, AllowedImport>> = {};
	for (const descriptor of descriptors) {
		const key = `${descriptor.module}.${descriptor.name}`;
		const implementation = allowedImports[key];
		if (descriptor.kind !== 'function' || implementation === undefined) {
			throw forbiddenImport(key);
		}
		imports[descriptor.module] ??= {};
		imports[descriptor.module]![descriptor.name] = implementation;
	}
	return (await WebAssembly.instantiate(module, imports)).exports;
}
