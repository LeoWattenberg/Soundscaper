/* SPDX-License-Identifier: AGPL-3.0-only */

export type DeferredLocalAssistancePreparationModule = typeof import('./local-assistance-runtime.ts');
type LocalAssistancePreparation = ReturnType<
	DeferredLocalAssistancePreparationModule['createLocalAssistancePreparationRuntime']
>;
type MethodParameters<Value> = Value extends (...args: infer Args) => unknown ? Args : never;
type MethodResult<Value> = Value extends (...args: infer _Args) => infer Result ? Awaited<Result> : never;

export interface DeferredLocalAssistanceRuntimeDependencies {
	readonly assistanceStore?: unknown;
	readonly assistanceVideoStore?: unknown;
	readonly assistanceDerivativeRepository?: import(
		'../storage/deferred-assistance-derivative-repository.ts'
	).AssistanceDerivativeRepositoryPort;
	readonly createId: (prefix: string) => string;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly getProject: () => unknown;
	readonly getSelectedClipId: () => string | null;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly renderDryTrackRange: (
		trackId: string,
		startFrame: number,
		endFrame: number,
		requestedChannelCount: null,
		requestedClipIds: readonly string[],
		signal?: AbortSignal,
	) => Promise<readonly Float32Array[]>;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
}

export type DeferredLocalAssistancePreparationLoader = () => Promise<
	DeferredLocalAssistancePreparationModule
>;

const DEFAULT_LOADER: DeferredLocalAssistancePreparationLoader = () => (
	import('./local-assistance-runtime.ts')
);

/** Load selected-media custody and result acceptance only when its menu dialog opens. */
export function createDeferredLocalAssistancePreparation(
	dependencies: DeferredLocalAssistanceRuntimeDependencies,
	loadModule: DeferredLocalAssistancePreparationLoader = DEFAULT_LOADER,
) {
	let preparationPromise: Promise<LocalAssistancePreparation> | null = null;
	const loadPreparation = () => {
		preparationPromise ??= Promise.resolve()
			.then(loadModule)
			.then((module) => module.createLocalAssistancePreparationRuntime(dependencies));
		return preparationPromise;
	};
	const invoke = async <Name extends keyof LocalAssistancePreparation>(
		name: Name,
		args: MethodParameters<LocalAssistancePreparation[Name]>,
	): Promise<MethodResult<LocalAssistancePreparation[Name]>> => {
		const preparation = await loadPreparation();
		const operation = preparation[name];
		if (typeof operation !== 'function') {
			throw new TypeError(`Local assistance operation is unavailable: ${String(name)}`);
		}
		return await Reflect.apply(operation, preparation, args) as
			MethodResult<LocalAssistancePreparation[Name]>;
	};
	return Object.freeze({
		listSelectedMedia: (...args: MethodParameters<LocalAssistancePreparation['listSelectedMedia']>) => (
			invoke('listSelectedMedia', args)
		),
		prepareSelectedMedia: (
			...args: MethodParameters<LocalAssistancePreparation['prepareSelectedMedia']>
		) => invoke('prepareSelectedMedia', args),
		prepareAdvancedWorkflow: (
			...args: MethodParameters<LocalAssistancePreparation['prepareAdvancedWorkflow']>
		) => invoke('prepareAdvancedWorkflow', args),
		prepareGuidedWorkflow: (
			...args: MethodParameters<LocalAssistancePreparation['prepareGuidedWorkflow']>
		) => invoke('prepareGuidedWorkflow', args),
		acceptGuidedWorkflowResult: (
			...args: MethodParameters<LocalAssistancePreparation['acceptGuidedWorkflowResult']>
		) => invoke('acceptGuidedWorkflowResult', args),
		...(dependencies.assistanceStore ? {
			acceptValidatedResult: (
				...args: MethodParameters<LocalAssistancePreparation['acceptValidatedResult']>
			) => invoke('acceptValidatedResult', args),
			prepareTranscriptCleanup: (
				...args: MethodParameters<LocalAssistancePreparation['prepareTranscriptCleanup']>
			) => invoke('prepareTranscriptCleanup', args),
			acceptTranscriptCleanup: (
				...args: MethodParameters<LocalAssistancePreparation['acceptTranscriptCleanup']>
			) => invoke('acceptTranscriptCleanup', args),
			rejectTranscriptCleanup: (
				...args: MethodParameters<LocalAssistancePreparation['rejectTranscriptCleanup']>
			) => invoke('rejectTranscriptCleanup', args),
			cancelTranscriptCleanup: (
				...args: MethodParameters<LocalAssistancePreparation['cancelTranscriptCleanup']>
			) => invoke('cancelTranscriptCleanup', args),
		} : {}),
	});
}
