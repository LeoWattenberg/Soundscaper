/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * End-to-end proof of the podcast cleanup path: a recognition result becomes a
 * transcript, the transcript becomes reviewable proposals, and the accepted
 * proposals become one ordinary ripple-delete batch on a real project.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyEditorCommand,
	prepareDisjointRangeDeleteCommand,
} from '../src/common/editor/commands.js';
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	acceptedProposalFrames,
	acceptedProposalRanges,
	findDisfluencyProposals,
} from '../src/common/editor/assistance/disfluency.ts';
import { ingestRecognitionResult } from '../src/common/editor/assistance/transcript-ingest.ts';

const NOW = '2026-08-13T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const EN_FILLERS = ['um', 'uh'];

/** One take: "so um welcome uh everyone", then a long pause, then "let's begin". */
const RECOGNITION = Object.freeze({
	language: 'en',
	segments: [
		{
			startSeconds: 0,
			endSeconds: 5,
			words: [
				{ text: 'So', startSeconds: 0, endSeconds: 0.5 },
				{ text: 'um', startSeconds: 0.6, endSeconds: 1 },
				{ text: 'welcome', startSeconds: 1.1, endSeconds: 2 },
				{ text: 'uh', startSeconds: 2.1, endSeconds: 2.5 },
				{ text: 'everyone', startSeconds: 2.6, endSeconds: 5 },
			],
		},
		{
			startSeconds: 20,
			endSeconds: 22,
			words: [
				{ text: "let's", startSeconds: 20, endSeconds: 21 },
				{ text: 'begin', startSeconds: 21, endSeconds: 22 },
			],
		},
	],
});

function podcastProject() {
	const source = createAudioSourceV10({
		id: 'source', storageKey: 'source', name: 'Episode',
		frameCount: SAMPLE_RATE * 30, channelCount: 1, sampleRate: SAMPLE_RATE,
	});
	const clip = createAudioClipV10({
		id: 'clip', sourceId: source.id, title: 'Episode', anchor: 'sample',
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE * 30,
		sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE * 30,
	});
	return createCurrentAudioEditorProject({
		id: 'cleanup-project', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrackV10({ id: 'track', name: 'Dialogue', clipIds: ['clip'] })],
	});
}

/** The untyped command helpers and project records meet TypeScript here. */
function asCommand(value: unknown): AudioEditorCommand {
	return value as AudioEditorCommand;
}

function clipExtent(project: unknown): number {
	const { clips } = project as { clips: readonly { durationFrames: number }[] };
	return clips.reduce((total, clip) => total + clip.durationFrames, 0);
}

test('a recognition result becomes reviewable cleanup proposals', () => {
	const { transcript, conformedBoundaries } = ingestRecognitionResult(RECOGNITION, {
		sourceId: 'source', sampleRate: SAMPLE_RATE, modelId: 'parakeet-tdt-0.6b-v2',
	});

	const proposals = findDisfluencyProposals(transcript, {
		fillerLexicon: EN_FILLERS,
		minSilenceFrames: SAMPLE_RATE * 2,
		silencePaddingFrames: SAMPLE_RATE / 4,
	});

	assert.equal(conformedBoundaries, 0, 'the take needs no conforming');
	assert.deepEqual(proposals.map(({ kind, text }) => [kind, text]), [
		['filler', 'um'],
		['filler', 'uh'],
		['silence', ''],
	], 'both fillers and the long pause are offered, in timeline order');
});

test('accepting every proposal cuts exactly the offered frames and nothing else', () => {
	const project = podcastProject();
	const { transcript } = ingestRecognitionResult(RECOGNITION, {
		sourceId: 'source', sampleRate: SAMPLE_RATE, modelId: 'parakeet-tdt-0.6b-v2',
	});
	const proposals = findDisfluencyProposals(transcript, {
		fillerLexicon: EN_FILLERS,
		minSilenceFrames: SAMPLE_RATE * 2,
		silencePaddingFrames: SAMPLE_RATE / 4,
	});
	const ranges = acceptedProposalRanges(proposals, proposals.map(({ id }) => id));
	const removedFrames = acceptedProposalFrames(ranges);

	const command = asCommand(prepareDisjointRangeDeleteCommand(project, {
		ranges,
		trackIds: ['track'],
		rippleMode: 'track',
	}));
	const edited = applyEditorCommand(project, command, { now: NOW });

	assert.equal(command.type, 'batch', 'one batch carries every cut');
	assert.equal(
		clipExtent(edited),
		clipExtent(project) - removedFrames,
		'the programme shortens by exactly the accepted frames',
	);
});

test('accepting a subset leaves the rejected material in place', () => {
	const project = podcastProject();
	const { transcript } = ingestRecognitionResult(RECOGNITION, {
		sourceId: 'source', sampleRate: SAMPLE_RATE, modelId: 'parakeet-tdt-0.6b-v2',
	});
	const proposals = findDisfluencyProposals(transcript, {
		fillerLexicon: EN_FILLERS,
		minSilenceFrames: SAMPLE_RATE * 2,
	});
	const fillersOnly = proposals.filter(({ kind }) => kind === 'filler');
	const ranges = acceptedProposalRanges(proposals, fillersOnly.map(({ id }) => id));

	const edited = applyEditorCommand(
		project,
		asCommand(prepareDisjointRangeDeleteCommand(project, {
			ranges, trackIds: ['track'], rippleMode: 'track',
		})),
		{ now: NOW },
	);

	assert.equal(clipExtent(edited), clipExtent(project) - acceptedProposalFrames(ranges));
	assert.ok(
		acceptedProposalFrames(ranges) < acceptedProposalFrames(
			acceptedProposalRanges(proposals, proposals.map(({ id }) => id)),
		),
		'rejecting the silence keeps its frames',
	);
});

test('an accepted cleanup undoes in one step', () => {
	const project = podcastProject();
	const { transcript } = ingestRecognitionResult(RECOGNITION, {
		sourceId: 'source', sampleRate: SAMPLE_RATE, modelId: 'parakeet-tdt-0.6b-v2',
	});
	const proposals = findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS });
	const ranges = acceptedProposalRanges(proposals, proposals.map(({ id }) => id));

	const history = createEditorHistory(project);
	const executed = executeEditorCommand(
		history,
		asCommand(prepareDisjointRangeDeleteCommand(project, {
			ranges, trackIds: ['track'], rippleMode: 'track',
		})),
		{ now: NOW },
	);
	assert.ok(clipExtent(executed.present) < clipExtent(project));
	assert.equal(executed.undoStack.length, 1, 'the whole cleanup is one history entry');

	const undone = undoEditorCommand(executed, { now: NOW });
	assert.equal(
		clipExtent(undone.present),
		clipExtent(project),
		'one undo restores the whole cleanup, not one cut at a time',
	);
});

test('accepting nothing proposes no command at all', () => {
	const { transcript } = ingestRecognitionResult(RECOGNITION, {
		sourceId: 'source', sampleRate: SAMPLE_RATE, modelId: 'parakeet-tdt-0.6b-v2',
	});
	const proposals = findDisfluencyProposals(transcript, { fillerLexicon: EN_FILLERS });

	const ranges = acceptedProposalRanges(proposals, []);
	assert.deepEqual(ranges, []);
	assert.throws(
		() => prepareDisjointRangeDeleteCommand(podcastProject(), {
			ranges, trackIds: ['track'], rippleMode: 'track',
		}),
		/at least one delete range/iu,
		'an empty acceptance never reaches the document',
	);
});
