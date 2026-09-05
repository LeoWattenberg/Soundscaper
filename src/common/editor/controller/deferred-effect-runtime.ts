/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from './deferred-module-facade.ts';

type AudacityModule = typeof import('../audacity-effects/index.js');
type SelectionModule = typeof import('../selection-effects-runtime.js');
type PffftModule = typeof import('../pffft.js');
type ParametricEqModule = typeof import('../parametric-eq/wasm-loader.js');
type SpectralModule = typeof import('../spectral-edit.js');
type NyquistModule = typeof import('../nyquist/client.js');
type NyquistClient = InstanceType<NyquistModule['NyquistEvaluationClient']>;
type NyquistEvaluateParameters = Parameters<NyquistClient['evaluate']>;

export interface DeferredEffectModuleLoaders {
	readonly audacity: () => Promise<AudacityModule>;
	readonly selection: () => Promise<SelectionModule>;
	readonly pffft: () => Promise<PffftModule>;
	readonly parametricEq: () => Promise<ParametricEqModule>;
	readonly spectral: () => Promise<SpectralModule>;
	readonly nyquist: () => Promise<NyquistModule>;
}

/** The evaluation client's own contract - the request, then its signal and deadline. */
export interface DeferredNyquistClient {
	evaluate(...args: NyquistEvaluateParameters): Promise<Awaited<ReturnType<NyquistClient['evaluate']>>>;
	dispose(): void;
}

const DEFAULT_LOADERS: DeferredEffectModuleLoaders = Object.freeze({
	audacity: () => import('../audacity-effects/index.js'),
	selection: () => import('../selection-effects-runtime.js'),
	pffft: () => import('../pffft.js'),
	parametricEq: () => import('../parametric-eq/wasm-loader.js'),
	spectral: () => import('../spectral-edit.js'),
	nyquist: () => import('../nyquist/client.js'),
});

const AUDACITY_PORT_NAMES = [
	'applyAudacityEffectAsync',
	'captureAudacityNoiseProfile',
] as const satisfies readonly (keyof AudacityModule)[];
const SELECTION_PORT_NAMES = [
	'applyAudioSelectionEffectAsync',
] as const satisfies readonly (keyof SelectionModule)[];
const PFFFT_PORT_NAMES = ['initializePffft'] as const satisfies readonly (keyof PffftModule)[];
const PARAMETRIC_EQ_PORT_NAMES = [
	'loadParametricEqWasmModule',
] as const satisfies readonly (keyof ParametricEqModule)[];
const SPECTRAL_PORT_NAMES = ['applySpectralGain'] as const satisfies readonly (keyof SpectralModule)[];

/**
 * Lazy execution ports for effects whose descriptors and menu actions stay eager.
 *
 * Each group is a facade over one implementation module, and the `Pick` it is
 * built against is what the completeness check holds to: these modules export
 * more than the controller needs, so the contract here is the named ports, with
 * their signatures taken from the implementation rather than restated.
 */
export function createDeferredEffectRuntime(
	loaders: Partial<DeferredEffectModuleLoaders> = {},
) {
	const audacity = createDeferredModuleFacade<
		Pick<AudacityModule, typeof AUDACITY_PORT_NAMES[number]>, typeof AUDACITY_PORT_NAMES
	>(loaders.audacity ?? DEFAULT_LOADERS.audacity, AUDACITY_PORT_NAMES);
	const selection = createDeferredModuleFacade<
		Pick<SelectionModule, typeof SELECTION_PORT_NAMES[number]>, typeof SELECTION_PORT_NAMES
	>(loaders.selection ?? DEFAULT_LOADERS.selection, SELECTION_PORT_NAMES);
	const pffft = createDeferredModuleFacade<
		Pick<PffftModule, typeof PFFFT_PORT_NAMES[number]>, typeof PFFFT_PORT_NAMES
	>(loaders.pffft ?? DEFAULT_LOADERS.pffft, PFFFT_PORT_NAMES);
	const parametricEq = createDeferredModuleFacade<
		Pick<ParametricEqModule, typeof PARAMETRIC_EQ_PORT_NAMES[number]>, typeof PARAMETRIC_EQ_PORT_NAMES
	>(loaders.parametricEq ?? DEFAULT_LOADERS.parametricEq, PARAMETRIC_EQ_PORT_NAMES);
	const spectral = createDeferredModuleFacade<
		Pick<SpectralModule, typeof SPECTRAL_PORT_NAMES[number]>, typeof SPECTRAL_PORT_NAMES
	>(loaders.spectral ?? DEFAULT_LOADERS.spectral, SPECTRAL_PORT_NAMES);
	const loadNyquist = cachedLoader(loaders.nyquist ?? DEFAULT_LOADERS.nyquist);

	return Object.freeze({
		...audacity,
		...selection,
		...pffft,
		...parametricEq,
		...spectral,
		createNyquistClient: (
			options: ConstructorParameters<NyquistModule['NyquistEvaluationClient']>[0] = {},
		): DeferredNyquistClient => createDeferredNyquistClient(loadNyquist, options),
	});
}

export const deferredEffectRuntime = createDeferredEffectRuntime();

/**
 * The evaluation client is a constructed instance with a disposal contract
 * rather than a set of module functions, so it stays hand-written: disposal has
 * to be answerable before the module exists, and has to reach a client that
 * finished loading after the caller gave up on it.
 */
function createDeferredNyquistClient(
	loadModule: () => Promise<NyquistModule>,
	options: ConstructorParameters<NyquistModule['NyquistEvaluationClient']>[0],
): DeferredNyquistClient {
	let clientPromise: Promise<NyquistClient> | null = null;
	let disposed = false;
	const disposedError = () => new Error('NyquistEvaluationClient is disposed.');
	const loadClient = () => {
		if (disposed) return Promise.reject(disposedError());
		clientPromise ??= loadModule().then((module) => {
			const client = new module.NyquistEvaluationClient(options);
			if (!disposed) return client;
			client.dispose();
			throw disposedError();
		});
		return clientPromise;
	};
	return Object.freeze({
		evaluate: async (...args: NyquistEvaluateParameters) => {
			const client = await loadClient();
			if (disposed) throw disposedError();
			return await client.evaluate(...args);
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			if (clientPromise) void clientPromise.then(
				(client) => client.dispose(),
				() => undefined,
			);
		},
	});
}

function cachedLoader<Module>(load: () => Promise<Module>): () => Promise<Module> {
	let pending: Promise<Module> | null = null;
	return () => {
		pending ??= Promise.resolve().then(load);
		return pending;
	};
}
