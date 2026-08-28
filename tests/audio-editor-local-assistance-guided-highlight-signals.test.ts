/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedHighlightAudioSignalsV1,
	createLocalAssistanceGuidedHighlightVideoSignalsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-signals.ts';
import { createAssistanceSourceTimeRowChunksV1 } from
	'../src/common/editor/assistance/source-time-rows-v1.ts';
import { gatherOwnedHighlightSignalsV1 } from
	'../src/common/editor/assistance/owned-highlight-workflow-transforms-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const SETTINGS = defaultAssistanceWorkflowSettingsV1('make-highlights') as Extract<
	AssistanceWorkflowSettingsV1, { readonly workflowId: 'make-highlights' }
>;

test('guided highlights create deterministic bounded windows from exact forward source time', () => {
	const result = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence', settings: SETTINGS,
	});
	assert.deepEqual(result, {
		schemaVersion: 1, kind: 'highlight-video-signals', sourceId: 'video-source',
		sampleRate: 1_000, timescale: 1_000, sourceSize: { width: 1_920, height: 1_080 },
		videoOccurrenceId: 'video-occurrence', audioOccurrenceId: 'audio-occurrence',
		selectionStartFrame: 10_000, selectionEndFrame: 40_000,
		reframeEvidence: null,
		sourceTimeAuthority: [
			{ sourceFrame: 10, presentationTick: '100', timelineFrame: 10_000 },
			{ sourceFrame: 25, presentationTick: '850', timelineFrame: 25_000 },
			{ sourceFrame: 50, presentationTick: '1700', timelineFrame: 40_000 },
		],
		windows: [
			{ id: 'highlight:121212121212:10:25', startFrame: 10_000, endFrame: 25_000,
				shotStructure: 0, visualInterest: 0 },
			{ id: 'highlight:121212121212:25:50', startFrame: 25_000, endFrame: 40_000,
				shotStructure: 0, visualInterest: 0 },
		],
	});
	assert.equal(Object.isFrozen(result.windows), true);
	assert.equal(Object.isFrozen(result.sourceTimeAuthority), true);
});

test('guided highlight audio scores real dynamics against the exact video windows', async () => {
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence', settings: SETTINGS,
	});
	const samples = new Float32Array(30 * 32_000);
	samples.fill(0.25, 0, 15 * 32_000);
	samples.fill(0, 15 * 32_000, 22.5 * 32_000);
	samples.fill(1, 22.5 * 32_000);
	const encoded = encodeWav([samples], {
		sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
	});
	const body = new Blob([encoded.slice().buffer], { type: 'audio/wav' });
	const result = await createLocalAssistanceGuidedHighlightAudioSignalsV1({
		body, video, signal: new AbortController().signal,
	});
	assert.deepEqual(result, { schemaVersion: 1, kind: 'highlight-audio-signals', signals: [
		{ candidateId: 'highlight:121212121212:10:25', energyDynamics: 0 },
		{ candidateId: 'highlight:121212121212:25:50', energyDynamics: 1 },
	] });
});

test('guided highlight signals reject stale geometry, inexact WAVs, and cancellation', async () => {
	assert.throws(() => createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: { ...sourceTimeAuthority(), frames: [
			sourceTimeAuthority().frames[0],
			{ ...sourceTimeAuthority().frames[1], timelineFrame: 10_000 },
			sourceTimeAuthority().frames[2],
		] }, audioOccurrenceId: 'audio-occurrence', settings: SETTINGS,
	}), /strictly forward|authority/iu);
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence', settings: SETTINGS,
	});
	const encoded = encodeWav([new Float32Array(32_000)], {
		sampleRate: 32_000, bitDepth: 32, float: true, dither: false,
	});
	const short = new Blob([encoded.slice().buffer], { type: 'audio/wav' });
	await assert.rejects(createLocalAssistanceGuidedHighlightAudioSignalsV1({
		body: short, video, signal: new AbortController().signal,
	}), /geometry|duration/iu);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(createLocalAssistanceGuidedHighlightAudioSignalsV1({
		body: short, video, signal: controller.signal,
	}), { name: 'AbortError' });
});

test('guided highlights preserve compact long source-time custody through owned gathering', () => {
	const sourceEndFrame = 100_001;
	const frames = createAssistanceSourceTimeRowChunksV1((function* () {
		for (let sourceFrame = 0; sourceFrame <= sourceEndFrame; sourceFrame += 1) {
			yield { sourceFrame, presentationTick: String(sourceFrame + 1),
				timelineFrame: sourceFrame * 1_000 };
		}
	})());
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({ authority: {
		...sourceTimeAuthority(), sourceStartFrame: 0, sourceEndFrame,
		selectionStartFrame: 0, selectionEndFrame: sourceEndFrame * 1_000, frames,
	}, audioOccurrenceId: null, settings: SETTINGS });
	assert.equal((video.sourceTimeAuthority[0] as { kind?: string }).kind, 'source-time-rows');
	const serialized = JSON.stringify(video);
	assert.ok(serialized.length < 4 * 1024 * 1024);
	const gathered = gatherOwnedHighlightSignalsV1({ video: JSON.parse(serialized), audio: null,
		transcript: null, 'shot-boundaries': null, 'audio-tags': null,
		'reaction-ranges': null, embeddings: null }, SETTINGS);
	assert.ok(gathered.candidates.length > 0);
	assert.equal(gathered.candidates[0]!.sourceStartFrame, 0);
});

function sourceTimeAuthority() {
	return {
		descriptorVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
		schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		projectId: 'project-a', projectRevision: 8, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
		sourceSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 10, sourceEndFrame: 50,
		sampleRate: 1_000, timescale: 1_000,
		selectionStartFrame: 10_000, selectionEndFrame: 40_000,
		frames: [
			{ sourceFrame: 10, presentationTick: '100', timelineFrame: 10_000 },
			{ sourceFrame: 25, presentationTick: '850', timelineFrame: 25_000 },
			{ sourceFrame: 50, presentationTick: '1700', timelineFrame: 40_000 },
		],
	};
}
