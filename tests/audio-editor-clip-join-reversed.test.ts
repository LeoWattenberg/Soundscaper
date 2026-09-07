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

const NOW = '2026-09-07T00:00:00.000Z';

function reversedClipProject(id: string, sourceStartFrame: number) {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	return createCurrentAudioEditorProject({
		id, now: NOW,
		sources: [source],
		clips: [
			createAudioClip({ id: 'clip', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 200,
				sourceStartFrame, sourceDurationFrames: 200, reversed: true }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['clip'] })],
	});
}

function splitThenJoin(project: ReturnType<typeof reversedClipProject>) {
	const split = applyEditorCommand(project, {
		type: 'clip/split', clipId: 'clip', atFrame: 100, rightClipId: 'right',
	}, { now: NOW });
	return applyEditorCommand(split, {
		type: 'clip/join', clipIds: ['clip', 'right'],
	}, { now: NOW });
}

test('splitting and rejoining a reversed clip restores its own source window', () => {
	const project = reversedClipProject('join-reversed-project', 400);
	const joined = splitThenJoin(project);
	assert.deepEqual(joined.clips.map(({
		id, timelineStartFrame, durationFrames, sourceStartFrame, sourceDurationFrames, reversed,
	}) => ({
		id, timelineStartFrame, durationFrames, sourceStartFrame, sourceDurationFrames, reversed,
	})), [{
		id: 'clip', timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 400, sourceDurationFrames: 200, reversed: true,
	}]);
});

test('rejoining a reversed clip at the source tail stays inside the source', () => {
	const project = reversedClipProject('join-reversed-tail-project', 800);
	const joined = splitThenJoin(project);
	assert.deepEqual(joined.clips.map(({ id, sourceStartFrame, sourceDurationFrames }) => ({
		id, sourceStartFrame, sourceDurationFrames,
	})), [{ id: 'clip', sourceStartFrame: 800, sourceDurationFrames: 200 }]);
});

test('joining forward clips keeps taking the source anchor from the first clip', () => {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const project = createCurrentAudioEditorProject({
		id: 'join-forward-project', now: NOW,
		sources: [source],
		clips: [
			createAudioClip({ id: 'left', sourceId: source.id,
				timelineStartFrame: 0, durationFrames: 100,
				sourceStartFrame: 400, sourceDurationFrames: 100 }),
			createAudioClip({ id: 'right', sourceId: source.id,
				timelineStartFrame: 100, durationFrames: 100,
				sourceStartFrame: 500, sourceDurationFrames: 100 }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: ['left', 'right'] })],
	});
	const joined = applyEditorCommand(project, {
		type: 'clip/join', clipIds: ['left', 'right'],
	}, { now: NOW });
	assert.deepEqual(joined.clips.map(({ id, sourceStartFrame, sourceDurationFrames }) => ({
		id, sourceStartFrame, sourceDurationFrames,
	})), [{ id: 'left', sourceStartFrame: 400, sourceDurationFrames: 200 }]);
});
