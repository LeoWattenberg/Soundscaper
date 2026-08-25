/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller-owned dispatch for semantically reviewed assistance results. */

import {
	createLocalAssistanceRangeLabelAcceptance,
	type LocalAssistanceRangeLabelAuthority,
} from './local-assistance-range-label-acceptance.ts';
import {
	createLocalAssistanceTranscriptAcceptance,
	type LocalAssistanceTranscriptAcceptanceStore,
} from './local-assistance-transcript-acceptance.ts';

export type LocalAssistanceResultAcceptanceStore = LocalAssistanceTranscriptAcceptanceStore;

export interface LocalAssistanceResultAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceRangeLabelAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store?: LocalAssistanceTranscriptAcceptanceStore;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
}

export function createLocalAssistanceResultAcceptance(
	dependencies: LocalAssistanceResultAcceptanceDependencies,
): Readonly<{ acceptValidatedResult(request: unknown): Promise<void> }> {
	const rangeLabels = createLocalAssistanceRangeLabelAcceptance(dependencies);
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
