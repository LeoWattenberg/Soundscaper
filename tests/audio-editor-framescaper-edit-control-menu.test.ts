/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperEditControlMenuModel,
	createFramescaperEditControlMenuItems,
} from '../src/common/editor/ui/framescaper-edit-control-menu-model.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const COPY = Object.freeze({
	linkAudio: 'Link audio',
	unlinkAudio: 'Unlink audio',
	showVideo: 'Show video',
	hideVideo: 'Hide video',
});

function project(options: Readonly<{
	linked?: boolean;
	hidden?: boolean;
	audioStart?: number;
	audioDuration?: number;
	audioLaneGroupId?: string;
	ambiguous?: boolean;
	duplicateOwnership?: boolean;
}> = {}) {
	const linked = options.linked ?? true;
	return {
		sampleRate: 48_000,
		projectBin: { clips: [] },
		tracks: [
			{
				id: 'video-track', type: 'video', laneGroupId: 'lane-a', hidden: options.hidden ?? false,
				clipIds: ['video-clip'],
			},
			{
				id: 'audio-track', type: 'audio', laneGroupId: options.audioLaneGroupId ?? 'lane-a',
				clipIds: ['audio-clip', ...(options.ambiguous ? ['audio-duplicate'] : [])],
			},
			...(options.duplicateOwnership ? [{
				id: 'duplicate-owner', type: 'audio', laneGroupId: 'lane-b', clipIds: ['audio-clip'],
			}] : []),
		],
		clips: [
			{
				id: 'video-clip', kind: 'video', timelineStartFrame: 1_000, durationFrames: 2_000,
				sourceStartFrame: 0, sourceDurationFrames: 2_000, avLinkId: linked ? 'av-link' : null,
			},
			{
				id: 'audio-clip', kind: 'audio', timelineStartFrame: options.audioStart ?? 1_000,
				durationFrames: options.audioDuration ?? 2_000, sourceStartFrame: 0,
				sourceDurationFrames: options.audioDuration ?? 2_000, avLinkId: linked ? 'av-link' : null,
			},
			...(options.ambiguous ? [{
				id: 'audio-duplicate', kind: 'audio', timelineStartFrame: 1_000,
				durationFrames: 2_000, sourceStartFrame: 0, sourceDurationFrames: 2_000, avLinkId: null,
			}] : []),
		],
	};
}

test('a linked selected clip exposes one exact unlink operation', () => {
	const value = project();
	const before = structuredClone(value);
	const model = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: value, selectedClipId: 'video-clip',
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	});
	assert.deepEqual(model.link, {
		id: 'video-linked-audio', label: 'Unlink audio', disabled: false,
		operation: { kind: 'unlink', clipId: 'video-clip' },
	});
	assert.deepEqual(value, before);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(model.link));
	assert.ok(Object.isFrozen(model.link?.operation));
});

test('an unlinked clip resolves only one aligned companion in its lane group', () => {
	for (const selectedClipId of ['video-clip', 'audio-clip']) {
		const model = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project: project({ linked: false }), selectedClipId,
			selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
		});
		assert.deepEqual(model.link?.operation, {
			kind: 'link', videoClipId: 'video-clip', audioClipId: 'audio-clip',
		});
		assert.equal(model.link?.label, 'Link audio');
		assert.equal(model.link?.disabled, false);
	}
});

test('linking fails closed for ambiguous, misaligned, and cross-lane candidates', () => {
	for (const value of [
		project({ linked: false, ambiguous: true }),
		project({ linked: false, audioStart: 1_001 }),
		project({ linked: false, audioDuration: 1_999 }),
		project({ linked: false, audioLaneGroupId: 'lane-b' }),
		project({ linked: false, duplicateOwnership: true }),
	]) {
		const model = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project: value, selectedClipId: 'video-clip',
			selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
		});
		assert.equal(model.link?.label, 'Link audio');
		assert.equal(model.link?.disabled, true);
		assert.equal(model.link?.operation, null);
	}
});

test('video visibility derives one checked track update while audio and missing tracks fail closed', () => {
	const visible = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: project({ hidden: false }), selectedClipId: null,
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	});
	assert.deepEqual(visible.visibility, {
		id: 'video-track-visibility', label: 'Hide video', disabled: false,
		operation: { trackId: 'video-track', hidden: true },
	});
	const hidden = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: project({ hidden: true }), selectedClipId: null,
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	});
	assert.equal(hidden.visibility?.label, 'Show video');
	assert.deepEqual(hidden.visibility?.operation, { trackId: 'video-track', hidden: false });
	for (const selectedTrackId of ['audio-track', 'missing']) {
		const unavailable = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project: project(), selectedClipId: null,
			selectedTrackId, editBlocked: false, copy: COPY,
		});
		assert.equal(unavailable.visibility?.disabled, true);
		assert.equal(unavailable.visibility?.operation, null);
	}
});

test('blocked edits retain labels but disable actions, and Soundscaper gets no items', () => {
	const blocked = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: project(), selectedClipId: 'video-clip',
		selectedTrackId: 'video-track', editBlocked: true, copy: COPY,
	});
	assert.equal(blocked.link?.label, 'Unlink audio');
	assert.equal(blocked.link?.disabled, true);
	assert.equal(blocked.visibility?.label, 'Hide video');
	assert.equal(blocked.visibility?.disabled, true);
	assert.deepEqual(createFramescaperEditControlMenuModel({
		productId: 'soundscaper', project: project(), selectedClipId: 'video-clip',
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	}), { link: null, visibility: null });
});

test('missing selections and malformed projects fail closed without dispatching', () => {
	const calls: unknown[][] = [];
	const actions = {
		link: (...args: unknown[]) => calls.push(['link', ...args]),
		unlink: (...args: unknown[]) => calls.push(['unlink', ...args]),
		setVideoHidden: (...args: unknown[]) => calls.push(['hidden', ...args]),
	};
	for (const value of [null, {}, { sampleRate: 0, clips: [], tracks: [] }]) {
		const items = createFramescaperEditControlMenuItems({
			productId: 'framescaper', project: value, selectedClipId: null,
			selectedTrackId: null, editBlocked: false, copy: COPY,
		}, actions);
		assert.equal(items.link?.disabled, true);
		assert.equal(items.visibility?.disabled, true);
		items.link?.onClick();
		items.visibility?.onClick();
	}
	assert.deepEqual(calls, []);
});

test('menu item builders dispatch exact existing controller actions', () => {
	const calls: unknown[][] = [];
	const linked = createFramescaperEditControlMenuItems({
		productId: 'framescaper', project: project(), selectedClipId: 'video-clip',
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	}, {
		link: (...args) => calls.push(['link', ...args]),
		unlink: (...args) => calls.push(['unlink', ...args]),
		setVideoHidden: (...args) => calls.push(['hidden', ...args]),
	});
	linked.link?.onClick();
	linked.visibility?.onClick();
	assert.deepEqual(calls, [
		['unlink', 'video-clip'],
		['hidden', 'video-track', true],
	]);
	const unlinked = createFramescaperEditControlMenuItems({
		productId: 'framescaper', project: project({ linked: false }), selectedClipId: 'audio-clip',
		selectedTrackId: 'video-track', editBlocked: false, copy: COPY,
	}, {
		link: (...args) => calls.push(['link', ...args]),
		unlink: (...args) => calls.push(['unlink', ...args]),
		setVideoHidden: (...args) => calls.push(['hidden', ...args]),
	});
	unlinked.link?.onClick();
	assert.deepEqual(calls.at(-1), ['link', 'video-clip', 'audio-clip']);
	assert.ok(Object.isFrozen(unlinked));
	assert.ok(Object.isFrozen(unlinked.link));
});

test('current persisted video coordinates resolve through the shared runtime projection', () => {
	const { project: persisted } = createPersistedVideoProject({ timeline: true });
	const video = persisted.clips.find(({ kind }) => kind === 'video');
	assert.ok(video);
	assert.equal(Object.hasOwn(video, 'timelineStartFrame'), false);
	assert.equal(Object.hasOwn(video, 'durationFrames'), false);
	const linked = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: persisted, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.equal(linked.link?.label, 'Unlink audio');
	assert.equal(linked.link?.disabled, false);

	const unlinked = structuredClone(persisted) as unknown as {
		clips: Array<{ id: string; avLinkId: string | null }>;
	};
	for (const clip of unlinked.clips) clip.avLinkId = null;
	const linkable = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project: unlinked, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.deepEqual(linkable.link?.operation, {
		kind: 'link', videoClipId: 'persisted-timeline-video', audioClipId: 'persisted-timeline-audio',
	});
});

test('exact Framescaper V19, V20, and V27 project their required empty annotation carrier for linked controls', () => {
	for (const schemaVersion of [
		FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
		FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
		FRAMESCAPER_PROJECT_V27_SCHEMA_VERSION,
	]) {
		const persisted = structuredClone(createPersistedVideoProject({ timeline: true }).project) as unknown as {
			schemaVersion: number;
			timelineAnnotations: unknown[];
		};
		persisted.schemaVersion = schemaVersion;
		persisted.timelineAnnotations = [];
		const model = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project: persisted, selectedClipId: 'persisted-timeline-video',
			selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
		});
		assert.equal(model.link?.label, 'Unlink audio');
		assert.equal(model.link?.disabled, false);
		persisted.timelineAnnotations = [{ id: 'unsupported' }];
		const blocked = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project: persisted, selectedClipId: 'persisted-timeline-video',
			selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
		});
		assert.equal(blocked.link?.label, 'Link audio');
		assert.equal(blocked.link?.disabled, true);
	}
});
