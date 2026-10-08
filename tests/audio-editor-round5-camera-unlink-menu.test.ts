/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperEditControlMenuItems, createFramescaperEditControlMenuModel }
	from '../src/common/editor/ui/framescaper-edit-control-menu-model.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const copy = { linkAudio: 'Link audio', unlinkAudio: 'Unlink audio', showVideo: 'Show video', hideVideo: 'Hide video' };
function cameraProject() {
	const fixture = createPersistedVideoProject({ timeline: true }).project;
	return createSoundscaperProject({ id: fixture.id, title: fixture.title, sampleRate: fixture.sampleRate,
		sources: fixture.sources, clips: fixture.clips,
		tracks: fixture.tracks.map(track => (track.type === 'audio' ? createAudioTrack : createVideoTrack)({
			id: track.id, name: track.name, clipIds: track.clipIds, laneGroupId: track.laneGroupId })) });
}
function input(project: unknown = cameraProject(), selectedClipId = 'persisted-timeline-audio', editBlocked = false) {
	return { productId: 'soundscaper', project, selectedClipId,
		selectedTrackId: 'persisted-audio-track', editBlocked, copy };
}

test('Soundscaper linked camera audio exposes only its existing Unlink action', () => {
	const model = createFramescaperEditControlMenuModel(input());
	assert.deepEqual(model.link, { id: 'video-linked-audio', label: 'Unlink audio', disabled: false,
		operation: { kind: 'unlink', clipId: 'persisted-timeline-audio' } });
	assert.equal(model.visibility, null);
	const calls: string[] = [];
	const items = createFramescaperEditControlMenuItems(input(), {
		link: () => { assert.fail('Soundscaper must not admit the Framescaper Link action'); },
		unlink: id => { calls.push(id); }, setVideoHidden: () => { assert.fail('unsupported visibility action'); },
	});
	assert.equal(items.link?.documentationId, 'video-unlink-audio');
	items.link?.onClick();
	assert.deepEqual(calls, ['persisted-timeline-audio']);
});

test('Soundscaper keeps picture controls, unlinked companions and foreign projects out of this recovery menu', () => {
	const project = cameraProject();
	for (const request of [input(project, 'persisted-timeline-video'), input({ ...project,
		clips: project.clips.map(clip => ({ ...clip, avLinkId: null })) }),
		input(createPersistedVideoProject({ timeline: true }).project), input(null)]) {
		assert.deepEqual(createFramescaperEditControlMenuModel(request), { link: null, visibility: null });
	}
});

test('Soundscaper blocks Unlink during a mutation without dispatching the controller action', () => {
	const items = createFramescaperEditControlMenuItems(input(cameraProject(), 'persisted-timeline-audio', true), {
		link: () => { assert.fail('unexpected Link'); }, unlink: () => { assert.fail('blocked Unlink'); },
		setVideoHidden: () => { assert.fail('unexpected visibility'); },
	});
	assert.equal(items.link?.disabled, true);
	items.link?.onClick();
	assert.equal(items.visibility, null);
});
