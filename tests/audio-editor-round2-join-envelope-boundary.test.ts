/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { envelopeValueAtFrame } from '../src/common/editor/automation.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const NOW = '2026-10-06T12:00:00.000Z';
const leftPoint = [{ frame: 50, value: 0.5 }];
const rightPoint = [{ frame: 50, value: 1.5 }];

for (const [name, left, right] of [
	['left-only', leftPoint, []], ['right-only', [], rightPoint], ['unequal', leftPoint, rightPoint],
	['explicit seam', [{ frame: 0, value: 0.5 }, { frame: 100, value: 0.2 }],
		[{ frame: 0, value: 1.4 }, { frame: 100, value: 1.7 }]], ['unity', [], []],
] as const) test(`Join preserves every sampled gain across ${name} clip envelopes`, () => {
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording',
		frameCount: 200, channelCount: 1, sampleRate: 48_000 });
	const initial = createCurrentAudioEditorProject({ id: 'join-envelope', now: NOW, sources: [source],
		clips: [createAudioClip({ id: 'left', sourceId: source.id, timelineStartFrame: 0,
			durationFrames: 200, sourceStartFrame: 0, sourceDurationFrames: 200 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Recording', clipIds: ['left'] })] });
	const split = applyEditorCommand(initial, { type: 'clip/split', clipId: 'left', atFrame: 100, rightClipId: 'right' }, { now: NOW });
	const edited = applyEditorCommand(split, { type: 'batch', commands: [
		{ type: 'clip/update', clipId: 'left', changes: { envelope: left } },
		{ type: 'clip/update', clipId: 'right', changes: { envelope: right } },
	] }, { now: NOW });
	const joined = applyEditorCommand(edited, { type: 'clip/join', clipIds: ['left', 'right'] }, { now: NOW });
	const clip = joined.clips[0]!;
	if (name === 'unity') assert.deepEqual(clip.envelope, []);
	for (let frame = 0; frame < 200; frame += 1) {
		const expected = envelopeValueAtFrame(frame < 100 ? left : right, frame % 100, 100);
		assert.ok(Math.abs(envelopeValueAtFrame(clip.envelope, frame, 200) - expected) < 1e-12,
			`frame ${String(frame)} retains its independently authored gain`);
	}
});
