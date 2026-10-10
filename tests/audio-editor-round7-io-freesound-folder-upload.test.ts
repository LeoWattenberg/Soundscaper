/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAddTrackFolderCommand, createMoveTrackNodeCommand, createUpdateTrackFolderCommand } from '../src/common/editor/commands/factories.ts';
import { createIsolatedFreesoundClipRenderProject } from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

for (const folder of [false, true, 'muted'] as const) test(`normal ${folder === 'muted' ? 'muted-folder' : folder ? 'folder-owned' : 'ungrouped'} Freesound clip projection loads in the actual renderer`, async () => {
	const source = createAudioSource({ id: 'voice-source', storageKey: 'voice-pcm', name: 'Voice.wav',
		frameCount: 4_800, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 4_800, sourceDurationFrames: 4_800 });
	let project = createSoundscaperProject({ id: 'voice-project', sources: [source], clips: [clip], tracks: [
		createAudioTrack({ id: 'empty', name: 'Track 1' }),
		createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] }),
	] });
	if (folder) {
		project = applySoundscaperProjectCommand(project, createAddTrackFolderCommand('main-sequence', { id: 'dialogue', name: 'Dialogue' }));
		project = applySoundscaperProjectCommand(project, createMoveTrackNodeCommand('main-sequence', 'voice', 'dialogue', 0));
		if (folder === 'muted') project = applySoundscaperProjectCommand(project, createUpdateTrackFolderCommand('dialogue', { mute: true }));
	}
	assert.equal(validateSoundscaperProject(project), true);
	const original = structuredClone(project);
	const isolated = createIsolatedFreesoundClipRenderProject(project, clip.id);
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	try {
		assert.doesNotThrow(() => { engine.loadProject(project, new Map()); });
		assert.doesNotThrow(() => { engine.loadProject(isolated, new Map()); });
		assert.deepEqual(isolated.tracks.map(({ id }) => id), ['voice']);
		assert.equal(isolated.tracks[0]?.mute, false);
		assert.deepEqual(project, original);
	} finally {
		await engine.dispose();
	}
});
