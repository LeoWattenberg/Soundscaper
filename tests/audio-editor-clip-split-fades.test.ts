/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A fade belongs to the clip edge it was drawn from, so a cut inside a fade
 * leaves it on the half that still owns that edge: the fade-in stays left, the
 * fade-out stays right, and a half whose new edge is the cut carries no fade at
 * all. Cutting inside both fades therefore leaves the first clip fading in, the
 * last fading out, and the middle one with neither.
 *
 * The kept fade is shortened to its half, which is not the gain the clip had
 * across the cut - the model cannot express a ramp that begins part way up. That
 * is a deliberate choice over widening the fade model, and this test holds it in
 * place so it stays one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { prepareSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import {
	createAudioClip, createAudioSource, createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const DURATION = 1_000;
const FADE = 200;

function project() {
	return createAudioEditorProjectV17({
		id: 'split-fades',
		title: 'Split fades',
		now: NOW,
		sources: [createAudioSource({
			id: 'source', storageKey: 'source', name: 'Tone',
			frameCount: DURATION, channelCount: 1, sampleRate: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio', clipIds: ['clip'] })],
		clips: [createAudioClip({
			id: 'clip', trackId: 'track', sourceId: 'source',
			timelineStartFrame: 0, durationFrames: DURATION, sourceStartFrame: 0,
			fadeInFrames: FADE, fadeOutFrames: FADE,
		})],
		sequences: [{ id: 'main', trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
}

function splitAt(current: ReturnType<typeof project>, clipId: string, frame: number, rightId: string) {
	const command = prepareSplitCommand(clipId, frame, () => rightId) as (
		ReturnType<typeof prepareSplitCommand> & { readonly type: 'clip/split' }
	);
	return applyEditorCommand(current, command, { now: NOW });
}

function fadesOf(current: ReturnType<typeof project>, clipId: string) {
	const clip = current.clips.find((candidate) => candidate.id === clipId);
	assert.ok(clip, `clip ${clipId} exists`);
	return {
		start: clip.timelineStartFrame,
		frames: clip.durationFrames,
		fadeIn: clip.fadeInFrames,
		fadeOut: clip.fadeOutFrames,
	};
}

test('a cut inside the fade-in leaves the fade on the left half', () => {
	const after = splitAt(project(), 'clip', 100, 'right-clip');

	assert.deepEqual(fadesOf(after, 'clip'), { start: 0, frames: 100, fadeIn: 100, fadeOut: 0 });
	assert.deepEqual(fadesOf(after, 'right-clip'), { start: 100, frames: 900, fadeIn: 0, fadeOut: FADE });
});

test('a cut inside the fade-out leaves the fade on the right half', () => {
	const after = splitAt(project(), 'clip', 900, 'right-clip');

	assert.deepEqual(fadesOf(after, 'clip'), { start: 0, frames: 900, fadeIn: FADE, fadeOut: 0 });
	assert.deepEqual(fadesOf(after, 'right-clip'), { start: 900, frames: 100, fadeIn: 0, fadeOut: 100 });
});

test('cutting inside both fades leaves the middle clip with neither', () => {
	const after = splitAt(splitAt(project(), 'clip', 100, 'middle'), 'middle', 900, 'last');

	assert.deepEqual(fadesOf(after, 'clip'), { start: 0, frames: 100, fadeIn: 100, fadeOut: 0 });
	assert.deepEqual(fadesOf(after, 'middle'), { start: 100, frames: 800, fadeIn: 0, fadeOut: 0 });
	assert.deepEqual(fadesOf(after, 'last'), { start: 900, frames: 100, fadeIn: 0, fadeOut: 100 });
});

test('a cut clear of both fades keeps each fade whole on its own half', () => {
	const after = splitAt(project(), 'clip', 500, 'right-clip');

	assert.deepEqual(fadesOf(after, 'clip'), { start: 0, frames: 500, fadeIn: FADE, fadeOut: 0 });
	assert.deepEqual(fadesOf(after, 'right-clip'), { start: 500, frames: 500, fadeIn: 0, fadeOut: FADE });
});
