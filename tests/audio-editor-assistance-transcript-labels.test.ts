/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAssistanceTranscript } from '../src/common/editor/assistance/transcript.ts';
import { planTranscriptLabelCommands } from '../src/common/editor/assistance/transcript-labels.ts';

function transcriptOf(segments: readonly { startFrame: number; endFrame: number; text: string; speaker?: string }[]) {
	return createAssistanceTranscript({
		sourceId: 'source-1',
		sampleRate: 48_000,
		modelId: 'parakeet-tdt-0.6b-v2',
		segments,
	});
}

test('a transcript plans one label per segment on a new track', () => {
	const transcript = transcriptOf([
		{ startFrame: 0, endFrame: 48_000, text: 'Hello there' },
		{ startFrame: 48_000, endFrame: 96_000, text: 'And welcome' },
	]);

	const plan = planTranscriptLabelCommands(transcript, {
		createTrackId: () => 'label-track-1',
		trackName: 'Transcript',
	});

	assert.equal(plan.createdTrack, true);
	assert.equal(plan.targetTrackId, 'label-track-1');
	assert.equal(plan.labelCount, 2);
	assert.equal(plan.commands.length, 3, 'one track command plus one per segment');
});

test('an existing label track is appended to rather than duplicated', () => {
	const transcript = transcriptOf([{ startFrame: 0, endFrame: 1_000, text: 'Hello' }]);

	const plan = planTranscriptLabelCommands(transcript, { targetTrackId: 'existing-track' });

	assert.equal(plan.createdTrack, false);
	assert.equal(plan.targetTrackId, 'existing-track');
	assert.equal(plan.commands.length, 1);
});

test('the planned batch commits through the ordinary command path', () => {
	const project = createCurrentAudioEditorProject({ title: 'Assistance' });
	const transcript = transcriptOf([
		{ startFrame: 0, endFrame: 48_000, text: 'Hello there', speaker: 'Speaker 1' },
		{ startFrame: 96_000, endFrame: 144_000, text: 'And welcome' },
	]);

	const plan = planTranscriptLabelCommands(transcript, { createTrackId: () => 'label-track-1' });
	const committed = applyEditorCommand(project, { type: 'batch' as const, commands: plan.commands });

	const track = committed.tracks.find((candidate) => candidate.id === 'label-track-1') as unknown as {
		type: string;
		labels: readonly { title: string; startFrame: number; endFrame: number }[];
	} | undefined;
	assert.ok(track, 'the batch created the label track it planned');
	assert.equal(track.type, 'label');
	assert.deepEqual(
		track.labels.map(({ title, startFrame, endFrame }) => [title, startFrame, endFrame]),
		[
			['Speaker 1: Hello there', 0, 48_000],
			['And welcome', 96_000, 144_000],
		],
		'speakers ride the label title and frames survive the commit exactly',
	);
});

test('replaying the recorded batch reproduces the same document', () => {
	const project = createCurrentAudioEditorProject({ title: 'Assistance' });
	const transcript = transcriptOf([{ startFrame: 0, endFrame: 1_000, text: 'Hello' }]);
	const plan = planTranscriptLabelCommands(transcript, { createTrackId: () => 'label-track-1' });
	const command = { type: 'batch' as const, commands: plan.commands };

	const first = applyEditorCommand(project, command);
	const second = applyEditorCommand(project, JSON.parse(JSON.stringify(command)));

	assert.deepEqual(second.tracks, first.tracks, 'every id the batch needs is decided during planning');
});

test('a plan refuses inputs it cannot author deterministically', () => {
	const transcript = transcriptOf([{ startFrame: 0, endFrame: 1_000, text: 'Hello' }]);

	assert.throws(() => planTranscriptLabelCommands(transcript), /needs an id factory/iu);
	assert.throws(
		() => planTranscriptLabelCommands(transcript, { createTrackId: () => '' }),
		/must be a non-empty string/iu,
	);
});
