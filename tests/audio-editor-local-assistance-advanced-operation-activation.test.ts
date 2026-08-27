/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAssistanceAdvancedWorkflowPreparation } from
	'../src/common/editor/controller/local-assistance-advanced-workflow-preparation.ts';
import { createAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { createAssistanceEditorialGenerationPlanV1 } from
	'../src/common/editor/assistance/editorial-generation-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { ASSISTANCE_OPERATIONS, type AssistanceOperation } from
	'../src/common/editor/assistance/operation.ts';
import {
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';

const JOB_ID = '9a'.repeat(20);
const SOURCE_SHA256 = '7b'.repeat(32);
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;

test('every one of the 15 Advanced primitives stages one closed valid workflow recipe', async () => {
	assert.equal(OPERATION_FIXTURES.size, ASSISTANCE_OPERATIONS.length);
	for (const operation of ASSISTANCE_OPERATIONS) {
		const fixture = OPERATION_FIXTURES.get(operation)!;
		let ordinal = 0;
		const events: string[] = [];
		const project = projectFor(fixture.mediaKind);
		const custody = Object.freeze({
			async stageInput(request: Readonly<Record<string, unknown>>) {
				events.push(`input:${String(request.slotId)}`);
				return handle(request, 'input', ++ordinal, (request.bytes as Blob).size);
			},
			async reserveOutput(request: Readonly<Record<string, unknown>>) {
				events.push(`output:${String(request.slotId)}`);
				return handle(request, 'output', ++ordinal, Number(request.maximumByteLength));
			},
			async bindProducer() { throw new Error('Advanced recipes have no producer stages.'); },
			async release() { return true; },
		});
		const preparation = createLocalAssistanceAdvancedWorkflowPreparation({
			getProject: () => project, captureProject: () => project,
			assertProject: (token) => assert.equal(token, project),
			preflightStorage: async () => undefined,
			selected: { prepareSelectedMedia: async () => preparedFor(operation, fixture) },
		});
		const workflowId = `advanced:${operation}` as const;
		const result = await preparation.prepareAdvancedWorkflow({
			jobId: JOB_ID, workflowId, sourceId: 'source-a', operation,
			shotDetectionMode: operation === 'shot-detection' ? 'fast' : undefined,
			settings: defaultAssistanceWorkflowSettingsV1(workflowId),
			models: fixture.models.map((task, index) => model(task, index + 1)),
			custody, signal: new AbortController().signal,
		});
		assert.equal(result.outcome, 'prepared', operation);
		if (result.outcome !== 'prepared') continue;
		assert.deepEqual(result.workflow.stageIds, [`run-${operation}`], operation);
		assert.deepEqual(result.workflow.inputs.map(({ slotId }) => slotId),
			fixture.inputs, operation);
		assert.deepEqual(result.workflow.outputs.map(({ slotId }) => slotId),
			fixture.outputs, operation);
		assert.deepEqual(events, [
			...fixture.inputs.map((role) => `input:${role}`),
			...fixture.outputs.map((role) => `output:${role}`),
		], operation);
	}
});

test('Advanced UI selection enables every inventoried primitive with its exact installed model roles', async () => {
	const models = ASSISTANCE_OPERATIONS.flatMap((operation) => {
		const fixture = OPERATION_FIXTURES.get(operation)!;
		return fixture.models.map((task, index) => model(task, index + 1));
	}).filter((candidate, index, values) => values.findIndex(({ modelId }) => (
		modelId === candidate.modelId
	)) === index);
	const workflow = Object.freeze({
		custody: Object.freeze({}), readOutput: async () => new Blob(),
		onProgress: () => () => undefined,
	});
	const store = createLocalAssistanceAdvancedWorkflowSessionStore({
		bridge: { models: async () => models, workflow } as never,
		preparation: { listSelectedMedia: async () => ({ sources: [
			{ sourceId: 'audio-source', label: 'Audio', mediaKind: 'audio',
				operations: ASSISTANCE_OPERATIONS.filter((operation) => (
					OPERATION_FIXTURES.get(operation)!.mediaKind === 'audio'
				)) },
			{ sourceId: 'video-source', label: 'Video', mediaKind: 'video',
				operations: ASSISTANCE_OPERATIONS.filter((operation) => (
					OPERATION_FIXTURES.get(operation)!.mediaKind === 'video'
				)) },
		] }), prepareSelectedMedia: async () => null,
		prepareAdvancedWorkflow: async () => null } as never,
	});
	await store.load();
	for (const operation of ASSISTANCE_OPERATIONS) {
		const sourceId = OPERATION_FIXTURES.get(operation)!.mediaKind === 'audio'
			? 'audio-source' : 'video-source';
		store.selectSource(sourceId);
		store.selectOperation(operation);
		assert.equal(store.getSnapshot().phase, 'ready', operation);
		assert.equal(store.getSnapshot().selectedOperation, operation);
	}
	await store.dispose();
});

test('Advanced visual primitives preserve ordered repeatable frame-pack claims for long media', async () => {
	let ordinal = 0;
	const staged: string[] = [];
	const fixture = OPERATION_FIXTURES.get('image-text-embedding')!;
	const prepared = preparedFor('image-text-embedding', fixture);
	const preparation = createLocalAssistanceAdvancedWorkflowPreparation({
		getProject: () => projectFor('video'), captureProject: () => projectFor('video'),
		assertProject: () => undefined, preflightStorage: async () => undefined,
		selected: { prepareSelectedMedia: async () => ({ ...prepared, inputs: [
			preparedInput('frame-pack', 'image-text-embedding', 0),
			preparedInput('frame-pack', 'image-text-embedding', 1),
		] }) },
	});
	const custody = Object.freeze({
		async stageInput(request: Readonly<Record<string, unknown>>) {
			staged.push(String(request.slotId));
			return handle(request, 'input', ++ordinal, (request.bytes as Blob).size);
		},
		async reserveOutput(request: Readonly<Record<string, unknown>>) {
			return handle(request, 'output', ++ordinal, Number(request.maximumByteLength));
		},
		async bindProducer() { throw new Error('not reached'); }, async release() { return true; },
	});
	const workflowId = 'advanced:image-text-embedding';
	const result = await preparation.prepareAdvancedWorkflow({ jobId: JOB_ID, workflowId,
		sourceId: 'source-a', operation: 'image-text-embedding',
		settings: defaultAssistanceWorkflowSettingsV1(workflowId),
		models: [model('image-text-embedding', 1)], custody,
		signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.inputs.map(({ slotId }) => slotId),
		['frame-pack', 'frame-pack']);
	assert.deepEqual(staged, ['frame-pack', 'frame-pack']);
});

type Fixture = Readonly<{
	mediaKind: 'audio' | 'video';
	inputs: readonly string[];
	outputs: readonly string[];
	models: readonly string[];
}>;

const OPERATION_FIXTURES = new Map<AssistanceOperation, Fixture>([
	row('voice-activity-detection', 'audio', ['audio'], ['voice-activity']),
	row('speech-recognition', 'audio', ['audio'], ['transcript']),
	row('word-alignment', 'audio', ['audio', 'transcript'], ['word-alignment']),
	row('speaker-diarization', 'audio', ['audio'], ['speaker-turns'],
		['speaker-segmentation', 'speaker-embedding']),
	row('speech-enhancement', 'audio', ['audio'], ['enhanced-audio']),
	row('source-separation', 'audio', ['audio'], ['dialogue', 'music', 'effects']),
	row('audio-tagging', 'audio', ['audio'], ['audio-tags']),
	row('beat-tracking', 'audio', ['audio'], ['beat-grid']),
	row('text-embedding', 'audio', ['transcript'], ['embeddings']),
	row('image-text-embedding', 'video', ['frame-pack'], ['embeddings']),
	row('optical-character-recognition', 'video', ['frame-pack'], ['recognized-text']),
	row('shot-detection', 'video', ['video'], ['shot-boundaries'], []),
	row('subject-detection', 'video', ['frame-pack'], ['subject-tracks'],
		['face-detection', 'object-detection']),
	row('saliency-detection', 'video', ['frame-pack'], ['saliency-map']),
	row('editorial-generation', 'audio', ['editorial-context'], ['editorial-proposal']),
]);

function row(
	operation: AssistanceOperation,
	mediaKind: Fixture['mediaKind'],
	inputs: readonly string[],
	outputs: readonly string[],
	models: readonly string[] = [operation],
): readonly [AssistanceOperation, Fixture] {
	return [operation, Object.freeze({ mediaKind, inputs: Object.freeze(inputs),
		outputs: Object.freeze(outputs), models: Object.freeze(models) })];
}

function preparedFor(operation: AssistanceOperation, fixture: Fixture) {
	const inputs = fixture.inputs.map((role) => preparedInput(role, operation));
	const outputs = fixture.outputs.map((slotId) => preparedOutput(operation, slotId));
	return Object.freeze({ sourceId: 'source-a', operation,
		...(operation === 'shot-detection' ? { shotDetectionMode: 'fast' as const } : {}),
		selectionFence: selectionFence(fixture.mediaKind),
		inputs: Object.freeze(inputs), outputs: Object.freeze(outputs) });
}

function preparedInput(role: string, operation: AssistanceOperation, sourceFrame = 0) {
	if (role === 'audio') {
		const sampleRate = operation === 'source-separation' ? 44_100
			: operation === 'speech-enhancement' ? 48_000 : 16_000;
		const channels = operation === 'source-separation' || operation === 'speech-enhancement'
			? [Float32Array.of(0.1, -0.1), Float32Array.of(-0.1, 0.1)]
			: [Float32Array.of(0.1, -0.1)];
		const wave = encodeWav(channels, { sampleRate, bitDepth: 32, float: true, dither: false });
		return Object.freeze({ role: 'audio', mediaType: 'audio/wav',
			bytes: new Blob([wave.slice().buffer], { type: 'audio/wav' }) });
	}
	if (role === 'transcript') return Object.freeze({ role, mediaType:
		'application/vnd.soundscaper.transcript+json', bytes: transcriptBlob() });
	if (role === 'frame-pack') return Object.freeze({ role, mediaType:
		'application/vnd.soundscaper.frame-pack', bytes: visualFramePack(sourceFrame) });
	if (role === 'video') return Object.freeze({ role, mediaType: 'video/mp4',
		bytes: new Blob(['video'], { type: 'video/mp4' }) });
	if (role === 'editorial-context') return Object.freeze({ role, mediaType:
		'application/vnd.soundscaper.editorial-context+json', bytes: editorialBlob() });
	throw new Error(`Unsupported fixture role ${role}`);
}

function preparedOutput(operation: AssistanceOperation, slotId: string) {
	if (operation === 'source-separation') return Object.freeze({ slotId,
		role: 'separated-audio', mediaType: 'audio/wav', maximumByteLength: 4096 });
	if (operation === 'speech-enhancement') return Object.freeze({ slotId,
		role: 'enhanced-audio', mediaType: 'audio/wav', maximumByteLength: 4096 });
	const mediaType = slotId === 'embeddings'
		? 'application/vnd.soundscaper.embedding-matrix-v1'
		: `application/vnd.soundscaper.${slotId}+json`;
	return Object.freeze({ role: slotId, mediaType, maximumByteLength: MAXIMUM_OUTPUT_BYTES });
}

function visualFramePack(sourceFrame = 0): Blob {
	const chunks = createAssistanceVisualFramePackV2({ sourceWidth: 16, sourceHeight: 9,
		rasterWidth: 2, rasterHeight: 1, timescale: 24,
		frames: [{ sourceFrame, presentationTick: String(sourceFrame), rgba: new Uint8Array(8) }],
	});
	return new Blob(chunks.map((chunk) => chunk.slice().buffer), {
		type: 'application/vnd.soundscaper.frame-pack',
	});
}

function transcriptBlob(): Blob {
	return new Blob([JSON.stringify({ schemaVersion: 1, sourceId: 'source-a', sampleRate: 48_000,
		language: 'en', modelId: 'fixture', segments: [{ startFrame: 0, endFrame: 100,
			text: 'A bounded transcript.', words: [], speaker: null }] })], {
		type: 'application/vnd.soundscaper.transcript+json',
	});
}

function editorialBlob(): Blob {
	const plan = createAssistanceEditorialGenerationPlanV1([{
		candidateId: 'selection:fixture', evidenceMode: 'transcript',
		transcriptExcerpt: 'A bounded transcript.', visualSummary: null,
	}]);
	return new Blob([JSON.stringify(plan)], {
		type: 'application/vnd.soundscaper.editorial-context+json',
	});
}

function projectFor(kind: 'audio' | 'video') {
	return Object.freeze({ id: 'project-advanced-all', schemaVersion: kind === 'audio' ? 30 : 31,
		revision: 4, sampleRate: 48_000, assistanceAssets: Object.freeze([]),
		clips: Object.freeze([{ id: 'clip-a', kind, sourceId: 'source-a',
			sequenceId: 'sequence-main', avLinkId: null, reversed: false, speedRatio: 1,
			stretchToTempo: false, warpMap: null, retimeMap: null }]),
		sources: Object.freeze([{ id: 'source-a', kind, contentSha256: SOURCE_SHA256,
			sampleRate: 48_000 }]),
	});
}

function selectionFence(kind: 'audio' | 'video') {
	return Object.freeze({ projectId: 'project-advanced-all', schemaVersion: kind === 'audio' ? 30 : 31,
		revision: 4,
		sequenceId: 'sequence-main', occurrenceIds: Object.freeze(['clip-a']), sourceId: 'source-a',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 100,
		linkMembershipSha256: '2a'.repeat(32), timingAuthoritySha256: '3b'.repeat(32) });
}

function model(task: string, ordinal: number) {
	const modelId = task === 'face-detection' ? 'yunet-face-detection-2026may'
		: task === 'object-detection' ? 'dfine-nano-coco' : `fixture-${task}`;
	return Object.freeze({ modelId, version: '1.0.0', task,
		artifactSha256s: Object.freeze([ordinal.toString(16).padStart(64, '0')]) });
}

function handle(request: Readonly<Record<string, unknown>>, direction: 'input' | 'output',
	ordinal: number, bytes: number) {
	const custody = createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
		workflowId: request.workflowId as never, direction, jobId: String(request.jobId),
		stageId: String(request.stageId), slotId: String(request.slotId),
		claimId: ordinal.toString(16).padStart(40, '0'),
		...(direction === 'input' ? { byteLength: bytes, sha256: '4c'.repeat(32),
			maximumByteLength: null } : { byteLength: null, sha256: null,
			maximumByteLength: bytes }) });
	return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
}
