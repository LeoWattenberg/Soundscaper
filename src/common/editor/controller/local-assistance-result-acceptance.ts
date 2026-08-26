/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned dispatch for semantically reviewed assistance results. */

import {
	createLocalAssistanceTranscriptCleanupWorkflow,
	type LocalAssistanceTranscriptCleanupWorkflow,
} from './local-assistance-cleanup-workflow.ts';
import type {
	LocalAssistanceTranscriptCleanupAuthority,
} from './local-assistance-cleanup-acceptance.ts';
import {
	createLocalAssistanceRangeLabelAcceptance,
	type LocalAssistanceRangeLabelAuthority,
} from './local-assistance-range-label-acceptance.ts';
import {
	createLocalAssistanceShotAcceptance,
} from './local-assistance-shot-acceptance.ts';
import type {
	LocalAssistanceSelectedVideoAuthority,
} from './local-assistance-selected-video.ts';
import {
	createLocalAssistanceTranscriptAcceptance,
	type LocalAssistanceTranscriptAcceptanceStore,
} from './local-assistance-transcript-acceptance.ts';

export type LocalAssistanceResultAcceptanceStore = LocalAssistanceTranscriptAcceptanceStore;

export interface LocalAssistanceResultAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceRangeLabelAuthority;
	readonly currentVideoAuthority?: () => LocalAssistanceSelectedVideoAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store?: LocalAssistanceTranscriptAcceptanceStore;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
}

export function createLocalAssistanceResultAcceptance(
	dependencies: LocalAssistanceResultAcceptanceDependencies,
): Readonly<LocalAssistanceTranscriptCleanupWorkflow & {
	acceptValidatedResult(request: unknown): Promise<void>;
}> {
	const rangeLabels = createLocalAssistanceRangeLabelAcceptance(dependencies);
	const shots = dependencies.currentVideoAuthority
		? createLocalAssistanceShotAcceptance({
			currentAuthority: dependencies.currentVideoAuthority,
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			commit: dependencies.commit,
		})
		: null;
	const cleanup = createLocalAssistanceTranscriptCleanupWorkflow({
		currentAuthority: dependencies.currentAuthority as () => LocalAssistanceTranscriptCleanupAuthority,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		commit: (command) => dependencies.commit(
			command as unknown as Readonly<Record<string, unknown>>,
		),
	});
	const transcript = dependencies.store
		? createLocalAssistanceTranscriptAcceptance({
			currentAuthority: dependencies.currentAuthority,
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			store: dependencies.store,
			commit: dependencies.commit,
		})
		: null;
	return Object.freeze({
		...cleanup,
		acceptValidatedResult(request: unknown): Promise<void> {
			const operation = resultOperation(request);
			if (operation === 'speech-recognition') {
				if (!transcript) {
					throw new Error('Transcript acceptance requires assistance-asset storage.');
				}
				return transcript.acceptValidatedResult(request);
			}
			if (operation === 'voice-activity-detection' || operation === 'speaker-diarization') {
				return rangeLabels.acceptValidatedResult(request);
			}
			if (operation === 'shot-detection') {
				if (!shots) throw new Error('Shot acceptance requires selected-video authority.');
				return shots.acceptValidatedResult(request);
			}
			throw new RangeError('This reviewed assistance result has no project acceptance adapter.');
		},
	});
}

function resultOperation(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Assistance result acceptance requires a request record.');
	}
	return (value as Readonly<Record<string, unknown>>).operation;
}
