/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Trimming an edge keeps the material inside the new bounds, so the gain over
 * that material has to stay what it was. Filtering the envelope to the points
 * that survive is not enough: the evaluator ramps up from unity before its first
 * point and holds its last one after it, so an edge dragged between two points
 * flattens the tail or starts the clip at full gain. The new edges have to carry
 * the value the envelope described there.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { applyEditorCommand, prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import {
	createAudioClip, createAudioSource, createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';

const NOW = '2026-08-29T12:00:00.000Z';
const DURATION = 1_000;
const ENVELOPE = Object.freeze([{ frame: 0, value: 0.2 }, { frame: DURATION, value: 0.8 }]);

function project(durationFrames = DURATION) {
	return createAudioEditorProjectV17({
		id: 'trim-envelope', title: 'Trim envelope', now: NOW,
		sources: [createAudioSource({
			id: 'source', storageKey: 'source', name: 'Tone',
			frameCount: DURATION, channelCount: 1, sampleRate: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio', clipIds: ['clip'] })],
		clips: [createAudioClip({
			id: 'clip', trackId: 'track', sourceId: 'source',
			timelineStartFrame: 0, durationFrames, sourceStartFrame: 0,
			sourceDurationFrames: durationFrames,
			envelope: ENVELOPE.filter((point) => point.frame <= durationFrames).map((point) => ({ ...point })),
		})],
		sequences: [{ id: 'main', trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
}

function transform(current: ReturnType<typeof project>, changes: Record<string, number>) {
	const command = prepareTransformClipsCommand(current, [{ clipId: 'clip', changes }]);
	const applied = applyEditorCommand(current, command as never, { now: NOW });
	const clip = applied.clips.find((candidate) => candidate.id === 'clip');
	assert.ok(clip, 'the trimmed clip survives');
	return clip;
}

/** Envelope frames are exact; interpolated values only have to be exact enough. */
function assertEnvelope(
	clip: ReturnType<typeof transform>,
	expected: readonly { frame: number; value: number }[],
) {
	const actual = (clip.envelope ?? []) as readonly { frame: number; value: number }[];
	assert.deepEqual(actual.map(({ frame }) => frame), expected.map(({ frame }) => frame));
	for (const [index, point] of expected.entries()) {
		assert.ok(
			Math.abs((actual[index]?.value ?? Number.NaN) - point.value) < 1e-12,
			`point ${index}: ${String(actual[index]?.value)} is not ${point.value}`,
		);
	}
}

/** Assert the retained material keeps the gain it had, mapping each frame back. */
function assertRetainedGain(
	clip: ReturnType<typeof transform>,
	original: readonly { frame: number; value: number }[],
	originalDuration: number,
	toOriginalFrame: (local: number) => number,
) {
	for (let local = 0; local <= (clip.durationFrames ?? 0); local += 1) {
		const before = envelopeValueAtFrame(original, toOriginalFrame(local), originalDuration);
		const after = envelopeValueAtFrame(clip.envelope ?? [], local, clip.durationFrames ?? 1);
		assert.ok(Math.abs(before - after) < 1e-9, `frame ${local}: ${before} became ${after}`);
	}
}

test('trimming the end keeps the gain over what the clip still holds', () => {
	const clip = transform(project(), { durationFrames: 500, sourceDurationFrames: 500 });

	assertEnvelope(clip, [{ frame: 0, value: 0.2 }, { frame: 500, value: 0.5 }]);
	assertRetainedGain(clip, ENVELOPE, DURATION, (local) => local);
});

test('trimming the start keeps the gain over what the clip still holds', () => {
	const clip = transform(project(), {
		timelineStartFrame: 500, durationFrames: 500, sourceStartFrame: 500, sourceDurationFrames: 500,
	});

	assertEnvelope(clip, [{ frame: 0, value: 0.5 }, { frame: 500, value: 0.8 }]);
	assertRetainedGain(clip, ENVELOPE, DURATION, (local) => local + 500);
});

test('trimming both edges carries both interpolated values', () => {
	const clip = transform(project(), {
		timelineStartFrame: 250, durationFrames: 500, sourceStartFrame: 250, sourceDurationFrames: 500,
	});

	assertEnvelope(clip, [{ frame: 0, value: 0.35 }, { frame: 500, value: 0.65 }]);
	assertRetainedGain(clip, ENVELOPE, DURATION, (local) => local + 250);
});

test('extending a clip leaves its envelope exactly as it was', () => {
	const shorter = project(500);
	const clip = transform(shorter, { durationFrames: DURATION, sourceDurationFrames: DURATION });

	assertEnvelope(clip, [{ frame: 0, value: 0.2 }]);
});
