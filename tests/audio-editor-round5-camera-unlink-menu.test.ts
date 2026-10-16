/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperEditControlMenuItems, createFramescaperEditControlMenuModel }
	from '../src/common/editor/ui/framescaper-edit-control-menu-model.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';
import { createFramescaperEditControlMenuItems as createSoundscaperEditControls }
	from '../src/soundscaper/editor-application-menu-product-runtime.js';

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

test('the shipped Soundscaper menu alias retains linked-audio recovery and excludes picture actions', () => {
	const calls: string[] = [];
	const actions = { link: () => { assert.fail('unsupported Link'); }, unlink: (id: string) => { calls.push(id); },
		setVideoHidden: () => { assert.fail('unsupported visibility'); } };
	const items = createSoundscaperEditControls(input(), actions);
	assert.equal(items.link?.label, 'Unlink audio');
	assert.equal(items.link?.disabled, false);
	assert.equal(items.visibility, null);
	items.link?.onClick();
	assert.deepEqual(calls, ['persisted-timeline-audio']);
	assert.deepEqual(createSoundscaperEditControls(input(cameraProject(), 'persisted-timeline-video'), actions),
		{ link: null, visibility: null });
});

test('Soundscaper keeps picture controls, unlinked companions and foreign projects out of this recovery menu', () => {
	const project = cameraProject();
	for (const request of [input(project, 'persisted-timeline-video'), input({ ...project,
		clips: project.clips.map(clip => ({ ...clip, avLinkId: null })) }),
		input(createPersistedVideoProject({ timeline: true }).project), input(null)]) {
		assert.deepEqual(createFramescaperEditControlMenuModel(request), { link: null, visibility: null });
		assert.deepEqual(createSoundscaperEditControls(request, { unlink: () => assert.fail('unsupported Unlink') }),
			{ link: null, visibility: null });
	}
});

test('Soundscaper blocks Unlink during a mutation without dispatching the controller action', () => {
	for (const createItems of [createFramescaperEditControlMenuItems, createSoundscaperEditControls]) {
		const request = input(cameraProject(), 'persisted-timeline-audio', true);
		const items = createItems(request, {
			link: () => { assert.fail('unexpected Link'); }, unlink: () => { assert.fail('blocked Unlink'); },
			setVideoHidden: () => { assert.fail('unexpected visibility'); },
		});
		request.editBlocked = false;
		assert.equal(items.link?.disabled, true);
		items.link?.onClick();
		assert.equal(items.visibility, null);
	}
});

test('the shipped camera-audio recovery rejects broken or ambiguous linked pairs', () => {
	const project = cameraProject();
	for (const malformed of [
		{ ...project, clips: project.clips.map(clip => clip.kind === 'audio'
			? { ...clip, timelineStartFrame: 1 } : clip) },
		{ ...project, clips: project.clips.map(clip => clip.kind === 'video'
			? { ...clip, avLinkId: 'other-link' } : clip) },
		{ ...project, clips: [...project.clips, { ...project.clips[1], id: 'extra-linked-audio' }] },
		{ ...project, tracks: project.tracks.map(track => track.type === 'audio'
			? { ...track, laneGroupId: 'other-lanes' } : track) },
		{ ...project, tracks: [...project.tracks,
			createAudioTrack({ id: 'duplicate-audio-lane', clipIds: ['persisted-timeline-audio'] })] },
		{ ...project, clips: project.clips.map(clip => clip.kind === 'video'
			? { ...clip, sequenceFrameCount: -1 } : clip) },
	]) {
		const items = createSoundscaperEditControls(input(malformed), {
			unlink: () => assert.fail('a broken linked pair must not dispatch Unlink'),
		});
		assert.deepEqual(items, { link: null, visibility: null });
	}
});
