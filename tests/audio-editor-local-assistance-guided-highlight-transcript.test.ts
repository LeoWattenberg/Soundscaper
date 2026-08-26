/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceGuidedHighlightTranscriptSignalsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-transcript.ts';
import {
	createLocalAssistanceGuidedHighlightVideoSignalsV1,
} from '../src/common/editor/controller/local-assistance-guided-highlight-signals.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';

test('guided highlights rebase only authenticated in-range transcript evidence onto windows', async () => {
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence',
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
	});
	const transcript = {
		schemaVersion: 1, sourceId: 'audio-source', sampleRate: 1_000,
		language: 'en', modelId: 'whisper-small', segments: [
			segment(100, 1_000, 'outside edge', null),
			segment(10_500, 15_000, 'Why does this opening work?', 'speaker-1'),
			segment(25_000, 30_000, 'Because the payoff is complete.', 'speaker-2'),
		],
	};
	const mediaType = 'application/vnd.soundscaper.transcript+json';
	const result = await createLocalAssistanceGuidedHighlightTranscriptSignalsV1({
		body: new Blob([JSON.stringify(transcript)], { type: mediaType }),
		video, audioSourceId: 'audio-source', audioSourceStartFrame: 10_000,
		audioSourceEndFrame: 40_000, signal: new AbortController().signal,
	});
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.kind, 'highlight-transcript-signals');
	assert.equal(result.sourceTimelineStartFrame, 10_000);
	assert.deepEqual(result.transcript.segments.map(({ startFrame, endFrame, text }) => ({
		startFrame, endFrame, text,
	})), [
		{ startFrame: 500, endFrame: 5_000, text: 'Why does this opening work?' },
		{ startFrame: 15_000, endFrame: 20_000, text: 'Because the payoff is complete.' },
	]);
	assert.deepEqual(result.signals.map(({ candidateId }) => candidateId),
		video.windows.map(({ id }) => id));
	for (const signal of result.signals) {
		assert.ok(signal.hook >= 0 && signal.hook <= 1);
		assert.ok(signal.conversationalStructure >= 0 && signal.conversationalStructure <= 1);
		assert.ok(signal.semanticSelfContainedness >= 0
			&& signal.semanticSelfContainedness <= 1);
	}
	assert.equal(Object.isFrozen(result.transcript.segments), true);
});

test('guided highlight transcript evidence never invents signals for empty windows', async () => {
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence',
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
	});
	const transcript = { schemaVersion: 1, sourceId: 'audio-source', sampleRate: 1_000,
		language: null, modelId: 'parakeet', segments: [] };
	const result = await createLocalAssistanceGuidedHighlightTranscriptSignalsV1({
		body: new Blob([JSON.stringify(transcript)], {
			type: 'application/vnd.soundscaper.transcript+json',
		}), video, audioSourceId: 'audio-source', audioSourceStartFrame: 10_000,
		audioSourceEndFrame: 40_000, signal: new AbortController().signal,
	});
	assert.deepEqual(result.signals, []);
	assert.deepEqual(result.transcript.segments, []);
});

test('guided highlight transcript evidence refuses source mismatch and cancellation', async () => {
	const video = createLocalAssistanceGuidedHighlightVideoSignalsV1({
		authority: sourceTimeAuthority(), audioOccurrenceId: 'audio-occurrence',
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
	});
	const body = new Blob([JSON.stringify({ schemaVersion: 1, sourceId: 'other-source',
		sampleRate: 1_000, language: null, modelId: 'parakeet', segments: [] })], {
		type: 'application/vnd.soundscaper.transcript+json',
	});
	await assert.rejects(createLocalAssistanceGuidedHighlightTranscriptSignalsV1({
		body, video, audioSourceId: 'audio-source', audioSourceStartFrame: 10_000,
		audioSourceEndFrame: 40_000, signal: new AbortController().signal,
	}), /source|authority/iu);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(createLocalAssistanceGuidedHighlightTranscriptSignalsV1({
		body, video, audioSourceId: 'audio-source', audioSourceStartFrame: 10_000,
		audioSourceEndFrame: 40_000, signal: controller.signal,
	}), { name: 'AbortError' });
});

function segment(startFrame: number, endFrame: number, text: string, speaker: string | null) {
	return { startFrame, endFrame, text, speaker, words: [{ text: text.split(' ')[0]!,
		startFrame, endFrame: startFrame + 100, confidence: 0.9 }] };
}

function sourceTimeAuthority() {
	return {
		schemaVersion: 1 as const, kind: 'selected-video-source-time-authority' as const,
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
