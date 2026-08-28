/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createIsolatedTrackRenderProjectV21 } from '../src/common/editor/controller/isolated-track-render-project-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * Rendering one track in isolation must work for a track that lives in a folder.
 *
 * Effect preview, effect apply, macros, and split/join stereo all render a single
 * track through an engine-only projection that narrows `tracks` to the target.
 * The folder hierarchy came along untouched in that projection, so the sequence
 * still claimed nodes for tracks the projection no longer had, and the engine's
 * own folder-media derivation refused the document: "project.tracks must contain
 * every track in exact hierarchy preorder".
 *
 * Folders are created from the track menu and effects are applied from the effect
 * menu, so no unusual state is needed to reach this — only both features in the
 * same project, which is why no single-feature test covers it. The sibling mix
 * render already flattens the folder state and inherits the projection before
 * narrowing, and this is the same rule applied to the isolated render.
 */

const NOW = '2026-08-19T12:00:00.000Z';

test('an isolated single-track render projection loads for a track inside a folder', async () => {
	const project = projectWithFolder();
	const isolated = createIsolatedTrackRenderProjectV21(project as never, {
		trackId: 'voice', effects: [], clipIds: null,
	});

	assert.deepEqual(isolated.tracks.map(({ id }) => id), ['voice']);
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	try {
		assert.doesNotThrow(() => { engine.loadProject(project, new Map()); });
		assert.doesNotThrow(() => { engine.loadProject(isolated, new Map()); });
	} finally {
		await engine.dispose();
	}
});

test('the isolated render neutralizes the folder audibility it inherited', () => {
	const isolated = createIsolatedTrackRenderProjectV21(mutedFolderProject() as never, {
		trackId: 'voice', effects: [], clipIds: null,
	});
	const track = isolated.tracks[0] as unknown as Record<string, unknown>;
	// The render is explicitly pre-master and mute/solo-blind, so a folder that
	// mutes its children must not silence the track being rendered from it.
	assert.equal(track.mute, false);
	assert.equal(track.solo, false);
	assert.equal(track.gain, 1);
});

function projectWithFolder() {
	return createSoundscaperProject(projectOptions({ folderMuted: false }));
}

function mutedFolderProject() {
	return createSoundscaperProject(projectOptions({ folderMuted: true }));
}

function projectOptions({ folderMuted }: { folderMuted: boolean }) {
	const source = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	return {
		id: 'isolated-render-project', title: 'Isolated render', now: NOW,
		sources: [source], clips: [clip],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id], effects: [] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: [], effects: [] }),
		],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: folderMuted }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main-sequence',
	};
}
