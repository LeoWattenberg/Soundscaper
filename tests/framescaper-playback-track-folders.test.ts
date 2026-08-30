/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackFolderV12 } from '../src/common/editor/track-folder-v12.ts';
import { createFramescaperPlaybackProjectService } from
	'../src/framescaper/editor-project-playback.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('Framescaper playback flattens inherited folder mute and hidden state', () => {
	const options = framescaperV20Options() as Record<string, unknown>;
	const sequences = options.sequences as Record<string, unknown>[];
	sequences[0] = {
		...sequences[0],
		trackNodes: [
			{ kind: 'folder', id: 'media-folder', parentFolderId: null },
			{ kind: 'track', id: 'video-track', parentFolderId: 'media-folder' },
			{ kind: 'track', id: 'audio-track', parentFolderId: null },
		],
	};
	options.trackFolders = [createTrackFolderV12({
		id: 'media-folder', name: 'Media', mute: true, hidden: true,
	})];
	const project = createFramescaperProject(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE, options as never,
	);
	const playback = createFramescaperPlaybackProjectService(FRAMESCAPER_PROJECT_RUNTIME_PROFILE)
		.projectForPlayback(project).project;
	const tracks = playback.tracks as readonly Readonly<Record<string, unknown>>[];
	assert.equal(tracks.find(({ id }) => id === 'video-track')?.hidden, true);
	assert.equal(project.tracks.find(({ id }) => id === 'video-track')?.hidden, false,
		'folder projection stays transient');
});
