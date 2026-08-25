/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_OPERATION_CONTRACT_VERSION,
	AssistanceOperationProgressTracker,
	validateAssistanceOperationProgress,
	validateAssistanceOperationRequest,
	validateAssistanceOperationResult,
} from '../desktop/assistance-operation-contract.ts';
import { ASSISTANCE_DATA_CLAIM_VERSION } from '../desktop/assistance-data-claims.ts';
import { HELPER_DATA_PLANE_MAXIMUM_BYTES } from '../desktop/helper-data-plane.ts';
import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';

const JOB_ID = 'ab'.repeat(20);
const INPUT_ID = 'cd'.repeat(20);
const OUTPUT_ID = 'ef'.repeat(20);
const SHA256 = '12'.repeat(32);

const SELECTION_FENCE = Object.freeze({
	projectId: 'project-1',
	schemaVersion: 30,
	revision: 7,
	sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']),
	sourceId: 'source-1',
	sourceSha256: '34'.repeat(32),
	sourceStartFrame: 0,
	sourceEndFrame: 48_000,
	linkMembershipSha256: '56'.repeat(32),
	timingAuthoritySha256: '78'.repeat(32),
});

const MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v2',
	version: '2.0.0',
	artifactSha256s: Object.freeze(['90'.repeat(32)]),
});

function input(role: string) {
	const mediaTypes: Readonly<Record<string, string>> = {
		audio: 'audio/wav',
		video: 'video/mp4',
		'frame-pack': 'application/vnd.soundscaper.frame-pack',
		transcript: 'application/json',
		text: 'text/plain',
		'editorial-context': 'application/json',
	};
	return {
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: INPUT_ID,
		jobId: JOB_ID,
		role,
		mediaType: mediaTypes[role] ?? 'application/json',
		byteLength: 1_024,
		sha256: SHA256,
	};
}

function output(role: string) {
	return {
		claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
		claimId: OUTPUT_ID,
		jobId: JOB_ID,
		role,
		mediaType: ['enhanced-audio', 'separated-audio'].includes(role)
			? 'audio/wav'
			: 'application/json',
		maximumByteLength: 16 * 1024 * 1024,
	};
}

function request(overrides: Record<string, unknown> = {}) {
	return {
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId: JOB_ID,
		operation: 'speech-recognition',
		selectionFence: SELECTION_FENCE,
		models: [MODEL],
		inputs: [input('audio')],
		outputs: [output('transcript')],
		...overrides,
	};
}

test('the operation contract closes the complete planned local-assistance vocabulary', () => {
	assert.deepEqual(ASSISTANCE_OPERATIONS, [
		'voice-activity-detection',
		'speech-recognition',
		'word-alignment',
		'speaker-diarization',
		'speech-enhancement',
		'source-separation',
		'audio-tagging',
		'beat-tracking',
		'text-embedding',
		'image-text-embedding',
		'optical-character-recognition',
		'shot-detection',
		'subject-detection',
		'saliency-detection',
		'editorial-generation',
	]);
	assert.deepEqual(validateAssistanceOperationRequest(request()), request());
});

test('operation requests admit only pathless claims and operation-owned roles', () => {
	assert.throws(
		() => validateAssistanceOperationRequest(request({ mediaPaths: ['/private/source.wav'] })),
		/exactly|schema keys/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ operation: 'run-arbitrary-model' })),
		/operation/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ inputs: [input('video')] })),
		/input role/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ outputs: [output('embeddings')] })),
		/output role/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ models: [MODEL, MODEL] })),
		/model binding/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ selectionFence: {
			...SELECTION_FENCE, revision: 7, path: '/private/project.scape',
		} })),
		/fence fields/iu,
	);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ models: [{
			...MODEL, artifactSha256s: [],
		}] })),
		/artifact digest/iu,
	);
});

test('only deterministic shot detection may run without a local model', () => {
	assert.equal(validateAssistanceOperationRequest(request({
		operation: 'shot-detection',
		models: [],
		inputs: [{ ...input('video'), mediaType: 'video/mp4' }],
		outputs: [output('shot-boundaries')],
	})).models.length, 0);
	assert.throws(
		() => validateAssistanceOperationRequest(request({ models: [] })),
		/requires at least one exact model binding/iu,
	);
});

test('aggregate staged and reserved bytes cannot multiply past the data-plane bound', () => {
	const oversizedInputs = [
		{ ...input('audio'), byteLength: HELPER_DATA_PLANE_MAXIMUM_BYTES / 2 + 1 },
		{
			...input('audio'), claimId: '11'.repeat(20),
			byteLength: HELPER_DATA_PLANE_MAXIMUM_BYTES / 2 + 1,
		},
	];
	assert.throws(
		() => validateAssistanceOperationRequest(request({ inputs: oversizedInputs })),
		/aggregate data-plane byte bound/iu,
	);
	const oversizedOutputs = [
		{ ...output('transcript'), maximumByteLength: HELPER_DATA_PLANE_MAXIMUM_BYTES / 2 + 1 },
		{
			...output('transcript'), claimId: '22'.repeat(20),
			maximumByteLength: HELPER_DATA_PLANE_MAXIMUM_BYTES / 2 + 1,
		},
	];
	assert.throws(
		() => validateAssistanceOperationRequest(request({ outputs: oversizedOutputs })),
		/aggregate data-plane byte bound/iu,
	);
});

test('each composite operation admits its required staged input roles', () => {
	const aligned = request({
		operation: 'word-alignment',
		inputs: [input('audio'), { ...input('transcript'), claimId: '34'.repeat(20) }],
		outputs: [output('word-alignment')],
	});
	assert.equal(validateAssistanceOperationRequest(aligned).operation, 'word-alignment');
	assert.throws(
		() => validateAssistanceOperationRequest({ ...aligned, inputs: [input('audio')] }),
		/requires.*transcript/iu,
	);
	const embedding = request({
		operation: 'image-text-embedding',
		inputs: [{ ...input('frame-pack'), mediaType: 'application/vnd.soundscaper.frame-pack' }],
		outputs: [output('embeddings')],
	});
	assert.equal(validateAssistanceOperationRequest(embedding).operation, 'image-text-embedding');
});

test('every planned operation has one admitted pathless input/output route', () => {
	const routes = [
		['voice-activity-detection', ['audio'], 'voice-activity'],
		['speech-recognition', ['audio'], 'transcript'],
		['word-alignment', ['audio', 'transcript'], 'word-alignment'],
		['speaker-diarization', ['audio'], 'speaker-turns'],
		['speech-enhancement', ['audio'], 'enhanced-audio'],
		['source-separation', ['audio'], 'separated-audio'],
		['audio-tagging', ['audio'], 'audio-tags'],
		['beat-tracking', ['audio'], 'beat-grid'],
		['text-embedding', ['text'], 'embeddings'],
		['image-text-embedding', ['frame-pack'], 'embeddings'],
		['optical-character-recognition', ['frame-pack'], 'recognized-text'],
		['shot-detection', ['video'], 'shot-boundaries'],
		['subject-detection', ['frame-pack'], 'subject-tracks'],
		['saliency-detection', ['frame-pack'], 'saliency-map'],
		['editorial-generation', ['editorial-context'], 'editorial-proposal'],
	] as const;
	for (const [operation, inputRoles, outputRole] of routes) {
		const inputs = inputRoles.map((role, index) => ({
			...input(role),
			claimId: String(index + 1).padStart(40, '0'),
			mediaType: input(role).mediaType,
		}));
		const outputs = [{ ...output(outputRole), claimId: '99'.repeat(20) }];
		assert.equal(validateAssistanceOperationRequest(request({
			operation, inputs, outputs,
		})).operation, operation);
	}
});

test('results return only authenticated output claims rather than inline bulk payloads', () => {
	const admitted = validateAssistanceOperationRequest(request());
	const result = {
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId: JOB_ID,
		operation: 'speech-recognition',
		outputs: [{
			claimVersion: ASSISTANCE_DATA_CLAIM_VERSION,
			claimId: OUTPUT_ID,
			jobId: JOB_ID,
			role: 'transcript',
			mediaType: 'application/json',
			byteLength: 4_096,
			sha256: SHA256,
		}],
	};
	assert.deepEqual(validateAssistanceOperationResult(result, admitted), result);
	assert.throws(
		() => validateAssistanceOperationResult({ ...result, payload: 'x'.repeat(70_000) }, admitted),
		/exactly|schema keys|control-envelope byte bound/iu,
	);
	assert.throws(
		() => validateAssistanceOperationResult({ ...result, outputs: [] }, admitted),
		/reservation|output/iu,
	);
});

test('progress is correlated, phase-typed, monotonic-unit shaped, and closed', () => {
	const admitted = validateAssistanceOperationRequest(request());
	const progress = {
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId: JOB_ID,
		operation: 'speech-recognition',
		sequence: 3,
		phase: 'running',
		completed: 25,
		total: 100,
	};
	assert.deepEqual(validateAssistanceOperationProgress(progress, admitted), progress);
	assert.throws(
		() => validateAssistanceOperationProgress({ ...progress, phase: 'downloading' }, admitted),
		/phase/iu,
	);
	assert.throws(
		() => validateAssistanceOperationProgress({ ...progress, completed: 101 }, admitted),
		/progress/iu,
	);
	assert.throws(
		() => validateAssistanceOperationProgress({ ...progress, operation: 'audio-tagging' }, admitted),
		/correlate/iu,
	);
});

test('a progress tracker refuses duplicate, regressing, and contradictory updates', () => {
	const tracker = new AssistanceOperationProgressTracker(request());
	const progress = (overrides: Record<string, unknown> = {}) => ({
		contractVersion: ASSISTANCE_OPERATION_CONTRACT_VERSION,
		jobId: JOB_ID,
		operation: 'speech-recognition',
		sequence: 0,
		phase: 'running',
		completed: 1,
		total: 4,
		...overrides,
	});
	assert.equal(tracker.accept(progress()).sequence, 0);
	assert.throws(() => tracker.accept(progress()), /sequence must advance/iu);
	assert.equal(tracker.accept(progress({ sequence: 1, completed: 2 })).sequence, 1);
	assert.throws(
		() => tracker.accept(progress({ sequence: 2, completed: 1 })),
		/units must advance/iu,
	);
	assert.equal(tracker.accept(progress({ sequence: 3, phase: 'finalizing', completed: null, total: null })).phase,
		'finalizing');
	assert.throws(
		() => tracker.accept(progress({ sequence: 4, phase: 'running', completed: 3 })),
		/phases cannot regress/iu,
	);
});
