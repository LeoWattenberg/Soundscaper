/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAddClipCommand, prepareSplitCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-09-22T00:00:00.000Z';

function project() {
	return createSoundscaperProject({
		id: 'microfades', sampleRate: 48_000, now: NOW,
		sources: [createAudioSource({
			id: 'source', storageKey: 'source', name: 'Source', frameCount: 48_000,
			channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		})],
		tracks: [createAudioTrack({ id: 'track', name: 'Audio' })],
	});
}

const CLIP = createAddClipCommand('track', {
	id: 'clip', sourceId: 'source', durationFrames: 24_000, sourceDurationFrames: 24_000,
});

test('Soundscaper applies the preference to imported and split clips', () => {
	const initial = project();
	const created = applySoundscaperProjectCommand(initial, CLIP, {
		now: NOW, microfadeNewClips: true,
	});
	assert.equal(created.clips[0].fadeInFrames, 96);
	assert.equal(created.clips[0].fadeOutFrames, 96);
	const split = applySoundscaperProjectCommand(created, prepareSplitCommand('clip', 12_000, () => 'right') as AudioEditorCommand, {
		now: NOW, microfadeNewClips: true,
	});
	assert.deepEqual(split.clips.map(({ fadeInFrames, fadeOutFrames }) => [fadeInFrames, fadeOutFrames]), [
		[96, 96], [96, 96],
	]);
});

test('Soundscaper leaves new clips unfaded when the preference is off', () => {
	const created = applySoundscaperProjectCommand(project(), CLIP, {
		now: NOW, microfadeNewClips: false,
	});
	assert.equal(created.clips[0].fadeInFrames, 0);
	assert.equal(created.clips[0].fadeOutFrames, 0);
});
