/* SPDX-License-Identifier: AGPL-3.0-only */

type AudacityModule = typeof import('../audacity-effects/index.js');
type SelectionModule = typeof import('../selection-effects-runtime.js');
type PffftModule = typeof import('../pffft.js');
type ParametricEqModule = typeof import('../parametric-eq/wasm-loader.js');
type SpectralModule = typeof import('../spectral-edit.js');
type NyquistModule = typeof import('../nyquist/client.js');

export interface DeferredEffectModuleLoaders {
	readonly audacity: () => Promise<AudacityModule>;
	readonly selection: () => Promise<SelectionModule>;
	readonly pffft: () => Promise<PffftModule>;
	readonly parametricEq: () => Promise<ParametricEqModule>;
	readonly spectral: () => Promise<SpectralModule>;
	readonly nyquist: () => Promise<NyquistModule>;
}

export interface DeferredNyquistClient {
	evaluate(...args: unknown[]): Promise<unknown>;
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

/** Lazy execution ports for effects whose descriptors and menu actions stay eager. */
export function createDeferredEffectRuntime(
	loaders: Partial<DeferredEffectModuleLoaders> = {},
) {
	const loadAudacity = cachedLoader(loaders.audacity ?? DEFAULT_LOADERS.audacity);
	const loadSelection = cachedLoader(loaders.selection ?? DEFAULT_LOADERS.selection);
	const loadPffft = cachedLoader(loaders.pffft ?? DEFAULT_LOADERS.pffft);
	const loadParametricEq = cachedLoader(loaders.parametricEq ?? DEFAULT_LOADERS.parametricEq);
	const loadSpectral = cachedLoader(loaders.spectral ?? DEFAULT_LOADERS.spectral);
	const loadNyquist = cachedLoader(loaders.nyquist ?? DEFAULT_LOADERS.nyquist);

	return Object.freeze({
		applyAudacityEffectAsync: async (...args: Parameters<AudacityModule['applyAudacityEffectAsync']>) => (
			(await loadAudacity()).applyAudacityEffectAsync(...args)
		),
		captureAudacityNoiseProfile: async (...args: Parameters<AudacityModule['captureAudacityNoiseProfile']>) => (
			(await loadAudacity()).captureAudacityNoiseProfile(...args)
		),
		applyAudioSelectionEffectAsync: async (...args: Parameters<SelectionModule['applyAudioSelectionEffectAsync']>) => (
			(await loadSelection()).applyAudioSelectionEffectAsync(...args)
		),
		initializePffft: async (...args: Parameters<PffftModule['initializePffft']>) => (
			(await loadPffft()).initializePffft(...args)
		),
		loadParametricEqWasmModule: async (...args: Parameters<ParametricEqModule['loadParametricEqWasmModule']>) => (
			(await loadParametricEq()).loadParametricEqWasmModule(...args)
		),
		applySpectralGain: async (...args: Parameters<SpectralModule['applySpectralGain']>) => (
			(await loadSpectral()).applySpectralGain(...args)
		),
		createNyquistClient: (options: ConstructorParameters<NyquistModule['NyquistEvaluationClient']>[0] = {}) => (
			createDeferredNyquistClient(loadNyquist, options)
		),
	});
}

export const deferredEffectRuntime = createDeferredEffectRuntime();

function createDeferredNyquistClient(
	loadModule: () => Promise<NyquistModule>,
	options: ConstructorParameters<NyquistModule['NyquistEvaluationClient']>[0],
): DeferredNyquistClient {
	let clientPromise: Promise<InstanceType<NyquistModule['NyquistEvaluationClient']>> | null = null;
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
		evaluate: async (...args: unknown[]) => {
			const client = await loadClient();
			if (disposed) throw disposedError();
			return Reflect.apply(client.evaluate, client, args);
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
