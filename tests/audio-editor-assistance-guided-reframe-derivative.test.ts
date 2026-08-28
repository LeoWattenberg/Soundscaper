/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceAcceptedReframeDerivativeV1,
	reviewAssistanceAcceptedReframeDerivativeV1,
} from '../src/common/editor/assistance/reframe-derivative-v1.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { createAssistanceOwnedVideoHighlightTransformRegistryV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-registry-v1.ts';
import {
	prepareLocalAssistanceGuidedHighlightReframeEvidenceV1,
	retainLocalAssistanceGuidedAcceptedReframePathV1,
} from '../src/common/editor/controller/local-assistance-guided-reframe-derivative.ts';
import { publishLocalAssistanceGuidedFramescaperSelection } from
	'../src/common/editor/controller/local-assistance-guided-framescaper-acceptance.ts';
import {
	createLocalAssistanceGuidedHighlightVideoSignalsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-signals.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from
	'../src/common/editor/storage/repository-port.ts';

const JOB_ID = '01'.repeat(20);
const SOURCE_SHA256 = '12'.repeat(32);
const LINK_SHA256 = '34'.repeat(32);
const TIMING_SHA256 = '56'.repeat(32);

test('accepted Reframe derivatives retain the semantically reviewed draft and exact provenance', async () => {
	const workflow = reframeWorkflow();
	const result = reframeResult();
	const repository = derivativeRepository('accepted');
	const record = await retainLocalAssistanceGuidedAcceptedReframePathV1({
		workflow, result, repository,
		currentProject: () => ({ schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 9 }),
	});
	assert.equal(record.kind, 'reframe-path');
	assert.equal(record.mediaType, 'application/vnd.soundscaper.accepted-reframe-path+json');
	const reviewed = reviewAssistanceAcceptedReframeDerivativeV1(
		JSON.parse(new TextDecoder().decode(record.bytes)) as unknown,
	);
	assert.equal(reviewed.authority.baseProjectRevision, 8);
	assert.equal(reviewed.authority.acceptedProjectRevision, 9);
	assert.equal(reviewed.authority.settingsSha256, workflow.fence.settingsSha256);
	assert.equal(reviewed.authority.modelBindingsSha256, workflow.fence.modelBindingsSha256);
	assert.deepEqual(reviewed.result, result);
	assert.deepEqual(reviewed.result.path.keyframes.map(({ authority }) => authority),
		['subject', 'saliency', 'center', 'center']);
});

test('accepted Reframe retention refuses stale publication authority', async () => {
	const repository = derivativeRepository('stale');
	await assert.rejects(retainLocalAssistanceGuidedAcceptedReframePathV1({
		workflow: reframeWorkflow(), result: reframeResult(), repository,
		currentProject: () => ({ schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 8 }),
	}), { name: 'AbortError' });
	assert.deepEqual(await repository.listProject('project-a'), []);
});

test('Reframe publication retains only the accepted, semantically revalidated draft', async () => {
	const workflow = reframeWorkflow();
	const result = reframeResult();
	const order: string[] = [];
	await publishLocalAssistanceGuidedFramescaperSelection({
		acceptReframeResult: ({ result: accepted }) => {
			order.push('accepted');
			assert.equal(accepted, result);
		},
		retainReframeResult: ({ workflow: retainedWorkflow, result: retained }) => {
			order.push('retained');
			assert.equal(retainedWorkflow, workflow);
			assert.equal(retained, result);
		},
	}, workflow, 'reframe', new Map([['reframe-path', { semantic: result }]]), ['reframe-path']);
	assert.deepEqual(order, ['accepted', 'retained']);
});

test('highlight preparation admits only one payload-authenticated, exact accepted Reframe derivative', async () => {
	const workflow = reframeWorkflow();
	const repository = derivativeRepository('highlight');
	const record = await retainLocalAssistanceGuidedAcceptedReframePathV1({
		workflow, result: reframeResult(), repository,
		currentProject: () => ({ schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 9 }),
	});
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: videoAuthority(), audioOccurrenceId: null,
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
	});
	const fence = primitiveFence();
	const evidence = prepareLocalAssistanceGuidedHighlightReframeEvidenceV1({
		video, fence, records: [record], signal: new AbortController().signal,
	});
	assert.ok(evidence);
	assert.deepEqual(evidence.result.path.keyframes.map(({ authority }) => authority),
		['subject', 'saliency', 'center', 'center']);
	assert.equal(prepareLocalAssistanceGuidedHighlightReframeEvidenceV1({
		video, fence: { ...fence, revision: 10 }, records: [record],
		signal: new AbortController().signal,
	}), null);
	assert.equal(prepareLocalAssistanceGuidedHighlightReframeEvidenceV1({
		video, fence: { ...fence, timingAuthoritySha256: '78'.repeat(32) }, records: [record],
		signal: new AbortController().signal,
	}), null);
	await assert.rejects(async () => prepareLocalAssistanceGuidedHighlightReframeEvidenceV1({
		video, fence, records: [{ ...record, bytes: record.bytes.slice(),
			payloadSha256: '9a'.repeat(32) }], signal: new AbortController().signal,
	}), /authentication|digest|payload/iu);
});

test('accepted Reframe derivative review rejects changed model artifacts and source authority', () => {
	const derivative = createAssistanceAcceptedReframeDerivativeV1(
		reframeWorkflow(), reframeResult(), 9,
	);
	assert.throws(() => reviewAssistanceAcceptedReframeDerivativeV1({ ...derivative,
		authority: { ...derivative.authority,
			models: derivative.authority.models.map((model, index) => index === 0
				? { ...model, artifactSha256s: ['ab'.repeat(32)] } : model) },
	}), /model|digest|artifact/iu);
	assert.throws(() => reviewAssistanceAcceptedReframeDerivativeV1({ ...derivative,
		authority: { ...derivative.authority, sourceRange: {
			...derivative.authority.sourceRange, sourceEndFrame: 44,
		} },
	}), /source|range|path/iu);
});

test('Make Highlights preserves subject, saliency, and center evidence in crop-correct 9:16 proposals', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('make-highlights');
	if (settings.workflowId !== 'make-highlights') assert.fail('Highlight settings changed identity.');
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: videoAuthority(), audioOccurrenceId: null, settings,
	});
	const evidence = createAssistanceAcceptedReframeDerivativeV1(
		reframeWorkflow(), reframeResult(), 9,
	);
	const registry = createAssistanceOwnedVideoHighlightTransformRegistryV1();
	const gathered = registry.run({ schemaVersion: 1, transformId: 'gather-signals', settings,
		inputs: { video: { ...video, reframeEvidence: evidence }, audio: null, transcript: null,
			'shot-boundaries': null, 'audio-tags': null, 'reaction-ranges': null,
			embeddings: null } }).outputs['highlight-signals'];
	const ranked = registry.run({ schemaVersion: 1, transformId: 'rank-highlights', settings,
		inputs: { 'highlight-signals': gathered } }).outputs['highlight-candidates'];
	const proposals = registry.run({ schemaVersion: 1, transformId: 'assemble-highlights', settings,
		inputs: { 'highlight-candidates': ranked, editorial: null } }).outputs['highlight-proposals'];
	assert.deepEqual(proposals.proposals.map(({ cropKeyframes }) =>
		cropKeyframes[0]?.authority), ['subject', 'saliency', 'center']);
	assert.deepEqual(proposals.proposals[0]?.cropKeyframes[0]?.trackIds, ['subject-1']);
	assert.equal(proposals.proposals[0]?.cropKeyframes[0]?.crop.left, 0);
	assert.equal(proposals.proposals[1]?.cropKeyframes[0]?.crop.left, 0.68359375);
	for (const proposal of proposals.proposals) {
		for (const { crop } of proposal.cropKeyframes) {
			const width = 1_920 * (1 - crop.left - crop.right);
			const height = 1_080 * (1 - crop.top - crop.bottom);
			assert.ok(Math.abs(width / height - 9 / 16) < 1e-8);
		}
	}
});

export function reframeWorkflow(): AssistanceWorkflowV1 {
	const workflowId = 'reframe';
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	const stageIds = ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'];
	const models = [
		model('detect-subjects', 'face-detector', 'yunet', '1.0.0', '61'),
		model('detect-subjects', 'object-detector', 'd-fine', '1.0.0', '62'),
		model('detect-saliency', 'saliency-detector', 'u2net-p', '1.0.0', '63'),
	];
	return {
		contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1,
		settingsVersion: 1, settings, stageIds, models,
		inputs: [
			claim('input', 'detect-subjects', 'frame-pack', 1),
			claim('input', 'detect-saliency', 'frame-pack', 2),
			claim('input', 'track-subjects', 'subject-tracks', 3),
			claim('input', 'plan-crops', 'tracked-subjects', 4),
			claim('input', 'plan-crops', 'saliency-map', 5),
		],
		outputs: [
			claim('output', 'detect-subjects', 'subject-tracks', 6),
			claim('output', 'detect-saliency', 'saliency-map', 7),
			claim('output', 'track-subjects', 'tracked-subjects', 8),
			claim('output', 'plan-crops', 'reframe-path', 9),
		],
		fence: {
			fenceVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', revision: 8,
			sequenceId: 'sequence-a', transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
			sourceRanges: [{ slotId: 'primary-video', mediaKind: 'video',
				sourceId: 'video-source', sourceSha256: SOURCE_SHA256, sourceSampleRate: null,
				occurrenceIds: ['video-occurrence'], sourceStartFrame: 0, sourceEndFrame: 45,
				linkMembershipSha256: LINK_SHA256, timingAuthoritySha256: TIMING_SHA256,
				retimeKind: 'identity' }],
		},
	};
}

export function reframeResult() {
	const frames = [0, 15, 30, 44].map((sourceFrame) => ({
		sourceFrame, presentationTick: String(sourceFrame),
	}));
	return {
		schemaVersion: 1 as const, kind: 'reframe-path' as const,
		authority: { width: 1_920, height: 1_080, timescale: 1, frames },
		fallbackChain: ['subject', 'saliency', 'center'] as const,
		path: { schemaVersion: 1 as const, targetAspect: { width: 9, height: 16 },
			keyframes: [
				keyframe(0, 'subject', ['subject-1'], 0, 0.68359375),
				keyframe(15, 'saliency', [], 0.68359375, 0),
				keyframe(30, 'center', [], 0.341796875, 0.341796875),
				keyframe(44, 'center', [], 0.1, 0.58359375),
			] },
	};
}

function keyframe(
	sourceFrame: number,
	authority: 'subject' | 'saliency' | 'center',
	trackIds: readonly string[],
	left: number,
	right: number,
) {
	return { sourceFrame, authority, trackIds, crop: { left, top: 0, right, bottom: 0 } };
}

function videoAuthority() {
	return {
		descriptorVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 9, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256: SOURCE_SHA256, timingAuthoritySha256: TIMING_SHA256,
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 45,
		sampleRate: 1_000, timescale: 1, selectionStartFrame: 0, selectionEndFrame: 45_000,
		frames: [0, 15, 30, 44, 45].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 1_000 })),
	};
}

function primitiveFence() {
	return { schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', revision: 9,
		sequenceId: 'sequence-a', occurrenceIds: ['video-occurrence'], sourceId: 'video-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 45,
		linkMembershipSha256: LINK_SHA256, timingAuthoritySha256: TIMING_SHA256 };
}

function derivativeRepository(name: string): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`accepted-reframe-${name}-${String(Date.now())}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}

function model(
	stageId: string, slotId: string, modelId: string, version: string, digest: string,
) {
	return { bindingVersion: 1 as const, stageId, slotId, modelId, version,
		artifactSha256s: [digest.repeat(32)] };
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction, stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId: JOB_ID, stageId, slotId };
}
