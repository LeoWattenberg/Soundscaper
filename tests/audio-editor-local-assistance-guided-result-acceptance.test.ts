/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createLocalAssistanceGuidedResultAcceptance,
} from '../src/common/editor/controller/local-assistance-guided-result-acceptance.ts';
import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	type AssistanceGuidedWorkflowId,
	type AssistanceWorkflowModelBindingV1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = '01'.repeat(20);
const SOURCE_SHA256 = '12'.repeat(32);
const MODEL_SHA256 = '34'.repeat(32);
const LINK_SHA256 = '56'.repeat(32);
const TIMING_SHA256 = '78'.repeat(32);

test('Guided caption acceptance starts unchecked, adapts absolute cues, and revalidates authority', async () => {
	const workflow = workflowFixture('transcribe-captions', {
		stageIds: ['detect-speech', 'recognize-speech', 'assemble-captions'],
		models: [model('detect-speech', 'vad', 'silero-vad', '6.2.0'),
			model('recognize-speech', 'speech-recognizer', 'parakeet-tdt-0.6b-v3', '3.0.0')],
		inputs: [claim('input', 'detect-speech', 'audio', 1),
			claim('input', 'recognize-speech', 'audio', 2),
			claim('input', 'assemble-captions', 'transcript', 3)],
		outputs: [claim('output', 'detect-speech', 'voice-activity', 4),
			claim('output', 'recognize-speech', 'transcript', 5),
			claim('output', 'assemble-captions', 'captions', 6)],
		sourceStartFrame: 48_000, sourceEndFrame: 144_000,
	});
	const captions = Object.freeze({
		schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
		alignmentApplied: false,
		cues: Object.freeze([{ cueId: 'caption:0', startFrame: 48_000, endFrame: 72_000,
			text: 'Hello', words: Object.freeze([{ text: 'Hello', startFrame: 48_000,
				endFrame: 72_000, confidence: 0.9 }]) }]),
	});
	const review = reviewed(workflow, [terminalOutput(workflow, 'assemble-captions', 'captions', captions)],
		[{ id: 'captions', kind: 'captions', label: '1 caption cue' }]);
	let current = primitiveFence(workflow);
	const requests: unknown[] = [];
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => current,
		acceptValidatedResult: async (request) => { requests.push(request); },
	});
	const ready = adapter.createAcceptanceSession({ workflow, reviewedResult: review });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	assert.deepEqual(ready.session.snapshot().choices.map(({ selected }) => selected), [false]);
	assert.deepEqual(await ready.session.accept([]), { outcome: 'accepted', selectedIds: [] });
	assert.equal(requests.length, 0);

	const second = adapter.createAcceptanceSession({ workflow, reviewedResult: review });
	assert.equal(second.outcome, 'ready');
	if (second.outcome !== 'ready') return;
	await second.session.accept(['captions']);
	const request = requests[0] as Record<string, unknown>;
	assert.equal(request.operation, 'speech-recognition');
	assert.deepEqual(request.models, [{ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
		task: 'speech-recognition', artifactSha256s: [MODEL_SHA256] }]);
	const outputs = request.outputs as readonly Record<string, unknown>[];
	const semantic = outputs[0]?.review as Record<string, unknown>;
	assert.deepEqual(semantic.segments, [{ startSeconds: 0, endSeconds: 0.5, text: 'Hello',
		words: [{ text: 'Hello', startSeconds: 0, endSeconds: 0.5, confidence: 0.9 }], speaker: null }]);

	const stale = adapter.createAcceptanceSession({ workflow, reviewedResult: review });
	assert.equal(stale.outcome, 'ready');
	if (stale.outcome !== 'ready') return;
	current = { ...current, revision: current.revision + 1 };
	await assert.rejects(stale.session.accept(['captions']), /proposal no longer matches|stale/iu);
});

test('Guided enhancement and complete D/M/E selection reuse geometry-authenticated publication', async () => {
	const calls: Readonly<{ request: unknown; choice: unknown }>[] = [];
	const enhancement = workflowFixture('enhance-dialogue', {
		stageIds: ['enhance-dialogue'],
		models: [model('enhance-dialogue', 'enhancer', 'deepfilternet3', '3.0.0')],
		inputs: [claim('input', 'enhance-dialogue', 'audio', 1)],
		outputs: [claim('output', 'enhance-dialogue', 'enhanced-audio', 2)],
		settings: { settingsVersion: 1, workflowId: 'enhance-dialogue',
			placement: 'replace-selection' },
	});
	const enhancedOutput = audioOutput(enhancement, 'enhance-dialogue', 'enhanced-audio', 48_000);
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(enhancement),
		acceptAudioResult: async (request, choice) => { calls.push({ request, choice }); },
	});
	const ready = adapter.createAcceptanceSession({ workflow: enhancement,
		reviewedResult: reviewed(enhancement, [enhancedOutput], [
			{ id: 'enhanced-audio', kind: 'audio', label: 'Enhanced Dialogue' },
		]) });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	await ready.session.accept(['enhanced-audio']);
	assert.deepEqual(calls[0]?.choice, { placement: 'replace-selection' });
	assert.equal((calls[0]?.request as Record<string, unknown>).operation, 'speech-enhancement');

	const separation = workflowFixture('separate-dialogue-music-effects', {
		stageIds: ['separate-sources'],
		models: [model('separate-sources', 'separator', 'tiger-dnr', '1.0.0')],
		inputs: [claim('input', 'separate-sources', 'audio', 1)],
		outputs: ['dialogue', 'music', 'effects'].map((slot, index) =>
			claim('output', 'separate-sources', slot, index + 2)),
		settings: { settingsVersion: 1, workflowId: 'separate-dialogue-music-effects',
			placement: 'muted-aligned-tracks' },
	});
	const separationCalls: unknown[] = [];
	const stems = ['dialogue', 'music', 'effects'].map((slot) =>
		audioOutput(separation, 'separate-sources', slot, 44_100));
	const stemChoices = ['dialogue', 'music', 'effects'].map((id) => ({ id, kind: 'audio',
		label: id[0]!.toUpperCase() + id.slice(1) }));
	const separationAdapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(separation),
		acceptAudioResult: async (request, choice) => { separationCalls.push({ request, choice }); },
	});
	const separationReady = separationAdapter.createAcceptanceSession({ workflow: separation,
		reviewedResult: reviewed(separation, stems, stemChoices) });
	assert.equal(separationReady.outcome, 'ready');
	if (separationReady.outcome !== 'ready') return;
	assert.deepEqual(await separationReady.session.accept(['dialogue']), {
		outcome: 'unsupported', workflowId: 'separate-dialogue-music-effects',
		reason: 'partial-separation-selection',
	});
	assert.equal(separationCalls.length, 0);
	await separationReady.session.accept(['dialogue', 'music', 'effects']);
	assert.deepEqual((separationCalls[0] as Record<string, unknown>).choice,
		{ placement: 'project-bin-and-muted-tracks' });
});

test('Guided beats and cuts pass only explicitly selected proposal identities', async () => {
	const beats = beatWorkflow();
	const beatLabels = { schemaVersion: 1, kind: 'beat-labels', publicationRequested: false,
		points: [{ id: 'beat-grid:downbeat:0', kind: 'downbeat', label: 'Downbeat', sample: 0,
			confidence: 0.9, selected: false },
		{ id: 'beat-grid:beat:11025', kind: 'beat', label: 'Beat', sample: 11_025,
			confidence: null, selected: false }] };
	const tempo = { schemaVersion: 1, kind: 'tempo-map-diff', applicationRequested: false,
		proposal: { kind: 'constant', bpm: 120 } };
	const beatAccepted: string[][] = [];
	let beatRequest: unknown;
	const beatAdapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(beats),
		createBeatReviewSession: (request) => {
			beatRequest = request;
			return fakeBeatSession(beatAccepted);
		},
	});
	const beatReady = beatAdapter.createAcceptanceSession({ workflow: beats,
		reviewedResult: reviewed(beats, [
			terminalOutput(beats, 'propose-tempo-map', 'beat-labels', beatLabels),
			terminalOutput(beats, 'propose-tempo-map', 'tempo-map-diff', tempo),
		], [
			{ id: 'beat-grid:downbeat:0', kind: 'beat', label: 'Beat point 1' },
			{ id: 'beat-grid:beat:11025', kind: 'beat', label: 'Beat point 2' },
			{ id: 'beat-grid:tempo-map', kind: 'tempo-map', label: 'Tempo map' },
		]) });
	assert.equal(beatReady.outcome, 'ready');
	if (beatReady.outcome !== 'ready') return;
	await beatReady.session.accept(['beat-grid:beat:11025']);
	assert.deepEqual(beatAccepted, [['beat-grid:beat:11025']]);
	const adaptedBeat = beatRequest as Record<string, unknown>;
	assert.equal(adaptedBeat.operation, 'beat-tracking');
	assert.deepEqual(((adaptedBeat.outputs as Record<string, unknown>[])[0]?.review as
		Record<string, unknown>).points, [
		{ sample: 0, kind: 'downbeat', confidence: 0.9 },
		{ sample: 11_025, kind: 'beat', confidence: null },
	]);

	const cuts = cutWorkflow();
	const cutSemantic = { schemaVersion: 1, kind: 'cut-proposals', mode: 'accurate',
		detector: 'transnetv2', timescale: 90_000, sourceFrameCount: 240,
		proposals: [
			{ id: 'cut:24:90090', sourceFrame: 24, presentationTick: '90090', score: 0.5,
				selected: false },
			{ id: 'cut:120:450450', sourceFrame: 120, presentationTick: '450450', score: 0.9,
				selected: false },
		] };
	const cutRequests: unknown[] = [];
	const cutAdapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(cuts),
		acceptValidatedResult: async (request) => { cutRequests.push(request); },
	});
	const cutReady = cutAdapter.createAcceptanceSession({ workflow: cuts,
		reviewedResult: reviewed(cuts, [terminalOutput(cuts, 'normalize-cuts', 'cut-proposals',
			cutSemantic)], cutSemantic.proposals.map(({ id }) => ({ id, kind: 'cut', label: id }))) });
	assert.equal(cutReady.outcome, 'ready');
	if (cutReady.outcome !== 'ready') return;
	await cutReady.session.accept(['cut:120:450450']);
	const cutReview = (((cutRequests[0] as Record<string, unknown>).outputs as
		Record<string, unknown>[])[0]?.review as Record<string, unknown>);
	assert.deepEqual(cutReview.boundaries, [
		{ sourceFrame: 120, presentationTick: '450450', score: 0.9 },
	]);
});

test('Guided cleanup passes only explicitly selected reviewed proposals to atomic publication', async () => {
	const workflow = workflowFixture('clean-filler-silence', {
		stageIds: ['detect-speech', 'propose-cleanup'],
		models: [model('detect-speech', 'vad', 'silero-vad-v6', '6.2.1')],
		inputs: [claim('input', 'detect-speech', 'audio', 1),
			claim('input', 'propose-cleanup', 'voice-activity', 2)],
		outputs: [claim('output', 'detect-speech', 'voice-activity', 3),
			claim('output', 'propose-cleanup', 'cleanup-proposals', 4)],
	});
	const cleanup = { schemaVersion: 1, kind: 'cleanup-proposals', preset: 'balanced',
		proposals: [
			{ id: 'filler-100-200', kind: 'filler', startFrame: 100, endFrame: 200,
				text: 'um', selected: false },
			{ id: 'silence-400-800', kind: 'silence', startFrame: 400, endFrame: 800,
				text: '', selected: false },
		] };
	const requests: unknown[] = [];
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow),
		acceptCleanupResult: async (request) => { requests.push(request); },
	});
	const ready = adapter.createAcceptanceSession({ workflow, reviewedResult: reviewed(workflow,
		[terminalOutput(workflow, 'propose-cleanup', 'cleanup-proposals', cleanup)],
		cleanup.proposals.map(({ id }) => ({ id, kind: 'cleanup', label: id }))) });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	await ready.session.accept(['silence-400-800']);
	assert.deepEqual(requests, [{ selectionFence: primitiveFence(workflow), result: cleanup,
		selectedProposalIds: ['silence-400-800'] }]);
});

test('Guided speaker attribution replaces the transcript through exact diarization bindings', async () => {
	const workflow = workflowFixture('identify-speakers', {
		stageIds: ['diarize-speakers', 'attribute-speakers'],
		models: [
			model('diarize-speakers', 'diarizer', 'sherpa-pyannote-segmentation-3.0', '1'),
			model('diarize-speakers', 'speaker-embedding', 'sherpa-eres2net-base', '1'),
		],
		inputs: [claim('input', 'diarize-speakers', 'audio', 1),
			claim('input', 'attribute-speakers', 'transcript', 2),
			claim('input', 'attribute-speakers', 'speaker-turns', 3)],
		outputs: [claim('output', 'diarize-speakers', 'speaker-turns', 4),
			claim('output', 'attribute-speakers', 'attributed-transcript', 5)],
		sourceStartFrame: 48_000, sourceEndFrame: 144_000,
	});
	const transcript = { schemaVersion: 1, sourceId: 'source-a', sampleRate: 48_000,
		language: 'en', modelId: 'parakeet-tdt-0.6b-v3', segments: [{
			startFrame: 48_000, endFrame: 72_000, text: 'Hello', speaker: 'Speaker 1',
			words: [{ text: 'Hello', startFrame: 48_000, endFrame: 72_000, confidence: 0.9 }],
		}] };
	const requests: unknown[] = [];
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow),
		acceptValidatedResult: async (request) => { requests.push(request); },
	});
	const ready = adapter.createAcceptanceSession({ workflow, reviewedResult: reviewed(workflow,
		[terminalOutput(workflow, 'attribute-speakers', 'attributed-transcript', transcript)],
		[{ id: 'attributed-transcript', kind: 'transcript', label: 'Attributed transcript' }]) });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	await ready.session.accept(['attributed-transcript']);
	const request = requests[0] as Record<string, unknown>;
	assert.equal(request.operation, 'speaker-diarization');
	assert.deepEqual(request.models, [
		{ modelId: 'sherpa-pyannote-segmentation-3.0', version: '1',
			task: 'speaker-segmentation', artifactSha256s: [MODEL_SHA256] },
		{ modelId: 'sherpa-eres2net-base', version: '1', task: 'speaker-embedding',
			artifactSha256s: [MODEL_SHA256] },
	]);
	const output = (request.outputs as readonly Record<string, unknown>[])[0]!;
	assert.deepEqual((output.review as Record<string, unknown>).segments, [{
		startSeconds: 0, endSeconds: 0.5, text: 'Hello', speaker: 'Speaker 1',
		words: [{ text: 'Hello', startSeconds: 0, endSeconds: 0.5, confidence: 0.9 }],
	}]);
});

test('Guided reactions reproduce reviewed merged ranges through the owned reaction publisher', async () => {
	const workflow = workflowFixture('mark-reactions', {
		stageIds: ['tag-reactions', 'merge-reaction-ranges'],
		models: [model('tag-reactions', 'audio-tagger', 'panns-cnn10', '1.0.0')],
		inputs: [claim('input', 'tag-reactions', 'audio', 1),
			claim('input', 'merge-reaction-ranges', 'audio-tags', 2)],
		outputs: [claim('output', 'tag-reactions', 'audio-tags', 3),
			claim('output', 'merge-reaction-ranges', 'reaction-ranges', 4)],
	});
	const reactions = { schemaVersion: 1, kind: 'reaction-ranges', sampleRate: 32_000,
		threshold: 0.5, ranges: [{ id: 'reaction:laughter:0:96000', kind: 'reaction',
			label: 'Laughter', startSample: 0, endSample: 96_000, score: 0.75,
			selected: false }] };
	const accepted: string[][] = [];
	let reactionRequest: unknown;
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow),
		createReactionReviewSession: (request) => {
			reactionRequest = request;
			return fakeBeatSession(accepted);
		},
	});
	const ready = adapter.createAcceptanceSession({ workflow, reviewedResult: reviewed(workflow,
		[terminalOutput(workflow, 'merge-reaction-ranges', 'reaction-ranges', reactions)],
		[{ id: reactions.ranges[0]!.id, kind: 'reaction', label: 'Reaction range 1' }]) });
	assert.equal(ready.outcome, 'ready');
	if (ready.outcome !== 'ready') return;
	await ready.session.accept([reactions.ranges[0]!.id]);
	assert.deepEqual(accepted, [[reactions.ranges[0]!.id]]);
	const request = reactionRequest as Record<string, unknown>;
	assert.equal(request.operation, 'audio-tagging');
	assert.deepEqual(request.models, [{ modelId: 'panns-cnn10', version: '1.0.0',
		task: 'audio-tagging', artifactSha256s: [MODEL_SHA256] }]);
	const output = (request.outputs as readonly Record<string, unknown>[])[0]!;
	assert.deepEqual((output.review as Record<string, unknown>).windows, [
		{ startSample: 0, scores: { laughter: 0.75, applause: 0, cheering: 0 } },
		{ startSample: 32_000, scores: { laughter: 0.75, applause: 0, cheering: 0 } },
		{ startSample: 64_000, scores: { laughter: 0.75, applause: 0, cheering: 0 } },
	]);
});

test('Guided acceptance reports unsupported workflow and missing-port states without inventing edits', () => {
	const unsupportedIds: AssistanceGuidedWorkflowId[] = [
		'index-transcript',
		'index-video', 'generate-editorial-text',
	];
	for (const workflowId of unsupportedIds) {
		const workflow = unsupportedWorkflow(workflowId);
		const result = createLocalAssistanceGuidedResultAcceptance({
			currentSelectionFence: () => primitiveFence(workflow),
		}).createAcceptanceSession({ workflow, reviewedResult: {} });
		assert.deepEqual(result, { outcome: 'unsupported', workflowId,
			reason: 'workflow-publication-unavailable' });
	}
	const enhancement = workflowFixture('enhance-dialogue', {
		stageIds: ['enhance-dialogue'],
		models: [model('enhance-dialogue', 'enhancer', 'deepfilternet3', '3.0.0')],
		inputs: [claim('input', 'enhance-dialogue', 'audio', 1)],
		outputs: [claim('output', 'enhance-dialogue', 'enhanced-audio', 2)],
	});
	const output = audioOutput(enhancement, 'enhance-dialogue', 'enhanced-audio', 48_000);
	assert.deepEqual(createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(enhancement),
	}).createAcceptanceSession({ workflow: enhancement,
		reviewedResult: reviewed(enhancement, [output], [
			{ id: 'enhanced-audio', kind: 'audio', label: 'Enhanced Dialogue' },
		]) }), { outcome: 'unsupported', workflowId: 'enhance-dialogue',
		reason: 'primitive-acceptance-unavailable' });
});

function workflowFixture(
	workflowId: AssistanceGuidedWorkflowId,
	options: Readonly<{
		stageIds: readonly string[];
		models?: readonly AssistanceWorkflowModelBindingV1[];
		inputs: AssistanceWorkflowV1['inputs'];
		outputs: AssistanceWorkflowV1['outputs'];
		settings?: AssistanceWorkflowV1['settings'];
		sourceStartFrame?: number;
		sourceEndFrame?: number;
		mediaKind?: 'audio' | 'video';
	}>,
): AssistanceWorkflowV1 {
	const settings = options.settings ?? defaultAssistanceWorkflowSettingsV1(workflowId);
	const models = options.models ?? [];
	const mediaKind = options.mediaKind ?? 'audio';
	return {
		contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1, settingsVersion: 1,
		settings, stageIds: options.stageIds, models, inputs: options.inputs, outputs: options.outputs,
		fence: {
			fenceVersion: 1, projectId: 'project-a', schemaVersion: 31, revision: 8,
			sequenceId: 'sequence-a', transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, options.stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
			sourceRanges: [{ slotId: mediaKind === 'audio' ? 'primary-audio' : 'primary-video',
				mediaKind, sourceId: 'source-a', sourceSha256: SOURCE_SHA256,
				sourceSampleRate: mediaKind === 'audio' ? 48_000 : null,
				occurrenceIds: ['occurrence-a'], sourceStartFrame: options.sourceStartFrame ?? 0,
				sourceEndFrame: options.sourceEndFrame ?? (mediaKind === 'audio' ? 96_000 : 240),
				linkMembershipSha256: LINK_SHA256, timingAuthoritySha256: TIMING_SHA256,
				retimeKind: 'identity' }],
		},
	};
}

function beatWorkflow(): AssistanceWorkflowV1 {
	return workflowFixture('detect-beats-tempo', {
		stageIds: ['track-beats', 'propose-tempo-map'],
		models: [model('track-beats', 'beat-tracker', 'beat-this-small0', '1.1.0')],
		inputs: [claim('input', 'track-beats', 'audio', 1),
			claim('input', 'propose-tempo-map', 'beat-grid', 2)],
		outputs: [claim('output', 'track-beats', 'beat-grid', 3),
			claim('output', 'propose-tempo-map', 'beat-labels', 4),
			claim('output', 'propose-tempo-map', 'tempo-map-diff', 5)],
	});
}

function cutWorkflow(): AssistanceWorkflowV1 {
	return workflowFixture('mark-cuts', {
		stageIds: ['detect-shots', 'normalize-cuts'], mediaKind: 'video',
		settings: { settingsVersion: 1, workflowId: 'mark-cuts', mode: 'accurate' },
		models: [model('detect-shots', 'accurate-shot-detector', 'transnetv2', '1.0.0')],
		inputs: [claim('input', 'detect-shots', 'frame-pack', 1),
			claim('input', 'normalize-cuts', 'shot-boundaries', 2)],
		outputs: [claim('output', 'detect-shots', 'shot-boundaries', 3),
			claim('output', 'normalize-cuts', 'cut-proposals', 4)],
	});
}

function unsupportedWorkflow(workflowId: AssistanceGuidedWorkflowId): AssistanceWorkflowV1 {
	const specs = {
		'clean-filler-silence': ['detect-speech', 'propose-cleanup'],
		'identify-speakers': ['diarize-speakers', 'attribute-speakers'],
		'mark-reactions': ['tag-reactions', 'merge-reaction-ranges'],
		'index-transcript': ['chunk-transcript', 'embed-transcript', 'publish-transcript-index'],
		'index-video': ['detect-shots', 'sample-shot-frames', 'embed-visuals', 'recognize-text',
			'publish-video-index'],
		reframe: ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'],
		'make-highlights': ['gather-signals', 'rank-highlights', 'assemble-highlights'],
		'generate-editorial-text': ['generate-editorial-text'],
	} as const;
	return { ...workflowFixture('enhance-dialogue', {
		stageIds: ['enhance-dialogue'],
		models: [model('enhance-dialogue', 'enhancer', 'deepfilternet3', '3.0.0')],
		inputs: [claim('input', 'enhance-dialogue', 'audio', 1)],
		outputs: [claim('output', 'enhance-dialogue', 'enhanced-audio', 2)],
	}), workflowId, stageIds: specs[workflowId as keyof typeof specs],
	settings: defaultAssistanceWorkflowSettingsV1(workflowId) } as
		unknown as AssistanceWorkflowV1;
}

function model(stageId: string, slotId: string, modelId: string, version: string) {
	return { bindingVersion: 1 as const, stageId, slotId, modelId, version,
		artifactSha256s: [MODEL_SHA256] };
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction, stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: JOB_ID, stageId, slotId };
}

function primitiveFence(workflow: AssistanceWorkflowV1) {
	const range = workflow.fence.sourceRanges[0]!;
	return { projectId: workflow.fence.projectId, schemaVersion: workflow.fence.schemaVersion,
		revision: workflow.fence.revision, sequenceId: workflow.fence.sequenceId,
		occurrenceIds: range.occurrenceIds, sourceId: range.sourceId,
		sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame,
		sourceEndFrame: range.sourceEndFrame, linkMembershipSha256: range.linkMembershipSha256,
		timingAuthoritySha256: range.timingAuthoritySha256 };
}

function reviewed(workflow: AssistanceWorkflowV1, outputs: readonly unknown[], choices: readonly unknown[]) {
	return { reviewVersion: 1, jobId: workflow.jobId, workflowId: workflow.workflowId,
		outputs, choices: choices.map((choice) => ({ ...(choice as object), selected: false, enabled: true })) };
}

function terminalOutput(
	workflow: AssistanceWorkflowV1, stageId: string, slotId: string, semantic: unknown,
) {
	const claimValue = workflow.outputs.find((candidate) => candidate.stageId === stageId
		&& candidate.slotId === slotId)!;
	const text = JSON.stringify(semantic);
	const body = new Blob([text], { type: `application/vnd.soundscaper.${slotId}+json` });
	return { stageId, slotId, claim: claimValue, mediaType: body.type, byteLength: body.size,
		sha256: createHash('sha256').update(text).digest('hex'), body, semantic };
}

function audioOutput(
	workflow: AssistanceWorkflowV1, stageId: string, slotId: string, sampleRate: number,
) {
	const wave = encodeWav([Float32Array.of(0.25, -0.25)], {
		sampleRate, bitDepth: 32, float: true, dither: false,
	});
	const body = new Blob([wave.slice().buffer], { type: 'audio/wav' });
	const claimValue = workflow.outputs.find((candidate) => candidate.stageId === stageId
		&& candidate.slotId === slotId)!;
	const role = slotId === 'enhanced-audio' ? 'enhanced-audio' : 'separated-audio';
	return { stageId, slotId, claim: claimValue, mediaType: body.type, byteLength: body.size,
		sha256: createHash('sha256').update(wave).digest('hex'), body,
		semantic: { kind: 'audio-wave', role, sampleRate, channelCount: 1, frameCount: 2,
			sampleFormat: 'float32' } };
}

function fakeBeatSession(accepted: string[][]) {
	let phase = 'review';
	return {
		signal: new AbortController().signal,
		snapshot: () => ({ phase, proposals: [], tempoMapChoice: null }),
		accept: async (ids: readonly string[]) => { accepted.push([...ids]); phase = 'accepted'; },
		reject: async () => { phase = 'rejected'; }, cancel: async () => { phase = 'cancelled'; },
	};
}
