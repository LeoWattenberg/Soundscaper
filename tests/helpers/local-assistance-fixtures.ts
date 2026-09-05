/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared fixtures for the local-assistance session, bridge, and dialog tests. */

import assert from 'node:assert/strict';

import {
	createLocalAssistanceSessionStore,
} from '../../src/common/editor/ui/local-assistance-session-store.ts';
import type { LocalAssistanceBridge } from '../../src/common/editor/assistance/local-assistance-bridge.ts';
import type {
	LocalAssistanceSelectedMediaPreparationPort,
} from '../../src/common/editor/assistance/local-assistance-preparation.ts';

export const JOB_ID = 'a'.repeat(40);
export const INPUT_CLAIM_ID = 'b'.repeat(40);
export const OUTPUT_CLAIM_ID = 'c'.repeat(40);
export const INPUT_SHA256 = '6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b';
export const OUTPUT_SHA256 = '44463f127fa35586d028e070ac4d510ba7d7d2e7411f0f3491b4bcedf240c404';
export const MODEL_SHA256 = 'f'.repeat(64);

export const FENCE = Object.freeze({
	schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
	projectId: 'project-1', revision: 2, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: '1'.repeat(64), sourceStartFrame: 10, sourceEndFrame: 20,
	linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64),
});

export const MODEL = Object.freeze({
	modelId: 'speech-model', version: '1.2.3', task: 'speech-recognition',
	artifactSha256s: Object.freeze([MODEL_SHA256]),
});
export const SEGMENTATION_MODEL = Object.freeze({
	modelId: 'segmentation-model', version: '2.0.0', task: 'speaker-segmentation',
	artifactSha256s: Object.freeze(['d'.repeat(64)]),
});
export const SECOND_SEGMENTATION_MODEL = Object.freeze({
	modelId: 'segmentation-model-alternate', version: '2.1.0', task: 'speaker-segmentation',
	artifactSha256s: Object.freeze(['e'.repeat(64)]),
});
export const EMBEDDING_MODEL = Object.freeze({
	modelId: 'embedding-model', version: '3.0.0', task: 'speaker-embedding',
	artifactSha256s: Object.freeze(['c'.repeat(64)]),
});

export const INVENTORY = Object.freeze({
	sources: Object.freeze([Object.freeze({
		sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio' as const,
		operations: Object.freeze(['speech-recognition' as const]),
	})]),
});

export function prepared(inputBody = new Blob(['audio'], { type: 'audio/wav' })) {
	return Object.freeze({
		sourceId: 'source-1', operation: 'speech-recognition' as const, selectionFence: FENCE,
		inputs: Object.freeze([Object.freeze({ role: 'audio' as const,
			mediaType: 'audio/wav', bytes: inputBody })]),
		outputs: Object.freeze([Object.freeze({ role: 'transcript' as const,
			mediaType: 'application/vnd.soundscaper.transcript+json', maximumByteLength: 4096 })]),
	});
}

export function preparationFixture(
	body?: Blob,
	accept?: (request: unknown) => Promise<void>,
): LocalAssistanceSelectedMediaPreparationPort {
	return Object.freeze({
		listSelectedMedia: async () => INVENTORY,
		prepareSelectedMedia: async () => prepared(body),
		...(accept ? { acceptValidatedResult: accept } : {}),
	});
}

export interface RawLocalAssistanceApi {
	models(): Promise<unknown>;
	createJob(): Promise<unknown>;
	stageInput(request: Readonly<Record<string, unknown>>): Promise<unknown>;
	reserveOutput(request: Readonly<Record<string, unknown>>): Promise<unknown>;
	run(request?: unknown): Promise<unknown>;
	cancel(jobId?: unknown): Promise<unknown>;
	readOutput(request?: unknown): Promise<unknown>;
	release(jobId?: unknown): Promise<unknown>;
	onProgress(listener: (value: unknown) => void): () => void;
}

export const TRANSCRIPT_BODY = JSON.stringify({ language: 'en', segments: [{
	startSeconds: 0, endSeconds: 1.25, text: 'Hello from the interview.', words: [], speaker: null,
}] });

export function rawBridgeFixture(outputBody = new Blob([TRANSCRIPT_BODY], {
	type: 'application/vnd.soundscaper.transcript+json',
}), outputSha256 = OUTPUT_SHA256) {
	const calls: string[] = [];
	let progress: ((value: unknown) => void) | null = null;
	const api: RawLocalAssistanceApi = {
		models: async () => {
			calls.push('models');
			return [MODEL];
		},
		createJob: async () => {
			calls.push('create');
			return { contractVersion: 1, jobId: JOB_ID };
		},
		stageInput: async (request: Readonly<Record<string, unknown>>) => {
			calls.push(`stage:${request.role}`);
			assert.ok(request.bytes instanceof Blob);
			assert.equal(request.sha256, INPUT_SHA256);
			assert.equal('byteLength' in request, false);
			return { claimVersion: 1, claimId: INPUT_CLAIM_ID, jobId: JOB_ID,
				role: 'audio', mediaType: 'audio/wav', byteLength: 5, sha256: INPUT_SHA256 };
		},
		reserveOutput: async (request: Readonly<Record<string, unknown>>) => {
			calls.push(`reserve:${request.role}`);
			return { claimVersion: 1, claimId: OUTPUT_CLAIM_ID, jobId: JOB_ID,
				role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
				maximumByteLength: 4096 };
		},
		run: async () => {
			calls.push('run');
			return { contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
				outcome: 'completed', result: { contractVersion: 1, jobId: JOB_ID,
					operation: 'speech-recognition', outputs: [{ claimVersion: 1,
						claimId: OUTPUT_CLAIM_ID, jobId: JOB_ID, role: 'transcript',
						mediaType: 'application/vnd.soundscaper.transcript+json',
						byteLength: outputBody.size, sha256: outputSha256 }] } };
		},
		cancel: async () => {
			calls.push('cancel');
			return { contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' };
		},
		readOutput: async () => {
			calls.push('read');
			return outputBody;
		},
		release: async () => {
			calls.push('release');
			return true;
		},
		onProgress: (listener: (value: unknown) => void) => {
			progress = listener;
			return () => { progress = null; };
		},
	};
	return { api, calls, emit(value: unknown) { progress?.(value); } };
}

export function diarizationFixture(models = Object.freeze([
	EMBEDDING_MODEL, SECOND_SEGMENTATION_MODEL, SEGMENTATION_MODEL,
])) {
	const requests: Parameters<LocalAssistanceBridge['run']>[0][] = [];
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => models,
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		stageInput: async (request: Parameters<LocalAssistanceBridge['stageInput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: INPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, byteLength: request.byteLength,
			sha256: INPUT_SHA256,
		}),
		reserveOutput: async (request: Parameters<LocalAssistanceBridge['reserveOutput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		}),
		run: async (request: Parameters<LocalAssistanceBridge['run']>[0]) => {
			requests.push(request);
			return Object.freeze({
				contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
				outcome: 'unavailable' as const, reason: 'adapter-unavailable' as const,
			});
		},
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'not-active' as const,
		}),
		readOutput: async () => { throw new Error('An unavailable adapter has no output.'); },
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio' as const,
			operations: Object.freeze(['speaker-diarization' as const]),
		})]) }),
		prepareSelectedMedia: async () => Object.freeze({
			sourceId: 'source-1', operation: 'speaker-diarization' as const,
			selectionFence: FENCE,
			inputs: Object.freeze([Object.freeze({
				role: 'audio' as const, mediaType: 'audio/wav',
				bytes: new Blob(['audio'], { type: 'audio/wav' }),
			})]),
			outputs: Object.freeze([Object.freeze({
				role: 'speaker-turns' as const,
				mediaType: 'application/vnd.soundscaper.speaker-turns+json',
				maximumByteLength: 4096,
			})]),
		}),
	});
	return { bridge, preparation, requests };
}

/** A connected session store driven to one consented speech run. */
export function selectedStore(
	bridge: LocalAssistanceBridge,
	preparation: LocalAssistanceSelectedMediaPreparationPort,
) {
	const store = createLocalAssistanceSessionStore({ bridge, preparation });
	store.connect();
	return {
		...store,
		async run() {
			await store.load();
			store.selectSource('source-1');
			store.selectOperation('speech-recognition');
			store.selectModel('speech-model');
			store.setConsent(true);
			await store.run();
		},
	};
}
