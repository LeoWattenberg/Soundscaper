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
	createLocalAssistanceReactionReviewSession,
	type LocalAssistanceReactionReviewSession,
} from './local-assistance-reaction-acceptance.ts';
import type { AssistanceReactionProposalOptions } from '../assistance/reaction-proposals.ts';
import {
	createLocalAssistanceBeatReviewSession,
	type LocalAssistanceBeatAuthority,
	type LocalAssistanceBeatReviewSession,
} from './local-assistance-beat-acceptance.ts';
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
import {
	createLocalAssistanceAudioPublicationAcceptance,
	type LocalAssistanceAudioPublicationAuthority,
	type LocalAssistanceAudioPublicationStore,
} from './local-assistance-audio-publication.ts';

export type LocalAssistanceResultAcceptanceStore = LocalAssistanceTranscriptAcceptanceStore
	& LocalAssistanceAudioPublicationStore;

export interface LocalAssistanceResultAcceptanceDependencies {
	readonly currentAuthority: () => LocalAssistanceRangeLabelAuthority;
	readonly currentVideoAuthority?: () => LocalAssistanceSelectedVideoAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly store?: LocalAssistanceTranscriptAcceptanceStore;
	readonly audioStore?: LocalAssistanceAudioPublicationStore;
	readonly createId?: (prefix: string) => string;
	readonly preflightStorage?: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly commit: (command: Readonly<Record<string, unknown>>) => void;
}

export function createLocalAssistanceResultAcceptance(
	dependencies: LocalAssistanceResultAcceptanceDependencies,
): Readonly<LocalAssistanceTranscriptCleanupWorkflow & {
	acceptValidatedResult(request: unknown): Promise<void>;
	createReactionReviewSession(
		request: unknown,
		options?: AssistanceReactionProposalOptions,
	): LocalAssistanceReactionReviewSession;
	createBeatReviewSession(request: unknown): LocalAssistanceBeatReviewSession;
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
	const audio = dependencies.audioStore && dependencies.createId && dependencies.preflightStorage
		? createLocalAssistanceAudioPublicationAcceptance({
			currentAuthority: dependencies.currentAuthority as unknown as
				() => LocalAssistanceAudioPublicationAuthority,
			captureProject: dependencies.captureProject,
			assertProject: dependencies.assertProject,
			createId: dependencies.createId,
			preflightStorage: dependencies.preflightStorage,
			store: dependencies.audioStore,
			commit: dependencies.commit,
		})
		: null;
	return Object.freeze({
		...cleanup,
		createReactionReviewSession(
			request: unknown,
			options: AssistanceReactionProposalOptions = {},
		): LocalAssistanceReactionReviewSession {
			return createLocalAssistanceReactionReviewSession(dependencies, request, options);
		},
		createBeatReviewSession(request: unknown): LocalAssistanceBeatReviewSession {
			return createLocalAssistanceBeatReviewSession({
				currentAuthority: dependencies.currentAuthority as () => LocalAssistanceBeatAuthority,
				captureProject: dependencies.captureProject,
				assertProject: dependencies.assertProject,
				commit: dependencies.commit,
			}, request);
		},
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
			if (operation === 'speech-enhancement' || operation === 'source-separation') {
				if (!audio) throw new Error('Audio assistance acceptance requires derived-source storage.');
				return audio.acceptValidatedResult(request);
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
