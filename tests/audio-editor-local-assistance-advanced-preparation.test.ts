/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalAssistanceAdvancedWorkflowPreparation } from
	'../src/common/editor/controller/local-assistance-advanced-workflow-preparation.ts';
import { LocalAssistanceAdvancedContextUnavailableError } from
	'../src/common/editor/controller/local-assistance-advanced-selected-context.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	createAssistanceWorkflowCustodyClaimV1,
	workflowClaimFromCustodyV1,
} from '../src/common/editor/assistance/workflow-custody-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = 'ab'.repeat(20);
const SOURCE_SHA256 = '1a'.repeat(32);
const FENCE = Object.freeze({
	projectId: 'project-advanced', schemaVersion: 30, revision: 7, sequenceId: 'sequence-main',
	occurrenceIds: Object.freeze(['clip-a']), sourceId: 'source-a', sourceSha256: SOURCE_SHA256,
	sourceStartFrame: 0, sourceEndFrame: 96_000,
	linkMembershipSha256: '2b'.repeat(32), timingAuthoritySha256: '3c'.repeat(32),
});

test('Advanced enhancement becomes one strict aggregate workflow and never enters operation-v1 in renderer', async () => {
	const fixture = preparationFixture('speech-enhancement');
	const result = await fixture.preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:speech-enhancement', sourceId: 'source-a',
		operation: 'speech-enhancement',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:speech-enhancement'),
		models: [model('deepfilternet3', 'speech-enhancement', 1)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds, ['run-speech-enhancement']);
	assert.deepEqual(result.workflow.models, [{ bindingVersion: 1,
		stageId: 'run-speech-enhancement', slotId: 'model', modelId: 'deepfilternet3',
		version: '1.0.0', artifactSha256s: ['1'.padStart(64, '0')] }]);
	assert.deepEqual(result.workflow.inputs.map(({ slotId }) => slotId), ['audio']);
	assert.deepEqual(result.workflow.outputs.map(({ slotId }) => slotId), ['enhanced-audio']);
	assert.equal(result.workflow.fence.settingsSha256.length, 64);
	assert.equal(result.workflow.fence.recipeSha256.length, 64);
	assert.equal(result.workflow.fence.modelBindingsSha256.length, 64);
	assert.deepEqual(fixture.preflights, [68]);
	assert.deepEqual(fixture.events, ['input:audio', 'output:enhanced-audio']);
});

test('Advanced separation binds all three operation outputs in canonical review order', async () => {
	const fixture = preparationFixture('source-separation');
	const result = await fixture.preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:source-separation', sourceId: 'source-a',
		operation: 'source-separation',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:source-separation'),
		models: [model('tiger-dnr', 'source-separation', 2)], custody: fixture.custody,
		signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.outputs.map(({ slotId }) => slotId),
		['dialogue', 'music', 'effects']);
	assert.deepEqual(fixture.events, [
		'input:audio', 'output:dialogue', 'output:music', 'output:effects',
	]);
	assert.deepEqual(fixture.preflights, [3 * 68]);
});

test('Advanced diarization preserves two independently selected model roles', async () => {
	const fixture = preparationFixture('speaker-diarization');
	const result = await fixture.preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:speaker-diarization', sourceId: 'source-a',
		operation: 'speaker-diarization',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:speaker-diarization'),
		models: [model('segmentation', 'speaker-segmentation', 3),
			model('embedding', 'speaker-embedding', 4)], custody: fixture.custody,
		signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.models.map(({ slotId, modelId }) => ({ slotId, modelId })), [
		{ slotId: 'diarizer', modelId: 'segmentation' },
		{ slotId: 'speaker-embedding', modelId: 'embedding' },
	]);
});

test('Advanced preparation rejects cross-operation recipes and refuses incomplete model roles before staging', async () => {
	const fixture = preparationFixture('speaker-diarization');
	await assert.rejects(fixture.preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:audio-tagging', sourceId: 'source-a',
		operation: 'speaker-diarization',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:audio-tagging'),
		models: [model('segmentation', 'speaker-segmentation', 3)], custody: fixture.custody,
		signal: new AbortController().signal,
	}), /identity/iu);
	assert.deepEqual(await fixture.preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:speaker-diarization', sourceId: 'source-a',
		operation: 'speaker-diarization',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:speaker-diarization'),
		models: [model('segmentation', 'speaker-segmentation', 3)], custody: fixture.custody,
		signal: new AbortController().signal,
	}), { outcome: 'unavailable', reason: 'model-binding-unavailable' });
	assert.deepEqual(fixture.events, []);
});

test('Advanced preparation reports disappearing transcript context as typed unavailability', async () => {
	const fixture = preparationFixture('speech-enhancement');
	const token = Object.freeze({ revision: 7 });
	const preparation = createLocalAssistanceAdvancedWorkflowPreparation({
		getProject: () => ({ id: 'unused' }), captureProject: () => token,
		assertProject: (value) => assert.equal(value, token),
		preflightStorage: async () => undefined,
		selected: { prepareSelectedMedia: async () => {
			throw new LocalAssistanceAdvancedContextUnavailableError();
		} },
	});
	assert.deepEqual(await preparation.prepareAdvancedWorkflow({
		jobId: JOB_ID, workflowId: 'advanced:text-embedding', sourceId: 'source-a',
		operation: 'text-embedding',
		settings: defaultAssistanceWorkflowSettingsV1('advanced:text-embedding'),
		models: [model('nomic-embed-text-v1.5', 'text-embedding', 8)],
		custody: fixture.custody, signal: new AbortController().signal,
	}), { outcome: 'unavailable', reason: 'source-custody-unavailable' });
	assert.equal(fixture.releases, 1);
});

function preparationFixture(operation: 'speech-enhancement' | 'source-separation' | 'speaker-diarization') {
	let ordinal = 0;
	let releases = 0;
	const events: string[] = [];
	const preflights: number[] = [];
	const sampleRate = operation === 'source-separation' ? 44_100 : 48_000;
	const waveBytes = encodeWav([new Float32Array([0.1, 0.2, 0.3])], {
		sampleRate, bitDepth: 32, float: true, dither: false,
	});
	const wave = new Blob([waveBytes.slice().buffer as ArrayBuffer], { type: 'audio/wav' });
	const outputs = operation === 'source-separation'
		? ['dialogue', 'music', 'effects'].map((slotId) => ({ slotId,
			role: 'separated-audio', mediaType: 'audio/wav', maximumByteLength: 68 }))
		: [{ ...(operation === 'speech-enhancement' ? { slotId: 'enhanced-audio' } : {}),
			role: operation === 'speech-enhancement' ? 'enhanced-audio' : 'speaker-turns',
			mediaType: operation === 'speech-enhancement' ? 'audio/wav' : 'application/json',
			maximumByteLength: 68 }];
	const project = Object.freeze({ id: 'project-advanced', schemaVersion: 30, revision: 7,
		clips: Object.freeze([{ id: 'clip-a', kind: 'audio', sourceId: 'source-a',
			sequenceId: 'sequence-main', avLinkId: null, reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, warpMap: null }]),
		sources: Object.freeze([{ id: 'source-a', kind: 'audio', contentSha256: SOURCE_SHA256,
			sampleRate: 48_000 }]), assistanceAssets: Object.freeze([]) });
	const custody = Object.freeze({
		async stageInput(request: Readonly<Record<string, unknown>>) {
			events.push(`input:${String(request.slotId)}`);
			return handle(request, 'input', ++ordinal, wave.size);
		},
		async reserveOutput(request: Readonly<Record<string, unknown>>) {
			events.push(`output:${String(request.slotId)}`);
			return handle(request, 'output', ++ordinal, Number(request.maximumByteLength));
		},
		async bindProducer() { throw new Error('Advanced recipes have no producer stages.'); },
		async release() { releases += 1; return true; },
	});
	const preparation = createLocalAssistanceAdvancedWorkflowPreparation({
		getProject: () => project, captureProject: () => project,
		assertProject: (token) => assert.equal(token, project),
		preflightStorage: async (bytes) => { preflights.push(bytes); },
		selected: { prepareSelectedMedia: async () => ({ sourceId: 'source-a', operation,
			selectionFence: FENCE, inputs: [{ role: 'audio', mediaType: 'audio/wav', bytes: wave }],
			outputs }) },
	});
	return { preparation, custody, events, preflights, get releases() { return releases; } };
}

function handle(
	request: Readonly<Record<string, unknown>>,
	direction: 'input' | 'output',
	ordinal: number,
	bytes: number,
) {
	const custody = createAssistanceWorkflowCustodyClaimV1({ custodyVersion: 1,
		workflowId: request.workflowId as `advanced:${string}` as never, direction,
		jobId: String(request.jobId), stageId: String(request.stageId), slotId: String(request.slotId),
		claimId: ordinal.toString(16).padStart(40, '0'),
		...(direction === 'input' ? { byteLength: bytes, sha256: '4d'.repeat(32),
			maximumByteLength: null } : { byteLength: null, sha256: null,
			maximumByteLength: bytes }),
	});
	return Object.freeze({ custody, workflowClaim: workflowClaimFromCustodyV1(custody) });
}

function model(modelId: string, task: string, ordinal: number) {
	return Object.freeze({ modelId, version: '1.0.0', task,
		artifactSha256s: Object.freeze([ordinal.toString(16).padStart(64, '0')]) });
}
