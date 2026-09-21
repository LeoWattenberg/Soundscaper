/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	validateAssistanceOperationRequest,
} from '../desktop/assistance-operation-contract.ts';
import {
	LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT,
	LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES,
	type LocalAssistanceInputRole,
	type LocalAssistanceOutputRole,
} from '../src/common/editor/assistance/local-assistance-media-contract.ts';
import {
	resolveLocalAssistanceBridge,
	type LocalAssistanceBridge,
} from '../src/common/editor/assistance/local-assistance-bridge.ts';
import {
	ASSISTANCE_OPERATIONS,
	type AssistanceOperation,
} from '../src/common/editor/assistance/operation.ts';
import {
	normalizeLocalAssistancePreparedMedia,
} from '../src/common/editor/controller/assistance/local-assistance-prepared-media.ts';

interface ExpectedOperationMediaContract {
	readonly operation: AssistanceOperation;
	readonly inputs: readonly LocalAssistanceInputRole[];
	readonly required: readonly (readonly LocalAssistanceInputRole[])[];
	readonly outputs: readonly LocalAssistanceOutputRole[];
	readonly desktopRoutes: readonly (readonly LocalAssistanceInputRole[])[];
	readonly preparedRoutes: readonly (readonly LocalAssistanceInputRole[])[];
	readonly bridgeRoutes: readonly (readonly LocalAssistanceInputRole[])[];
}

const EXPECTED = Object.freeze([
	row('voice-activity-detection', ['audio'], [['audio']], ['voice-activity']),
	row('speech-recognition', ['audio', 'voice-activity'], [['audio']], ['transcript'], [
		['audio'], ['audio', 'voice-activity'],
	], [['audio']], [['audio']]),
	row('word-alignment', ['audio', 'transcript'], [['audio'], ['transcript']], ['word-alignment']),
	row('speaker-diarization', ['audio'], [['audio']], ['speaker-turns']),
	row('speech-enhancement', ['audio'], [['audio']], ['enhanced-audio']),
	row('dereverberation', ['audio'], [['audio']], ['enhanced-audio']),
	row('source-separation', ['audio'], [['audio']], ['separated-audio']),
	row('audio-tagging', ['audio'], [['audio']], ['audio-tags']),
	row('beat-tracking', ['audio'], [['audio']], ['beat-grid']),
	row('text-embedding', ['transcript', 'text'], [['transcript', 'text']], ['embeddings'], [
		['transcript'], ['text'],
	]),
	row('image-text-embedding', ['frame-pack', 'text'], [['frame-pack', 'text']], ['embeddings'], [
		['frame-pack'], ['text'],
	]),
	row('optical-character-recognition', ['frame-pack'], [['frame-pack']], ['recognized-text']),
	row('shot-detection', ['video', 'frame-pack'], [['video', 'frame-pack']], ['shot-boundaries'], [
		['video'], ['frame-pack'],
	], [['video'], ['frame-pack']], [['video']]),
	row('subject-detection', ['frame-pack'], [['frame-pack']], ['subject-tracks']),
	row('saliency-detection', ['frame-pack'], [['frame-pack']], ['saliency-map']),
	row('editorial-generation', ['editorial-context'], [['editorial-context']], ['editorial-proposal']),
] satisfies readonly ExpectedOperationMediaContract[]);

const JOB_ID = 'a'.repeat(40);
const SELECTION_FENCE = Object.freeze({
	projectId: 'project-1',
	schemaFamily: 'soundscaper' as const,
	schemaVersion: 1,
	revision: 7,
	sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']),
	sourceId: 'source-1',
	sourceSha256: '1'.repeat(64),
	sourceStartFrame: 0,
	sourceEndFrame: 48_000,
	linkMembershipSha256: '2'.repeat(64),
	timingAuthoritySha256: '3'.repeat(64),
});

test('the operation media contract covers every operation with one frozen role matrix', () => {
	assert.deepEqual(EXPECTED.map(({ operation }) => operation), ASSISTANCE_OPERATIONS);
	assert.deepEqual(LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT, Object.fromEntries(EXPECTED.map((entry) => [
		entry.operation,
		{ inputs: entry.inputs, required: entry.required, outputs: entry.outputs },
	])));
	assert.equal(Object.isFrozen(LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT), true);
	for (const operation of ASSISTANCE_OPERATIONS) {
		const contract = LOCAL_ASSISTANCE_OPERATION_MEDIA_CONTRACT[operation];
		assert.equal(Object.isFrozen(contract), true, operation);
		assert.equal(Object.isFrozen(contract.inputs), true, operation);
		assert.equal(Object.isFrozen(contract.required), true, operation);
		assert.ok(contract.required.every(Object.isFrozen), operation);
		assert.equal(Object.isFrozen(contract.outputs), true, operation);
	}
});

test('each operation boundary admits exactly its established routes', async () => {
	const bridge = rendererBridge();
	for (const [operationIndex, entry] of EXPECTED.entries()) {
		for (const route of entry.desktopRoutes) {
			const desktop = validateAssistanceOperationRequest(desktopRequest(entry, route, operationIndex));
			assert.deepEqual(desktop.inputs.map(({ role }) => role), route, `${entry.operation}:desktop`);
			assert.deepEqual(desktop.outputs.map(({ role }) => role), entry.outputs,
				`${entry.operation}:desktop outputs`);
		}
		for (const route of entry.preparedRoutes) {
			const prepared = normalizeLocalAssistancePreparedMedia(preparedMedia(entry, route), {
				sourceId: 'source-1', operation: entry.operation,
			});
			assert.deepEqual(prepared.inputs.map(({ role }) => role), route, `${entry.operation}:prepared`);
			assert.deepEqual([...new Set(prepared.outputs.map(({ role }) => role))], entry.outputs,
				`${entry.operation}:prepared outputs`);
		}
		for (const [routeIndex, route] of entry.bridgeRoutes.entries()) {
			const outcome = await bridge.run(rendererRequest(entry, route, operationIndex, routeIndex));
			assert.equal(outcome.outcome, 'unavailable', `${entry.operation}:renderer`);
		}
	}
});

test('shared role authority preserves the narrower prepared and bridge wire boundaries', async () => {
	const speech = EXPECTED.find(({ operation }) => operation === 'speech-recognition')!;
	const speechWithVad = ['audio', 'voice-activity'] as const;
	assert.doesNotThrow(() => validateAssistanceOperationRequest(desktopRequest(speech, speechWithVad, 1)));
	assert.throws(
		() => normalizeLocalAssistancePreparedMedia(preparedMedia(speech, speechWithVad), {
			sourceId: 'source-1', operation: speech.operation,
		}),
		/operation input role/u,
	);
	await assert.rejects(
		rendererBridge().run(rendererRequest(speech, speechWithVad, 1, 0)),
		/not admitted|operation input role/u,
	);

	const shots = EXPECTED.find(({ operation }) => operation === 'shot-detection')!;
	const framePack = ['frame-pack'] as const;
	assert.doesNotThrow(() => normalizeLocalAssistancePreparedMedia(preparedMedia(shots, framePack), {
		sourceId: 'source-1', operation: shots.operation,
	}));
	await assert.rejects(
		rendererBridge().run(rendererRequest(shots, framePack, 12, 0)),
		/not admitted|operation input role/u,
	);
});

function row(
	operation: AssistanceOperation,
	inputs: readonly LocalAssistanceInputRole[],
	required: readonly (readonly LocalAssistanceInputRole[])[],
	outputs: readonly LocalAssistanceOutputRole[],
	desktopRoutes: readonly (readonly LocalAssistanceInputRole[])[] = [required.flat()],
	preparedRoutes: readonly (readonly LocalAssistanceInputRole[])[] = desktopRoutes,
	bridgeRoutes: readonly (readonly LocalAssistanceInputRole[])[] = preparedRoutes,
): ExpectedOperationMediaContract {
	return Object.freeze({ operation, inputs: Object.freeze(inputs),
		required: Object.freeze(required.map((group) => Object.freeze(group))),
		outputs: Object.freeze(outputs),
		desktopRoutes: Object.freeze(desktopRoutes.map((route) => Object.freeze(route))),
		preparedRoutes: Object.freeze(preparedRoutes.map((route) => Object.freeze(route))),
		bridgeRoutes: Object.freeze(bridgeRoutes.map((route) => Object.freeze(route))) });
}

function desktopRequest(
	entry: ExpectedOperationMediaContract,
	route: readonly LocalAssistanceInputRole[],
	operationIndex: number,
): unknown {
	return {
		contractVersion: 1,
		jobId: JOB_ID,
		operation: entry.operation,
		selectionFence: SELECTION_FENCE,
		models: [model(operationIndex)],
		inputs: route.map((role, index) => ({
			claimVersion: 1,
			claimId: opaqueId(1 + index),
			jobId: JOB_ID,
			role,
			mediaType: LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES[role][0],
			byteLength: 1,
			sha256: '4'.repeat(64),
		})),
		outputs: entry.outputs.map((role, index) => ({
			claimVersion: 1,
			claimId: opaqueId(32 + index),
			jobId: JOB_ID,
			role,
			mediaType: LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES[role][0],
			maximumByteLength: 1_024,
		})),
	};
}

function preparedMedia(
	entry: ExpectedOperationMediaContract,
	route: readonly LocalAssistanceInputRole[],
): unknown {
	return {
		sourceId: 'source-1',
		operation: entry.operation,
		selectionFence: SELECTION_FENCE,
		inputs: route.map((role) => {
			const mediaType = LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES[role][0];
			return { role, mediaType, bytes: new Blob(['x'], { type: mediaType }) };
		}),
		outputs: preparedOutputs(entry.operation, entry.outputs[0]!),
	};
}

function preparedOutputs(
	operation: AssistanceOperation,
	role: LocalAssistanceOutputRole,
): readonly unknown[] {
	const output = (slotId?: string) => ({
		...(slotId === undefined ? {} : { slotId }),
		role,
		mediaType: LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES[role][0],
		maximumByteLength: 1_024,
	});
	if (operation === 'speech-enhancement') return [output('enhanced-audio')];
	if (operation === 'dereverberation') return [output('dereverberated-audio')];
	if (operation === 'source-separation') return [
		output('dialogue'), output('music'), output('effects'),
	];
	return [output()];
}

function rendererRequest(
	entry: ExpectedOperationMediaContract,
	route: readonly LocalAssistanceInputRole[],
	operationIndex: number,
	routeIndex: number,
): Parameters<LocalAssistanceBridge['run']>[0] {
	return {
		contractVersion: 1,
		jobId: JOB_ID,
		operation: entry.operation,
		selectionFence: SELECTION_FENCE,
		models: [model(operationIndex)],
		inputs: route.map((role, index) => ({
			claimVersion: 1,
			claimId: opaqueId(64 + routeIndex * 8 + index),
			jobId: JOB_ID,
			role,
			mediaType: LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES[role][0]!,
			byteLength: 1,
			sha256: '5'.repeat(64),
		})),
		outputs: entry.outputs.map((role, index) => ({
			claimVersion: 1,
			claimId: opaqueId(128 + routeIndex * 8 + index),
			jobId: JOB_ID,
			role,
			mediaType: LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES[role][0]!,
			maximumByteLength: 1_024,
		})),
	};
}

function rendererBridge(): LocalAssistanceBridge {
	const bridge = resolveLocalAssistanceBridge({ localAssistance: {
		models: async () => [],
		createJob: async () => ({ contractVersion: 1, jobId: JOB_ID }),
		stageInput: async () => null,
		reserveOutput: async () => null,
		run: async (value: unknown) => {
			const request = value as Readonly<{ jobId: string; operation: AssistanceOperation }>;
			return { contractVersion: 1, jobId: request.jobId, operation: request.operation,
				outcome: 'unavailable', reason: 'adapter-unavailable' };
		},
		cancel: async () => ({ contractVersion: 1, jobId: JOB_ID, outcome: 'not-active' }),
		readOutput: async () => new Blob(),
		release: async () => true,
		onProgress: () => () => undefined,
	} });
	assert.ok(bridge);
	return bridge;
}

function model(index: number) {
	return Object.freeze({ modelId: `model-${String(index + 1)}`, version: '1.0.0',
		artifactSha256s: Object.freeze(['6'.repeat(64)]) });
}

function opaqueId(value: number): string {
	return value.toString(16).padStart(40, '0');
}
