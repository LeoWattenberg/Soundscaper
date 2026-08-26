/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveLocalAssistanceSelectedMediaAuthority,
} from './local-assistance-selected-media.ts';
import {
	resolveLocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';
import {
	createLocalAssistanceSelectedPreparation,
	type LocalAssistanceSelectedVideoStore,
} from './local-assistance-selected-preparation.ts';
import {
	createLocalAssistanceResultAcceptance,
	type LocalAssistanceResultAcceptanceStore,
} from './local-assistance-result-acceptance.ts';
import type { DeferredLocalAssistanceRuntimeDependencies } from './deferred-local-assistance-runtime.ts';

/** Compose the stateful selected-media and proposal-acceptance ports after invocation. */
export function createLocalAssistancePreparationRuntime(
	dependencies: DeferredLocalAssistanceRuntimeDependencies,
) {
	const selectedMediaDependencies = {
		getProject: dependencies.getProject,
		getSelectedClipId: dependencies.getSelectedClipId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		renderDryTrackRange: dependencies.renderDryTrackRange,
	};
	const assistanceStore = dependencies.assistanceStore as
		LocalAssistanceResultAcceptanceStore | undefined;
	const assistanceVideoStore = dependencies.assistanceVideoStore as
		LocalAssistanceSelectedVideoStore | undefined;
	const resultAcceptance = assistanceStore ? createLocalAssistanceResultAcceptance({
		currentAuthority: () => resolveLocalAssistanceSelectedMediaAuthority(selectedMediaDependencies),
		...(assistanceVideoStore ? {
			currentVideoAuthority: () => resolveLocalAssistanceSelectedVideoAuthority(
				selectedMediaDependencies,
			),
		} : {}),
		captureProject: dependencies.captureProject,
		store: assistanceStore,
		audioStore: assistanceStore,
		createId: dependencies.createId,
		preflightStorage: dependencies.preflightStorage,
		assertProject: dependencies.assertProject,
		commit: dependencies.commit,
	}) : null;
	const selectedPreparation = createLocalAssistanceSelectedPreparation({
		...selectedMediaDependencies,
		...(assistanceVideoStore ? { videoStore: assistanceVideoStore } : {}),
		...(resultAcceptance ? { acceptValidatedResult: resultAcceptance.acceptValidatedResult } : {}),
	});
	return Object.freeze({
		...selectedPreparation,
		...(resultAcceptance ? {
			prepareTranscriptCleanup: resultAcceptance.prepareTranscriptCleanup,
			acceptTranscriptCleanup: resultAcceptance.acceptTranscriptCleanup,
			rejectTranscriptCleanup: resultAcceptance.rejectTranscriptCleanup,
			cancelTranscriptCleanup: resultAcceptance.cancelTranscriptCleanup,
		} : {}),
	});
}
