/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedWorkflowPreparation,
} from '../src/common/editor/controller/local-assistance-guided-preparation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	JOB_ID,
	MAXIMUM_OUTPUT_BYTES,
	SOURCE_SHA256,
	model,
	preparationFixture,
	project,
	transcriptAssetFixture,
	type FixtureProject,
} from './helpers/audio-editor-local-assistance-guided-preparation-fixture.ts';

const FIXTURE_AUDIO_BYTES = 44 + 3 * 2 * Float32Array.BYTES_PER_ELEMENT;

test('enhancement preparation binds exact media, model, settings, recipe, and capacity authority', async () => {
	const fixture = preparationFixture();
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'enhance-dialogue',
		settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds, ['enhance-dialogue']);
	assert.deepEqual(result.workflow.models, [{
		bindingVersion: 1, stageId: 'enhance-dialogue', slotId: 'enhancer',
		modelId: 'deepfilternet3', version: '3.0.0',
		artifactSha256s: ['1'.padStart(64, '0')],
	}]);
	assert.equal(result.workflow.inputs.length, 1);
	assert.equal(result.workflow.outputs.length, 1);
	const { media, ...reviewAuthority } = result.reviewAuthority;
	assert.deepEqual(reviewAuthority, { reviewAuthorityVersion: 1,
		audioWave: { sampleRate: 48_000, channelCount: 2, frameCount: 3 },
		editorialCandidateIds: null });
	assert.equal(media.audio?.stageId, 'enhance-dialogue');
	assert.equal(media.audio?.slotId, 'audio');
	assert.equal(media.audio?.claimId, result.workflow.inputs[0]?.claimId);
	assert.equal(media.audio?.mediaType, 'audio/wav');
	assert.equal(media.audio?.body.type, 'audio/wav');
	assert.equal(media.audio?.byteLength, FIXTURE_AUDIO_BYTES);
	assert.equal(media.audio?.body.size, FIXTURE_AUDIO_BYTES);
	assert.match(media.audio?.sha256 ?? '', /^[a-f\d]{64}$/u);
	assert.equal(media.video, null);
	assert.deepEqual(result.workflow.fence.sourceRanges, [{
		slotId: 'primary-audio', mediaKind: 'audio', sourceId: 'voice-source',
		sourceSha256: SOURCE_SHA256, sourceSampleRate: 48_000, occurrenceIds: ['voice-clip'],
		sourceStartFrame: 24_000, sourceEndFrame: 72_000,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		retimeKind: 'identity',
	}]);
	for (const field of ['recipeSha256', 'settingsSha256', 'modelBindingsSha256'] as const) {
		assert.match(result.workflow.fence[field], /^[a-f\d]{64}$/u);
	}
	assert.deepEqual(fixture.preflights, [FIXTURE_AUDIO_BYTES]);
	assert.deepEqual(fixture.operations, ['speech-enhancement']);
	assert.equal(fixture.custodyEvents[0]?.kind, 'input');
	assert.equal(fixture.custodyEvents[1]?.kind, 'output');
	assert.equal(Object.isFrozen(result.workflow), true);
});

test('TIGER preparation reserves dialogue, music, and effects once in canonical order', async () => {
	const fixture = preparationFixture();
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'separate-dialogue-music-effects',
		settings: defaultAssistanceWorkflowSettingsV1('separate-dialogue-music-effects'),
		models: [model('tiger-dnr', '1.0.0', 'source-separation', 2)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.outputs.map(({ slotId }) => slotId),
		['dialogue', 'music', 'effects']);
	assert.deepEqual(result.reviewAuthority.audioWave,
		{ sampleRate: 44_100, channelCount: 2, frameCount: 3 });
	assert.deepEqual(fixture.preflights, [3 * FIXTURE_AUDIO_BYTES]);
	assert.deepEqual(fixture.operations, ['source-separation']);
	assert.equal(fixture.custodyEvents.filter(({ kind }) => kind === 'output').length, 3);
});

test('transcript indexing stages one authenticated stored transcript without rendering media', async () => {
	const { transcriptBytes, transcriptSha256, storageKey, transcriptProject } = transcriptAssetFixture();
	const fixture = preparationFixture(transcriptProject, false, { storageKey, bytes: transcriptBytes });
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds,
		['chunk-transcript', 'embed-transcript', 'publish-transcript-index']);
	assert.equal(result.workflow.fence.transcriptBodySha256, transcriptSha256);
	assert.deepEqual(fixture.operations, [], 'stored transcript indexing does not render selected audio');
	assert.deepEqual(fixture.custodyEvents.map(({ kind, slotId }) => `${kind}:${slotId}`), [
		'input:transcript', 'output:text-chunks', 'producer:text-chunks', 'output:embeddings',
		'producer:text-chunks', 'producer:embeddings', 'output:transcript-index',
	]);
});

test('transcript indexing refuses external deletion and corruption before staging', async () => {
	const { transcriptBytes, storageKey, transcriptProject } = transcriptAssetFixture();
	const missing = preparationFixture(transcriptProject, false, {
		storageKey: 'assistance-transcript-sha256:missing', bytes: transcriptBytes,
	});
	assert.deepEqual(await missing.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: missing.custody, signal: new AbortController().signal,
	}), { outcome: 'unavailable', reason: 'transcript-custody-unavailable' });
	assert.deepEqual(missing.custodyEvents, []);
	const corrupt = preparationFixture(transcriptProject, false, {
		storageKey, bytes: Uint8Array.from([...transcriptBytes, 0]),
	});
	await assert.rejects(corrupt.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'index-transcript',
		settings: defaultAssistanceWorkflowSettingsV1('index-transcript'),
		models: [model('nomic-embed-text-v1.5', '1.5.0', 'text-embedding', 7)],
		custody: corrupt.custody, signal: new AbortController().signal,
	}), /transcript body changed/iu);
	assert.deepEqual(corrupt.custodyEvents, []);
	assert.equal(corrupt.releases, 1);
});

test('standalone editorial generation derives one bounded selection context from authenticated transcript custody', async () => {
	const { transcriptBytes, storageKey, transcriptProject } = transcriptAssetFixture();
	const fixture = preparationFixture(transcriptProject, false, { storageKey, bytes: transcriptBytes });
	const settings = { ...defaultAssistanceWorkflowSettingsV1('generate-editorial-text'),
		enabled: true, fields: ['title', 'explanation'] } as const;
	const result = await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'generate-editorial-text', settings,
		models: [model('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 8)],
		custody: fixture.custody, signal: new AbortController().signal,
	});
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.stageIds, ['generate-editorial-text']);
	assert.deepEqual(result.workflow.inputs.map(({ stageId, slotId }) => `${stageId}:${slotId}`), [
		'generate-editorial-text:editorial-context',
	]);
	assert.deepEqual(result.reviewAuthority, {
		reviewAuthorityVersion: 1, audioWave: null,
		editorialCandidateIds: [`selection:${SOURCE_SHA256.slice(0, 24)}`],
		media: { audio: null, video: null },
	});
	const context = JSON.parse(new TextDecoder().decode(
		fixture.stagedBodies.get('editorial-context'),
	)) as Readonly<Record<string, unknown>>;
	assert.equal(context.operation, 'editorial-generation');
	assert.deepEqual(context.authorizedCandidateIds,
		[`selection:${SOURCE_SHA256.slice(0, 24)}`]);
	assert.deepEqual(context.fields, ['title', 'explanation']);
	assert.match(String(context.prompt), /requested inert fields: title, explanation/u);
	assert.match(String(context.prompt), /Selected words for editorial generation/u);
	assert.deepEqual(fixture.operations, [], 'editorial context never renders or uploads media');
});

test('standalone editorial generation remains unavailable without selected transcript evidence', async () => {
	const fixture = preparationFixture();
	assert.deepEqual(await fixture.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'generate-editorial-text',
		settings: { settingsVersion: 1, workflowId: 'generate-editorial-text', enabled: true,
			fields: ['title', 'hook', 'chapters', 'explanation'] },
		models: [model('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 8)],
		custody: fixture.custody, signal: new AbortController().signal,
	}), { outcome: 'unavailable', reason: 'editorial-context-custody-unavailable' });
	assert.deepEqual(fixture.custodyEvents, []);
});

test('missing or ambiguous exact models and unavailable aggregate custody are typed refusals', async () => {
	const fixture = preparationFixture();
	for (const models of [[], [
		model('deepfilternet3', '3.0.0', 'speech-enhancement', 1),
		model('deepfilternet3', '3.0.0', 'speech-enhancement', 2),
	]]) {
		const result = await fixture.preparation.prepareGuidedWorkflow({
			jobId: JOB_ID, workflowId: 'enhance-dialogue',
			settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
			models, custody: fixture.custody, signal: new AbortController().signal,
		});
		assert.deepEqual(result, { outcome: 'unavailable', reason: 'model-binding-unavailable' });
	}
	assert.deepEqual(fixture.preflights, []);
	assert.deepEqual(fixture.operations, []);
});

test('reverse, nested, multicamera, live, linked-unverifiable, and stale authority refuse before staging', async () => {
	for (const change of [
		{ clips: [{ ...project().clips[0], reversed: true }] },
		{ subsequences: [{ id: 'nested' }] },
		{ multicameraGroups: [{ id: 'multicam' }] },
		{ sources: [{ ...project().sources[0], liveCapture: true }] },
		{ clips: [...project().clips, { id: 'linked-video', kind: 'video', sourceId: 'camera',
			avLinkId: 'linked' }], sources: [...project().sources, { id: 'camera', kind: 'video',
			contentSha256: 'cd'.repeat(32) }] },
	] as const) {
		const fixture = preparationFixture({ ...project(), ...change });
		const result = await fixture.preparation.prepareGuidedWorkflow({
			jobId: JOB_ID, workflowId: 'enhance-dialogue',
			settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
			models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
			custody: fixture.custody, signal: new AbortController().signal,
		});
		assert.equal(result.outcome, 'unavailable');
		assert.equal(fixture.custodyEvents.length, 0);
	}

	const stale = preparationFixture(project(), true);
	await assert.rejects(stale.preparation.prepareGuidedWorkflow({
		jobId: JOB_ID, workflowId: 'enhance-dialogue',
		settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue'),
		models: [model('deepfilternet3', '3.0.0', 'speech-enhancement', 1)],
		custody: stale.custody, signal: new AbortController().signal,
	}), { name: 'AbortError' });
	assert.equal(stale.releases, 1);
});

test('Accurate Mark Cuts stages its exact frame pack and never substitutes Fast', async () => {
	const fixture = preparationFixture();
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: null, reversed: false, speedRatio: 1 }],
	};
	const modes: unknown[] = [];
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined,
		currentSelectionFence: () => ({
			projectId: 'project-1', schemaVersion: 30, revision: 4,
			sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
			sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
			sourceStartFrame: 0, sourceEndFrame: 120,
			linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		}),
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'video-source',
				label: 'Video', mediaKind: 'video', operations: ['shot-detection'] }] }),
			prepareSelectedMedia: async (request) => {
				modes.push(request.shotDetectionMode);
				return { sourceId: 'video-source', operation: 'shot-detection',
					shotDetectionMode: 'accurate', selectionFence: {
						projectId: 'project-1', schemaVersion: 30, revision: 4,
						sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
						sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
						sourceStartFrame: 0, sourceEndFrame: 120,
						linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
					}, inputs: [1, 2].map((ordinal) => ({ role: 'frame-pack',
						mediaType: 'application/vnd.soundscaper.frame-pack',
						bytes: new Blob([new Uint8Array([ordinal, 2, 3])]) })),
					outputs: [{ role: 'shot-boundaries', mediaType: 'application/json',
						maximumByteLength: MAXIMUM_OUTPUT_BYTES }],
				};
			},
		},
	});
	const result = await preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
		workflowId: 'mark-cuts', settings: { settingsVersion: 1, workflowId: 'mark-cuts',
			mode: 'accurate' }, models: [model('transnetv2', '1.0.0', 'shot-detection', 9)],
		custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.inputs.map(({ stageId, slotId }) => `${stageId}:${slotId}`), [
		'detect-shots:frame-pack', 'detect-shots:frame-pack',
		'normalize-cuts:shot-boundaries',
	]);
	assert.deepEqual(modes, ['accurate']);
	assert.equal(fixture.custodyEvents[0]?.kind, 'input');
	assert.equal(fixture.custodyEvents[0]?.slotId, 'frame-pack');
	assert.equal(fixture.custodyEvents[1]?.slotId, 'frame-pack');
	assert.notEqual(result.workflow.inputs[0]?.claimId, result.workflow.inputs[1]?.claimId);
});

test('Index Video stages exact selected-video timing authority beside raw decode custody', async () => {
	const fixture = preparationFixture();
	const timingAuthoritySha256 = '34'.repeat(32);
	const videoFence = {
		projectId: 'project-1', schemaVersion: 30, revision: 4,
		sequenceId: 'main-sequence', occurrenceIds: ['video-clip'],
		sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 20, sourceEndFrame: 24,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256,
	};
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: null, reversed: false, speedRatio: 1 }],
	};
	const descriptor = { schemaVersion: 1, kind: 'selected-video-source-time-authority',
		projectId: 'project-1', projectRevision: 4, sequenceId: 'main-sequence',
		videoOccurrenceId: 'video-clip', sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
		timingAuthoritySha256, sourceWidth: 1_920, sourceHeight: 1_080,
		sourceStartFrame: 20, sourceEndFrame: 24, sampleRate: 48_000, timescale: 24,
		selectionStartFrame: 96_000, selectionEndFrame: 104_000,
		frames: [20, 21, 22, 23, 24].map((sourceFrame) => ({ sourceFrame,
			presentationTick: String(sourceFrame),
			timelineFrame: 96_000 + (sourceFrame - 20) * 2_000 })) } as const;
	const preparations: Array<Readonly<{ mode: unknown; inputRole: unknown }>> = [];
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined, currentSelectionFence: () => videoFence,
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'video-source',
				label: 'Video', mediaKind: 'video', operations: ['shot-detection'] }] }),
			prepareSelectedMedia: async (request) => {
				preparations.push({ mode: request.shotDetectionMode, inputRole: request.inputRole });
				const role = request.inputRole ?? (request.shotDetectionMode === 'accurate'
					? 'frame-pack' : 'video');
				return { sourceId: 'video-source', operation: 'shot-detection',
					shotDetectionMode: request.shotDetectionMode ?? 'fast', selectionFence: videoFence,
					inputs: [{ role, mediaType: role === 'video' ? 'video/mp4'
						: 'application/vnd.soundscaper.frame-pack',
					bytes: new Blob([new Uint8Array([1, 2, 3])], { type: role === 'video'
							? 'video/mp4' : 'application/vnd.soundscaper.frame-pack' }) }], outputs: [] };
			},
			describeSelectedVideoSourceTime: async () => ({ selectionFence: videoFence, descriptor }),
		},
	});
	const indexSettings = defaultAssistanceWorkflowSettingsV1('index-video');
	if (indexSettings.workflowId !== 'index-video') assert.fail('Index settings changed identity.');
	const result = await preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
		workflowId: 'index-video', settings: { ...indexSettings, includeOcr: true }, models: [
			model('siglip2-base-patch16-224', '2.0.0', 'image-text-embedding', 11),
			model('ppocr-v4-mobile', '4.0.0', 'optical-character-recognition', 12),
		], custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(result.workflow.inputs.filter(({ stageId }) => stageId === 'sample-shot-frames')
		.map(({ slotId }) => slotId), ['video', 'video-authority', 'shot-boundaries']);
	const staged = fixture.stagedBodies.get('video-authority');
	assert.ok(staged);
	assert.deepEqual(JSON.parse(new TextDecoder().decode(staged)) as Readonly<Record<string, unknown>>,
		descriptor);

	const noOcrFixture = preparationFixture();
	const noOcr = await preparation.prepareGuidedWorkflow({ jobId: 'ab'.repeat(20),
		workflowId: 'index-video', settings: { ...indexSettings, shotMode: 'accurate', includeOcr: false }, models: [
			model('transnetv2', '1.0.0', 'shot-detection', 9),
			model('siglip2-base-patch16-224', '2.0.0', 'image-text-embedding', 11),
		], custody: noOcrFixture.custody, signal: new AbortController().signal });
	assert.equal(noOcr.outcome, 'prepared');
	if (noOcr.outcome !== 'prepared') return;
	assert.equal(noOcr.workflow.stageIds.includes('recognize-text'), false);
	assert.equal(noOcr.workflow.models.some(({ stageId }) => stageId === 'recognize-text'), false);
	assert.deepEqual(noOcr.workflow.inputs
		.filter(({ stageId }) => stageId === 'publish-video-index')
		.map(({ slotId }) => slotId), ['visual-embeddings']);
	assert.deepEqual(preparations.slice(-2), [
		{ mode: 'accurate', inputRole: 'frame-pack' },
		{ mode: 'accurate', inputRole: 'video' },
	], 'accurate detection and raw frame sampling retain distinct input-role custody');
});

test('Guided Reframe prepares both visual model stages through selected-video frame custody', async () => {
	const fixture = preparationFixture();
	const videoFence = { projectId: 'project-1', schemaVersion: 30, revision: 4,
		sequenceId: 'main-sequence', occurrenceIds: ['video-clip'], sourceId: 'video-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 20, sourceEndFrame: 120,
		linkMembershipSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32) };
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: null, reversed: false, speedRatio: 1 }] };
	const operations: string[] = [];
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined, currentSelectionFence: () => videoFence,
		selected: {
			listSelectedMedia: async () => ({ sources: [{ sourceId: 'video-source', label: 'Video',
				mediaKind: 'video', operations: ['subject-detection', 'saliency-detection'] }] }),
			prepareSelectedMedia: async ({ operation }) => {
				operations.push(operation);
				return { sourceId: 'video-source', operation, selectionFence: videoFence,
					inputs: [1, 2].map((ordinal) => ({ role: 'frame-pack',
						mediaType: 'application/vnd.soundscaper.frame-pack',
						bytes: new Blob([new Uint8Array([ordinal, 2, 3])], {
							type: 'application/vnd.soundscaper.frame-pack' }) })), outputs: [] };
			},
		},
	});
	const result = await preparation.prepareGuidedWorkflow({ jobId: 'cd'.repeat(20),
		workflowId: 'reframe', settings: defaultAssistanceWorkflowSettingsV1('reframe'), models: [
			model('yunet-face-detection-2026may', '2026.5.0', 'face-detection', 13),
			model('dfine-nano-coco', '1.0.0', 'object-detection', 14),
			model('u2netp-saliency', '1.0.0', 'saliency-detection', 15),
		], custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.deepEqual(operations, ['subject-detection', 'saliency-detection']);
	assert.deepEqual(result.workflow.inputs.filter(({ slotId }) => slotId === 'frame-pack')
		.map(({ stageId }) => stageId), [
			'detect-subjects', 'detect-subjects', 'detect-saliency', 'detect-saliency',
		]);
	assert.deepEqual(result.workflow.stageIds,
		['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops']);
});

test('Make Highlights adds Qwen only after explicit editorial rerank opt-in', async () => {
	const fixture = preparationFixture();
	const videoProject: FixtureProject = { ...project(),
		sources: [{ id: 'video-source', kind: 'video', contentSha256: SOURCE_SHA256 },
			{ id: 'audio-source', kind: 'audio', contentSha256: 'cd'.repeat(32),
				sampleRate: 48_000 }],
		clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', avLinkId: 'linked-av', reversed: false, speedRatio: 1 },
		{ id: 'audio-clip', kind: 'audio', sourceId: 'audio-source',
			sequenceId: 'main-sequence', avLinkId: 'linked-av', reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, warpMap: null }],
	};
	const linkMembershipSha256 = '12'.repeat(32);
	const videoFence = {
		projectId: 'project-1', schemaVersion: 30, revision: 4,
		sequenceId: 'main-sequence', occurrenceIds: ['audio-clip', 'video-clip'],
		sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 0, sourceEndFrame: 120,
		linkMembershipSha256, timingAuthoritySha256: '34'.repeat(32),
	};
	const audioFence = { ...videoFence, sourceId: 'audio-source', sourceSha256: 'cd'.repeat(32),
		sourceStartFrame: 0, sourceEndFrame: 240_000,
		timingAuthoritySha256: '56'.repeat(32) };
	const descriptor = {
		schemaVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		projectId: 'project-1', projectRevision: 4, sequenceId: 'main-sequence',
		videoOccurrenceId: 'video-clip', sourceId: 'video-source', sourceSha256: SOURCE_SHA256,
		timingAuthoritySha256: videoFence.timingAuthoritySha256,
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 0, sourceEndFrame: 120,
		sampleRate: 48_000, timescale: 24, selectionStartFrame: 0, selectionEndFrame: 240_000,
		frames: [{ sourceFrame: 0, presentationTick: '0', timelineFrame: 0 },
			{ sourceFrame: 120, presentationTick: '120', timelineFrame: 240_000 }],
	};
	const audioSamples = new Float32Array(160_000);
	audioSamples.fill(0.25);
	let fastVideoPreparations = 0;
	const highlightWav = encodeWav([audioSamples], {
		sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
	});
	const preparation = createLocalAssistanceGuidedWorkflowPreparation({
		getProject: () => videoProject, getSelectedClipId: () => 'video-clip',
		captureProject: () => ({ revision: 4 }), assertProject: () => undefined,
		preflightStorage: async () => undefined,
		currentSelectionFence: () => videoFence,
		selected: {
			listSelectedMedia: async () => ({ sources: [
				{ sourceId: 'audio-source', label: 'Audio', mediaKind: 'audio',
					operations: ['audio-tagging'] },
				{ sourceId: 'video-source', label: 'Video', mediaKind: 'video',
					operations: ['shot-detection'] },
			] }),
			prepareSelectedMedia: async ({ operation }) => {
				if (operation === 'audio-tagging') return {
					sourceId: 'audio-source', operation, selectionFence: audioFence,
					inputs: [{ role: 'audio', mediaType: 'audio/wav',
						bytes: new Blob([highlightWav.slice().buffer], {
							type: 'audio/wav',
						}) }], outputs: [] };
				fastVideoPreparations += 1;
				return { sourceId: 'video-source', operation: 'shot-detection', shotDetectionMode: 'fast',
					selectionFence: videoFence, inputs: [{ role: 'video', mediaType: 'video/mp4',
						bytes: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }) }], outputs: [] };
			},
			describeSelectedVideoSourceTime: async () => ({ selectionFence: videoFence, descriptor }),
		},
	});
	const settings = { ...defaultAssistanceWorkflowSettingsV1('make-highlights'),
		editorialRerank: true } as const;
	const result = await preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
		workflowId: 'make-highlights', settings,
		models: [model('panns-cnn10', '1.0.0', 'audio-tagging', 9),
			model('qwen3-4b-q4-k-m', '1.0.0', 'editorial-generation', 10)],
		custody: fixture.custody, signal: new AbortController().signal });
	assert.equal(result.outcome, 'prepared');
	if (result.outcome !== 'prepared') return;
	assert.equal(fastVideoPreparations, 1);
	assert.deepEqual(result.workflow.stageIds, [
		'detect-highlight-shots', 'tag-highlight-reactions', 'gather-signals', 'rank-highlights',
		'rerank-editorial', 'assemble-highlights',
	]);
	assert.deepEqual(result.workflow.models.map(({ stageId, slotId, modelId }) => ({
		stageId, slotId, modelId,
	})), [{ stageId: 'tag-highlight-reactions', slotId: 'audio-tagger',
		modelId: 'panns-cnn10' },
	{ stageId: 'rerank-editorial', slotId: 'editorial-generator',
		modelId: 'qwen3-4b-q4-k-m' }]);
	assert.ok(result.workflow.inputs.some(({ stageId, slotId }) => (
		stageId === 'rerank-editorial' && slotId === 'highlight-candidates'
	)));
	assert.ok(result.workflow.inputs.some(({ stageId, slotId }) => (
		stageId === 'assemble-highlights' && slotId === 'editorial-proposal'
	)));
	assert.deepEqual(result.workflow.inputs.filter(({ stageId }) => stageId === 'gather-signals')
		.map(({ slotId }) => slotId), ['video', 'audio', 'shot-boundaries', 'audio-tags']);
	assert.deepEqual(result.workflow.fence.sourceRanges.map(({ mediaKind, sourceId }) => ({
		mediaKind, sourceId,
	})), [{ mediaKind: 'audio', sourceId: 'audio-source' },
		{ mediaKind: 'video', sourceId: 'video-source' }]);
});
