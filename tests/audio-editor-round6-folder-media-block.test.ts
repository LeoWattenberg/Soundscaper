/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackFolderService } from '../src/common/editor/controller/document/internal/track-folder-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoClip, createVideoSource,
	createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

const NOW = '2026-10-09T12:00:00.000Z';

for (const nested of [false, true]) for (const selection of [
	['audio'], ['video'], ['video', 'audio'], ['audio', 'video'],
]) test(`wrap ${selection.join('+')} preserves the camera block ${nested ? 'inside a folder' : 'at the root'}`, () => {
	let history = createSoundscaperProjectHistory(fixture(nested));
	const before = history.present;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	let commits = 0;
	const service = createTrackFolderService({ lifetime, getProject: () => history.present,
		editingBlocked: () => false, createId: () => 'wrapped', publishProjectState: () => {},
		commit: command => { history = executeSoundscaperProjectCommand(history, command, { now: NOW }); commits++; },
	});
	assert.equal(service.wrapTracksIntoFolder(selection), 'wrapped');
	assert.equal(commits, 1);
	assert.equal(history.undoStack.length, 1);
	const after = history.present;
	assert.deepEqual(after.sequences[0]!.trackNodes.map(({ id, parentFolderId }) => [id, parentFolderId]), [
		...(nested ? [['parent', null]] : []),
		['wrapped', nested ? 'parent' : null], ['video', 'wrapped'], ['audio', 'wrapped'],
		['music', null],
	]);
	assert.deepEqual(after.sources, before.sources);
	assert.deepEqual(after.clips, before.clips);
	assert.deepEqual(after.tracks, before.tracks);
	history = undoSoundscaperProjectCommand(history, { now: NOW });
	assert.deepEqual(history.present, { ...before, revision: history.present.revision });
	history = redoSoundscaperProjectCommand(history, { now: NOW });
	assert.deepEqual(history.present, { ...after, revision: history.present.revision });
});

function fixture(nested: boolean) {
	const picture = createVideoSource({ id: 'picture', frameCount: 48_000, sampleRate: 48_000,
		width: 96, height: 54, frameRate: 30, hasAudio: true });
	const recording = createAudioSource({ id: 'recording', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const clips = [createVideoClip({ id: 'picture-clip', sourceId: picture.id, durationFrames: 48_000,
		avLinkId: 'camera-link' }), createAudioClip({ id: 'recording-clip', sourceId: recording.id,
		durationFrames: 48_000, avLinkId: 'camera-link' })];
	return createSoundscaperProject({ id: 'folder-media-block', primarySequenceId: 'main', now: NOW,
		sources: [picture, recording], clips, tracks: [
			createVideoTrack({ id: 'video', laneGroupId: 'camera', clipIds: ['picture-clip'] }),
			createAudioTrack({ id: 'audio', laneGroupId: 'camera', clipIds: ['recording-clip'] }),
			createAudioTrack({ id: 'music', clipIds: [] }),
		], trackFolders: nested ? [{ id: 'parent', name: 'Parent' }] : [], sequences: [{ id: 'main', trackNodes: [
			...(nested ? [{ kind: 'folder' as const, id: 'parent', parentFolderId: null }] : []),
			{ kind: 'track', id: 'video', parentFolderId: nested ? 'parent' : null },
			{ kind: 'track', id: 'audio', parentFolderId: nested ? 'parent' : null },
			{ kind: 'track', id: 'music', parentFolderId: null },
		] }] });
}
