/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Splitting is a cut, not an edit: the two halves played back to back have to
 * sound exactly like the clip did. A gain envelope is the part that is easy to
 * lose, because a segment inherits only the points that fall inside it and the
 * evaluator supplies its own values outside them - it ramps up from unity before
 * the first point and holds the last one after it. A cut between two points
 * therefore has to carry the interpolated boundary values with it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { prepareSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import {
	createAudioClip, createAudioSource, createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const DURATION = 1_000;
const SPLIT = 500;

interface EnvelopePoint { readonly frame: number; readonly value: number }

function projectWith(envelope: readonly EnvelopePoint[], fades = true) {
	return createAudioEditorProjectV17({
		id: 'split-envelope',
		title: 'Split envelope',
		now: NOW,
		sources: [createAudioSource({
			id: 'source', storageKey: 'source', name: 'Tone',
			frameCount: DURATION, channelCount: 1, sampleRate: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio', clipIds: ['clip'] })],
		clips: [createAudioClip({
			id: 'clip',
			trackId: 'track',
			sourceId: 'source',
			timelineStartFrame: 0,
			durationFrames: DURATION,
			sourceStartFrame: 0,
			envelope: envelope.map((point) => ({ ...point })),
			...(fades ? { fadeInFrames: 200, fadeOutFrames: 200 } : {}),
		})],
		sequences: [{ id: 'main', trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
}

/** The gain the engine schedules for one timeline frame, envelope and fades together. */
function gainAt(current: ReturnType<typeof projectWith>, timelineFrame: number): number {
	const clip = current.clips.find((candidate) => (
		timelineFrame >= candidate.timelineStartFrame
		&& timelineFrame < candidate.timelineStartFrame + candidate.durationFrames
	));
	assert.ok(clip, `no clip covers timeline frame ${timelineFrame}`);
	const local = timelineFrame - clip.timelineStartFrame;
	const envelope = Math.max(0, Number(clip.gain ?? 1))
		* envelopeValueAtFrame(clip.envelope ?? [], local, clip.durationFrames);
	const fadeIn = clip.fadeInFrames > 0 && local < clip.fadeInFrames ? local / clip.fadeInFrames : 1;
	const fadeOut = clip.fadeOutFrames > 0 && local > clip.durationFrames - clip.fadeOutFrames
		? (clip.durationFrames - local) / clip.fadeOutFrames
		: 1;
	return envelope * fadeIn * fadeOut;
}

function split(current: ReturnType<typeof projectWith>) {
	return applyEditorCommand(current, prepareSplitCommand('clip', SPLIT, () => 'right-clip'), { now: NOW });
}

test('a split between two envelope points leaves the scheduled gain unchanged', () => {
	const before = projectWith([{ frame: 0, value: 0.2 }, { frame: DURATION, value: 0.8 }]);
	const after = split(before);

	for (let frame = 0; frame < DURATION; frame += 1) {
		assert.ok(
			Math.abs(gainAt(before, frame) - gainAt(after, frame)) < 1e-9,
			`frame ${frame}: ${gainAt(before, frame)} became ${gainAt(after, frame)}`,
		);
	}
});

test('both halves carry the interpolated value at the cut', () => {
	const after = split(projectWith([{ frame: 0, value: 0.2 }, { frame: DURATION, value: 0.8 }], false));
	const left = after.clips.find((clip) => clip.id === 'clip');
	const right = after.clips.find((clip) => clip.id === 'right-clip');

	assert.deepEqual(left?.envelope, [{ frame: 0, value: 0.2 }, { frame: 500, value: 0.5 }]);
	assert.deepEqual(right?.envelope, [{ frame: 0, value: 0.5 }, { frame: 500, value: 0.8 }]);
});

test('a cut that lands on a point neither duplicates nor drops it', () => {
	const points = [{ frame: 0, value: 0.4 }, { frame: SPLIT, value: 0.9 }, { frame: DURATION, value: 0.1 }];
	const before = projectWith(points, false);
	const after = split(before);

	assert.deepEqual(after.clips.find((clip) => clip.id === 'clip')?.envelope, [
		{ frame: 0, value: 0.4 }, { frame: 500, value: 0.9 },
	]);
	assert.deepEqual(after.clips.find((clip) => clip.id === 'right-clip')?.envelope, [
		{ frame: 0, value: 0.9 }, { frame: 500, value: 0.1 },
	]);
	for (let frame = 0; frame < DURATION; frame += 1) {
		assert.ok(Math.abs(gainAt(before, frame) - gainAt(after, frame)) < 1e-9, `frame ${frame} changed`);
	}
});

test('a clip without envelope points keeps its empty envelope through a split', () => {
	const after = split(projectWith([], false));
	assert.deepEqual(after.clips.find((clip) => clip.id === 'clip')?.envelope, []);
	assert.deepEqual(after.clips.find((clip) => clip.id === 'right-clip')?.envelope, []);
});
