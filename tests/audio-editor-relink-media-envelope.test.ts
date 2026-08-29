/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Relinking Project Bin media to a shorter file truncates the clips that used
 * it. Dropping the envelope points past the new end is not enough on its own:
 * the evaluator holds the last surviving point after it, so the material that
 * is kept would play at that value instead of continuing toward the point the
 * truncation removed. The new end has to keep the value the envelope described.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip, createAudioSource, createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const OLD_FRAMES = 1_000;
const NEW_FRAMES = 500;
const ENVELOPE = [{ frame: 0, value: 0.2 }, { frame: OLD_FRAMES, value: 0.8 }];

function relinkedProject() {
	const project = createAudioEditorProjectV17({
		id: 'relink-envelope', title: 'Relink envelope', now: NOW,
		sources: [
			createAudioSource({
				id: 'source-old', storageKey: 'old', name: 'Old',
				frameCount: OLD_FRAMES, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'source-new', storageKey: 'new', name: 'New',
				frameCount: NEW_FRAMES, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio', clipIds: ['clip'] })],
		clips: [createAudioClip({
			id: 'clip', trackId: 'track', sourceId: 'source-old',
			timelineStartFrame: 0, durationFrames: OLD_FRAMES, sourceStartFrame: 0,
			envelope: ENVELOPE.map((point) => ({ ...point })),
		})],
		projectBin: {
			clips: [createAudioClip({
				id: 'bin-clip', sourceId: 'source-old', binItemId: 'bin-clip',
				timelineStartFrame: 0, durationFrames: OLD_FRAMES, sourceStartFrame: 0,
				envelope: ENVELOPE.map((point) => ({ ...point })),
			})],
		},
		sequences: [{ id: 'main', trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
	return applyEditorCommand(project, {
		type: 'project-bin/replace-media',
		clipId: 'bin-clip',
		shortfallMode: 'keep-spacing',
		replacements: [{ oldSourceId: 'source-old', newSourceId: 'source-new' }],
		templates: [createAudioClip({
			id: 'bin-replacement', sourceId: 'source-new', binItemId: 'bin-replacement',
			timelineStartFrame: 0, durationFrames: NEW_FRAMES, sourceStartFrame: 0,
		})],
	}, { now: NOW });
}

test('a timeline clip relinked to shorter media keeps the gain over what it retained', () => {
	const clip = relinkedProject().clips.find((candidate) => candidate.id === 'clip');

	assert.equal(clip?.durationFrames, NEW_FRAMES);
	assert.deepEqual(clip?.envelope, [{ frame: 0, value: 0.2 }, { frame: NEW_FRAMES, value: 0.5 }]);
	for (let frame = 0; frame <= NEW_FRAMES; frame += 1) {
		const before = envelopeValueAtFrame(ENVELOPE, frame, OLD_FRAMES);
		const after = envelopeValueAtFrame(clip?.envelope ?? [], frame, NEW_FRAMES);
		assert.ok(Math.abs(before - after) < 1e-9, `frame ${frame}: ${before} became ${after}`);
	}
});

test('the bin clip the replacement rewrites keeps its own retained gain', () => {
	const binClip = relinkedProject().projectBin.clips.find((candidate) => candidate.id === 'bin-clip');

	assert.equal(binClip?.durationFrames, NEW_FRAMES);
	assert.deepEqual(binClip?.envelope, [{ frame: 0, value: 0.2 }, { frame: NEW_FRAMES, value: 0.5 }]);
});
