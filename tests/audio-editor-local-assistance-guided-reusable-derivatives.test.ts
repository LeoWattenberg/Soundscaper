/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowSourceRangeV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { assembleOwnedHighlightsV1 } from
	'../src/common/editor/assistance/owned-highlight-workflow-transforms-v1.ts';
import { retainLocalAssistanceGuidedReusableDerivatives } from
	'../src/common/editor/controller/local-assistance-guided-reusable-derivatives.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';

const JOB_ID = '01'.repeat(20);

test('reviewed Mark Cuts acceptance retains a normalized reusable shot table', async () => {
	const workflow = cutWorkflow();
	const repository = derivativeRepository();
	const cuts = { schemaVersion: 1, kind: 'cut-proposals', mode: 'fast',
		detector: 'ffmpeg-scdet', timescale: 24, sourceFrameCount: 240,
		proposals: [{ id: 'cut:120:120', sourceFrame: 120, presentationTick: '120',
			score: 0.9, selected: false }] };
	const records = await retainLocalAssistanceGuidedReusableDerivatives({ workflow,
		review: reviewed(workflow, 'normalize-cuts', 'cut-proposals', cuts),
		readOutput: async () => { throw new Error('Mark Cuts needs no intermediate reread'); },
		repository, resolveCurrentFence: () => workflow.fence });
	assert.deepEqual(records.map(({ kind }) => kind), ['shot-table']);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(records[0]!.bytes)), {
		schemaVersion: 1, kind: 'shot-table', sourceId: 'video-source', result: {
			schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 24, sourceFrameCount: 240,
			boundaries: [{ sourceFrame: 120, presentationTick: '120', score: 0.9 }],
		},
	});
});

test('reusable retention refuses a changed aggregate fence before repository publication', async () => {
	const workflow = cutWorkflow();
	const repository = derivativeRepository();
	let resolutions = 0;
	await assert.rejects(retainLocalAssistanceGuidedReusableDerivatives({ workflow,
		review: reviewed(workflow, 'normalize-cuts', 'cut-proposals', {
			schemaVersion: 1, kind: 'cut-proposals', mode: 'fast', detector: 'ffmpeg-scdet',
			timescale: 24, sourceFrameCount: 240, proposals: [],
		}), readOutput: async () => { throw new Error('unexpected'); }, repository,
		resolveCurrentFence: () => {
			resolutions += 1;
			return resolutions === 1 ? workflow.fence : {
				...workflow.fence, sourceRanges: workflow.fence.sourceRanges.map((range) => ({
					...range, linkMembershipSha256: 'ff'.repeat(32),
				})),
			};
		},
	}), /aggregate-fence|stale/iu);
	assert.equal(resolutions, 2);
	assert.deepEqual(await repository.listProject('project-a'), []);
});

test('accepted Reframe retains only normalized saliency and deterministic tracker state', async () => {
	const workflow = reframeWorkflow();
	const repository = derivativeRepository();
	const terminal = reframeResult();
	const tracked = trackedSubjects();
	const saliency = saliencyMap();
	const records = await retainLocalAssistanceGuidedReusableDerivatives({ workflow,
		review: reviewed(workflow, 'plan-crops', 'reframe-path', terminal),
		readOutput: async ({ claim }) => jsonBlob(claim.slotId === 'tracked-subjects'
			? tracked : saliency, claim.slotId), repository,
		resolveCurrentFence: () => workflow.fence });
	assert.deepEqual(records.map(({ kind }) => kind), ['saliency-map', 'tracker-state']);
	assert.deepEqual(records.map(({ bytes }) => (
		JSON.parse(new TextDecoder().decode(bytes)) as { kind: string }
	).kind), ['saliency-map', 'tracker-state']);

	const corruptRepository = derivativeRepository();
	await assert.rejects(retainLocalAssistanceGuidedReusableDerivatives({ workflow,
		review: reviewed(workflow, 'plan-crops', 'reframe-path', terminal),
		readOutput: async ({ claim }) => jsonBlob(claim.slotId === 'tracked-subjects'
			? { ...tracked, frames: [{ ...tracked.frames[0]!, presentationTick: '1' },
				tracked.frames[1]!] } : saliency, claim.slotId),
		repository: corruptRepository, resolveCurrentFence: () => workflow.fence,
	}), /authority|ordered|frame/iu);
	assert.deepEqual(await corruptRepository.listProject('project-a'), []);
});

test('accepted Highlights retains its reviewed shot table and ranked proposal lineage', async () => {
	const workflow = highlightWorkflow();
	const repository = derivativeRepository();
	const candidate = highlightCandidate();
	const ranking = { schemaVersion: 1, kind: 'highlight-candidates', sourceId: 'video-source',
		sampleRate: 48_000, sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 }, candidates: [candidate] };
	const settings = defaultAssistanceWorkflowSettingsV1('make-highlights');
	if (settings.workflowId !== 'make-highlights') assert.fail('Highlight settings changed identity.');
	const proposals = assembleOwnedHighlightsV1({ 'highlight-candidates': ranking, editorial: null },
		settings);
	const records = await retainLocalAssistanceGuidedReusableDerivatives({ workflow,
		review: reviewed(workflow, 'assemble-highlights', 'highlight-proposals', proposals),
		readOutput: async ({ claim }) => jsonBlob(claim.slotId === 'highlight-candidates'
			? ranking : { schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 24,
				sourceFrameCount: 240, boundaries: [{ sourceFrame: 120,
					presentationTick: '120', score: 0.8 }] }, claim.slotId),
		repository, resolveCurrentFence: () => workflow.fence });
	assert.deepEqual(records.map(({ kind }) => kind), ['shot-table', 'ranking-checkpoint']);
	const body = JSON.parse(new TextDecoder().decode(records[1]!.bytes)) as
		Readonly<{ kind: string; result: { candidates: readonly { id: string }[] } }>;
	assert.equal(body.kind, 'ranking-checkpoint');
	assert.deepEqual(body.result.candidates.map(({ id }) => id), ['highlight-a']);
});

function cutWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['detect-shots', 'normalize-cuts'];
	return workflow('mark-cuts', stageIds, [], [
		claim('input', 'detect-shots', 'video', 1),
		claim('input', 'normalize-cuts', 'shot-boundaries', 2),
	], [
		claim('output', 'detect-shots', 'shot-boundaries', 3),
		claim('output', 'normalize-cuts', 'cut-proposals', 4),
	], [videoRange()]);
}

function reframeWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'];
	const models = [model('detect-subjects', 'face-detector', 'yunet'),
		model('detect-subjects', 'object-detector', 'd-fine'),
		model('detect-saliency', 'saliency-detector', 'u2netp')];
	return workflow('reframe', stageIds, models, [
		claim('input', 'detect-subjects', 'frame-pack', 1),
		claim('input', 'detect-saliency', 'frame-pack', 2),
		claim('input', 'track-subjects', 'subject-tracks', 3),
		claim('input', 'plan-crops', 'tracked-subjects', 4),
		claim('input', 'plan-crops', 'saliency-map', 5),
	], [
		claim('output', 'detect-subjects', 'subject-tracks', 6),
		claim('output', 'detect-saliency', 'saliency-map', 7),
		claim('output', 'track-subjects', 'tracked-subjects', 8),
		claim('output', 'plan-crops', 'reframe-path', 9),
	], [videoRange()]);
}

function highlightWorkflow(): AssistanceWorkflowV1 {
	const stageIds = ['detect-highlight-shots', 'gather-signals',
		'rank-highlights', 'assemble-highlights'];
	return workflow('make-highlights', stageIds, [], [
		claim('input', 'detect-highlight-shots', 'video', 1),
		claim('input', 'gather-signals', 'video', 2),
		claim('input', 'gather-signals', 'shot-boundaries', 3),
		claim('input', 'rank-highlights', 'highlight-signals', 4),
		claim('input', 'assemble-highlights', 'highlight-candidates', 5),
	], [
		claim('output', 'detect-highlight-shots', 'shot-boundaries', 6),
		claim('output', 'gather-signals', 'highlight-signals', 7),
		claim('output', 'rank-highlights', 'highlight-candidates', 8),
		claim('output', 'assemble-highlights', 'highlight-proposals', 9),
	], [videoRange()]);
}

function workflow(
	workflowId: 'mark-cuts' | 'reframe' | 'make-highlights',
	stageIds: readonly string[],
	models: readonly AssistanceWorkflowModelBindingV1[],
	inputs: AssistanceWorkflowV1['inputs'],
	outputs: AssistanceWorkflowV1['outputs'],
	sourceRanges: readonly AssistanceWorkflowSourceRangeV1[],
): AssistanceWorkflowV1 {
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	return { contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1,
		settingsVersion: 1, settings, stageIds, models, inputs, outputs,
		fence: { fenceVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', revision: 8,
			sequenceId: 'sequence-a', sourceRanges, transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models) } };
}

function videoRange(): AssistanceWorkflowSourceRangeV1 {
	return { slotId: 'primary-video', mediaKind: 'video', sourceId: 'video-source',
		sourceSha256: '12'.repeat(32), sourceSampleRate: null,
		occurrenceIds: ['video-occurrence'], sourceStartFrame: 0, sourceEndFrame: 240,
		linkMembershipSha256: '56'.repeat(32), timingAuthoritySha256: '78'.repeat(32),
		retimeKind: 'identity' };
}

function reframeResult() {
	return { schemaVersion: 1, kind: 'reframe-path', authority: frameAuthority(),
		fallbackChain: ['subject', 'saliency', 'center'], path: { schemaVersion: 1,
			targetAspect: { width: 9, height: 16 }, keyframes: [
				cropKeyframe(0), cropKeyframe(239),
			] } };
}

function trackedSubjects() {
	return { schemaVersion: 1, width: 1_920, height: 1_080, timescale: 24,
		frames: frameAuthority().frames.map((frame) => ({ ...frame, subjects: [] })) };
}

function saliencyMap() {
	return { schemaVersion: 1, width: 1_920, height: 1_080, timescale: 24,
		frames: frameAuthority().frames.map((frame) => ({ ...frame, saliency: null })) };
}

function frameAuthority() {
	return { width: 1_920, height: 1_080, timescale: 24,
		frames: [{ sourceFrame: 0, presentationTick: '0' },
			{ sourceFrame: 239, presentationTick: '239' }] };
}

function highlightCandidate() {
	return { id: 'highlight-a', startFrame: 0, endFrame: 48_000,
		sourceStartFrame: 0, sourceEndFrame: 120, score: 0.8,
		evidenceMode: 'transcript', transcriptExcerpt: 'Exact transcript evidence.',
		visualSummary: 'Exact visual evidence.', selected: false,
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: null,
		cropKeyframes: [cropKeyframe(0), cropKeyframe(119)] };
}

function cropKeyframe(sourceFrame: number) {
	return { sourceFrame, authority: 'center', trackIds: [],
		crop: { left: 0.341796875, top: 0, right: 0.341796875, bottom: 0 } };
}

function model(stageId: string, slotId: string, modelId: string) {
	return { bindingVersion: 1 as const, stageId, slotId, modelId, version: '1.0.0',
		artifactSha256s: ['90'.repeat(32)] };
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction, stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: JOB_ID, stageId, slotId };
}

function reviewed(workflow: AssistanceWorkflowV1, stageId: string, slotId: string, semantic: unknown) {
	const body = jsonBlob(semantic, slotId);
	const output = workflow.outputs.find((candidate) => candidate.stageId === stageId
		&& candidate.slotId === slotId)!;
	return { reviewVersion: 1 as const, jobId: workflow.jobId,
		workflowId: workflow.workflowId as 'mark-cuts' | 'reframe' | 'make-highlights',
		outputs: [{ stageId, slotId, claim: output, mediaType: body.type, byteLength: body.size,
			sha256: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(semantic)))),
			body, semantic }], choices: [] };
}

function jsonBlob(value: unknown, slotId: string): Blob {
	return new Blob([JSON.stringify(value)], {
		type: `application/vnd.soundscaper.${slotId}+json`,
	});
}

function derivativeRepository(): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`guided-reusable-${String(Date.now())}-${Math.random()}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}
