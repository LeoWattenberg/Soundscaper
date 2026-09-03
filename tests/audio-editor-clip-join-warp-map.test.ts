/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';

test('joining cannot discard a later clip audio warp map', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'join-warp-project', now: '2026-08-31T00:00:00.000Z',
		sources: [source],
		clips: [
			createAudioClip({ id: 'plain', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 0, sourceDurationFrames: 100 }),
			createAudioClip({ id: 'warped', sourceId: source.id,
				timelineStartFrame: 100, durationFrames: 100,
				sourceStartFrame: 100, sourceDurationFrames: 200,
				warpMap: { feature: 'audio-warp', points: [
					{ outer: 0, source: 100, mode: 'forward' },
					{ outer: 100, source: 300, mode: 'forward' },
				] } }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['plain', 'warped'] })],
	});
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/join', clipIds: ['plain', 'warped'],
	}, { now: '2026-08-31T00:00:00.000Z' }), /processing|render/iu);
});

test('joining refuses two adjacent clips whose polarity disagrees', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'join-polarity-project', now: '2026-09-03T00:00:00.000Z',
		sources: [source],
		clips: [
			createAudioClip({ id: 'upright', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 0, sourceDurationFrames: 100 }),
			createAudioClip({ id: 'inverted', sourceId: source.id,
				timelineStartFrame: 100, durationFrames: 100,
				sourceStartFrame: 100, sourceDurationFrames: 100, inverted: true }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['upright', 'inverted'] })],
	});
	assert.throws(() => applyEditorCommand(project, {
		type: 'clip/join', clipIds: ['upright', 'inverted'],
	}, { now: '2026-09-03T00:00:00.000Z' }), /processing|render/iu);

	const matching = createCurrentAudioEditorProject({
		id: 'join-matching-polarity-project', now: '2026-09-03T00:00:00.000Z',
		sources: [source],
		clips: [
			createAudioClip({ id: 'left', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 0, sourceDurationFrames: 100, inverted: true }),
			createAudioClip({ id: 'right', sourceId: source.id,
				timelineStartFrame: 100, durationFrames: 100,
				sourceStartFrame: 100, sourceDurationFrames: 100, inverted: true }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['left', 'right'] })],
	});
	const joined = applyEditorCommand(matching, {
		type: 'clip/join', clipIds: ['left', 'right'],
	}, { now: '2026-09-03T00:00:00.000Z' });
	assert.deepEqual(joined.clips.map(({ id, durationFrames, inverted }) => ({
		id, durationFrames, inverted,
	})), [{ id: 'left', durationFrames: 200, inverted: true }]);
});
