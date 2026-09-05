/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NativeAup4Client } from './native-project-types.ts';

type Aup4Module = typeof import('../aup4-client.js');
type LegacyDecodeModule = typeof import('../aup-legacy.js');
type LegacyConvertModule = typeof import('../aup-legacy-conversion.js');
type ScapeModule = typeof import('../scape-project.js');
type ScapeCopyModule = typeof import('../scape-archive-copy.ts');

export interface DeferredArchiveLegacyModule {
	readonly decodeLegacyAupProject: LegacyDecodeModule['decodeLegacyAupProject'];
	readonly convertLegacyAupToProject: LegacyConvertModule['convertLegacyAupToProject'];
}

export interface DeferredArchiveModuleLoaders {
	readonly aup4: () => Promise<Aup4Module>;
	readonly legacy: () => Promise<DeferredArchiveLegacyModule>;
	readonly scape: () => Promise<ScapeModule>;
	readonly copy: () => Promise<ScapeCopyModule>;
}

const DEFAULT_LOADERS: DeferredArchiveModuleLoaders = Object.freeze({
	aup4: () => import('../aup4-client.js'),
	legacy: async () => {
		const [decoder, converter] = await Promise.all([
			import('../aup-legacy.js'),
			import('../aup-legacy-conversion.js'),
		]);
		return Object.freeze({
			decodeLegacyAupProject: decoder.decodeLegacyAupProject,
			convertLegacyAupToProject: converter.convertLegacyAupToProject,
		});
	},
	scape: () => import('../scape-project.js'),
	copy: () => import('../scape-archive-copy.ts'),
});

/**
 * Preserve the synchronous controller/action facade while keeping archive
 * parsers, writers, and their workers outside the product-ready graph.
 *
 * This is the one facade that cannot use `deferred-module-facade.ts`: it owns
 * the `project-interchange-foundations` chunk the standalone transfer page
 * loads, and that chunk is dependency-closed by test - the facade may carry
 * erased types and dynamic implementation imports and nothing else, so its
 * delegations stay written out here.
 */
export function createDeferredArchiveRuntime(
	loaders: Partial<DeferredArchiveModuleLoaders> = {},
) {
	const loadAup4 = cachedLoader(loaders.aup4 ?? DEFAULT_LOADERS.aup4);
	const loadLegacy = cachedLoader(loaders.legacy ?? DEFAULT_LOADERS.legacy);
	const loadScape = cachedLoader(loaders.scape ?? DEFAULT_LOADERS.scape);
	const loadCopy = cachedLoader(loaders.copy ?? DEFAULT_LOADERS.copy);

	return Object.freeze({
		createAup4Client: (options: Readonly<Record<string, unknown>> = {}) => (
			createDeferredAup4Client(loadAup4, options)
		),
		requestAup4FileHandle: async (...args: Parameters<Aup4Module['requestAup4FileHandle']>) => (
			(await loadAup4()).requestAup4FileHandle(...args)
		),
		saveAup4Result: async (...args: Parameters<Aup4Module['saveAup4Result']>) => (
			(await loadAup4()).saveAup4Result(...args)
		),
		decodeLegacyAupProject: async (...args: Parameters<LegacyDecodeModule['decodeLegacyAupProject']>) => (
			(await loadLegacy()).decodeLegacyAupProject(...args)
		),
		convertLegacyAupToProject: async (...args: Parameters<LegacyConvertModule['convertLegacyAupToProject']>) => (
			(await loadLegacy()).convertLegacyAupToProject(...args)
		),
		inspectScapeProject: async (...args: Parameters<ScapeModule['inspectScapeProject']>) => (
			(await loadScape()).inspectScapeProject(...args)
		),
		importScapeProject: async (...args: Parameters<ScapeModule['importScapeProject']>) => (
			(await loadScape()).importScapeProject(...args)
		),
		exportScapeProject: async (...args: Parameters<ScapeModule['exportScapeProject']>) => (
			(await loadScape()).exportScapeProject(...args)
		),
		copyFutureScapeArchive: async (...args: Parameters<ScapeCopyModule['copyFutureScapeArchive']>) => (
			(await loadCopy()).copyFutureScapeArchive(...args)
		),
	});
}

export const deferredArchiveRuntime = createDeferredArchiveRuntime();

function createDeferredAup4Client(
	loadModule: () => Promise<Aup4Module>,
	options: Readonly<Record<string, unknown>>,
): NativeAup4Client {
	let clientPromise: Promise<NativeAup4Client> | null = null;
	const loadClient = (): Promise<NativeAup4Client> => {
		const pending = clientPromise ?? loadModule().then(
			(module) => module.createAup4Client(options) as unknown as NativeAup4Client,
		);
		clientPromise = pending;
		return pending;
	};
	const invoke = async (method: keyof NativeAup4Client, args: readonly unknown[]) => {
		const client = await loadClient();
		const operation = client[method];
		if (typeof operation !== 'function') {
			throw new TypeError(`The deferred AUP4 client does not implement ${String(method)}.`);
		}
		return Reflect.apply(operation, client, args);
	};
	const invokeOptional = async (method: keyof NativeAup4Client, args: readonly unknown[]) => {
		const client = await loadClient();
		const operation = client[method];
		return typeof operation === 'function' ? Reflect.apply(operation, client, args) : undefined;
	};
	return Object.freeze({
		initialize: (...args: unknown[]) => invoke('initialize', args),
		create: (...args: unknown[]) => invoke('create', args),
		openFile: (...args: unknown[]) => invoke('openFile', args),
		decode: (...args: unknown[]) => invoke('decode', args),
		writeSnapshot: (...args: unknown[]) => invoke('writeSnapshot', args),
		commit: (...args: unknown[]) => invoke('commit', args),
		export: (...args: unknown[]) => invoke('export', args),
		inspect: (...args: unknown[]) => invoke('inspect', args),
		delete: (...args: unknown[]) => invokeOptional('delete', args),
		close: (...args: unknown[]) => invokeOptional('close', args),
		dispose: async () => {
			if (!clientPromise) return;
			const client = await clientPromise;
			await client.dispose?.();
		},
	} as unknown as NativeAup4Client);
}

function cachedLoader<Module>(load: () => Promise<Module>): () => Promise<Module> {
	let pending: Promise<Module> | null = null;
	return () => {
		pending ??= Promise.resolve().then(load);
		return pending;
	};
}
