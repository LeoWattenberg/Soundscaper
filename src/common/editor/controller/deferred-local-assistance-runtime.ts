/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from './deferred-module-facade.ts';

export type DeferredLocalAssistancePreparationModule = typeof import('./local-assistance-runtime.ts');
type LocalAssistancePreparation = ReturnType<
	DeferredLocalAssistancePreparationModule['createLocalAssistancePreparationRuntime']
>;
type LocalAssistancePorts<Names extends keyof LocalAssistancePreparation> = Pick<
	LocalAssistancePreparation,
	Names
>;

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

const SELECTED_MEDIA_METHOD_NAMES = [
	'listSelectedMedia',
	'prepareSelectedMedia',
	'prepareAdvancedWorkflow',
	'prepareGuidedWorkflow',
	'acceptGuidedWorkflowResult',
] as const satisfies readonly (keyof LocalAssistancePreparation)[];

const ASSISTANCE_STORE_METHOD_NAMES = [
	'acceptValidatedResult',
	'prepareTranscriptCleanup',
	'acceptTranscriptCleanup',
	'rejectTranscriptCleanup',
	'cancelTranscriptCleanup',
] as const satisfies readonly (keyof LocalAssistancePreparation)[];

/**
 * Load selected-media custody and result acceptance only when its menu dialog opens.
 *
 * The runtime exposes more than this facade proxies - the workflow fence, and
 * the selected-context helpers the preparation composes - so each half declares
 * the ports it stands for and the completeness check holds against those. The
 * acceptance half is present only when the project carries an assistance store,
 * which is why it is a second facade over the same memoized load rather than a
 * longer tuple.
 */
export function createDeferredLocalAssistancePreparation(
	dependencies: DeferredLocalAssistanceRuntimeDependencies,
	loadModule: DeferredLocalAssistancePreparationLoader = DEFAULT_LOADER,
) {
	let preparationPromise: Promise<LocalAssistancePreparation> | null = null;
	const loadPreparation = (): Promise<LocalAssistancePreparation> => {
		preparationPromise ??= Promise.resolve()
			.then(loadModule)
			.then((module) => module.createLocalAssistancePreparationRuntime(dependencies))
			.catch((error: unknown) => {
				preparationPromise = null;
				throw error;
			});
		return preparationPromise;
	};
	const selectedMedia = createDeferredModuleFacade<
		LocalAssistancePorts<typeof SELECTED_MEDIA_METHOD_NAMES[number]>,
		typeof SELECTED_MEDIA_METHOD_NAMES
	>(loadPreparation, SELECTED_MEDIA_METHOD_NAMES);
	const acceptance = createDeferredModuleFacade<
		LocalAssistancePorts<typeof ASSISTANCE_STORE_METHOD_NAMES[number]>,
		typeof ASSISTANCE_STORE_METHOD_NAMES
	>(loadPreparation, ASSISTANCE_STORE_METHOD_NAMES);
	return Object.freeze({
		...selectedMedia,
		...(dependencies.assistanceStore ? acceptance : {}),
	});
}
