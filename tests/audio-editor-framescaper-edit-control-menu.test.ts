/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperEditControlMenuModel,
	createFramescaperEditControlMenuItems,
} from '../src/common/editor/ui/framescaper-edit-control-menu-model.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-identity.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const COPY = Object.freeze({
	linkAudio: 'Link audio',
	unlinkAudio: 'Unlink audio',
	showVideo: 'Show video',
	hideVideo: 'Hide video',
});

test('Framescaper v1 derives linked-audio and video-visibility operations from current coordinates', () => {
	const project = baselineProject();
	const before = structuredClone(project);
	const model = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.deepEqual(model.link, {
		id: 'video-linked-audio', label: 'Unlink audio', disabled: false,
		operation: { kind: 'unlink', clipId: 'persisted-timeline-video' },
	});
	assert.deepEqual(model.visibility, {
		id: 'video-track-visibility', label: 'Hide video', disabled: false,
		operation: { trackId: 'persisted-video-track', hidden: true },
	});
	assert.deepEqual(project, before);
	assert.ok(Object.isFrozen(model));
	assert.ok(Object.isFrozen(model.link));
	assert.ok(Object.isFrozen(model.link?.operation));
});

test('Framescaper v1 resolves the exact unlinked audio/video companion pair', () => {
	const project = baselineProject({ linked: false, hidden: true });
	for (const selectedClipId of ['persisted-timeline-video', 'persisted-timeline-audio']) {
		const model = createFramescaperEditControlMenuModel({
			productId: 'framescaper', project, selectedClipId,
			selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
		});
		assert.deepEqual(model.link?.operation, {
			kind: 'link', videoClipId: 'persisted-timeline-video',
			audioClipId: 'persisted-timeline-audio',
		});
		assert.equal(model.link?.label, 'Link audio');
		assert.equal(model.visibility?.label, 'Show video');
	}
});

test('Framescaper v1 menu items dispatch exact existing controller actions', () => {
	const calls: unknown[][] = [];
	const items = createFramescaperEditControlMenuItems({
		productId: 'framescaper', project: baselineProject(),
		selectedClipId: 'persisted-timeline-video', selectedTrackId: 'persisted-video-track',
		editBlocked: false, copy: COPY,
	}, {
		link: (...args) => calls.push(['link', ...args]),
		unlink: (...args) => calls.push(['unlink', ...args]),
		setVideoHidden: (...args) => calls.push(['hidden', ...args]),
	});
	items.link?.onClick();
	items.visibility?.onClick();
	assert.deepEqual(calls, [
		['unlink', 'persisted-timeline-video'],
		['hidden', 'persisted-video-track', true],
	]);
	assert.ok(Object.isFrozen(items));
	assert.ok(Object.isFrozen(items.link));
});

test('Framescaper linked controls fail closed for blocked, foreign, and malformed projects', () => {
	const calls: unknown[][] = [];
	const blocked = createFramescaperEditControlMenuItems({
		productId: 'framescaper', project: baselineProject(),
		selectedClipId: 'persisted-timeline-video', selectedTrackId: 'persisted-video-track',
		editBlocked: true, copy: COPY,
	}, {
		link: (...args) => calls.push(['link', ...args]),
		unlink: (...args) => calls.push(['unlink', ...args]),
		setVideoHidden: (...args) => calls.push(['hidden', ...args]),
	});
	assert.equal(blocked.link?.disabled, true);
	assert.equal(blocked.visibility?.disabled, true);
	blocked.link?.onClick();
	blocked.visibility?.onClick();
	assert.deepEqual(calls, []);

	for (const [productId, project] of [
		['soundscaper', baselineProject()],
		['framescaper', { schemaFamily: 'soundscaper', schemaVersion: 1 }],
		['framescaper', { schemaVersion: 1 }],
	] as const) {
		assert.deepEqual(createFramescaperEditControlMenuModel({
			productId, project, selectedClipId: null, selectedTrackId: null,
			editBlocked: false, copy: COPY,
		}), { link: null, visibility: null });
	}

	const malformedCurrent = createFramescaperEditControlMenuModel({
		productId: 'framescaper',
		project: { schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION },
		selectedClipId: null, selectedTrackId: null, editBlocked: false, copy: COPY,
	});
	assert.equal(malformedCurrent.link?.disabled, true);
	assert.equal(malformedCurrent.visibility?.disabled, true);
});

test('Framescaper v1 requires a valid annotation carrier for linked controls', () => {
	const project = baselineProject();
	project.timelineAnnotations = [];
	const available = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.equal(available.link?.disabled, false);
	project.timelineAnnotations = [{ id: 'unsupported' }];
	const blocked = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.equal(blocked.link?.disabled, true);
});

test('Framescaper v1 keeps controls active after reviewed shot markers are accepted', () => {
	const project = baselineProject();
	project.timelineAnnotations = [{
		id: 'assistance-shot:accepted', sequenceId: project.primarySequenceId,
		name: 'Shot 1', color: 'orange', batchId: 'assistance-shot-batch:accepted',
		opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 24_000,
	}];
	const model = createFramescaperEditControlMenuModel({
		productId: 'framescaper', project, selectedClipId: 'persisted-timeline-video',
		selectedTrackId: 'persisted-video-track', editBlocked: false, copy: COPY,
	});
	assert.deepEqual(model.link?.operation, {
		kind: 'unlink', clipId: 'persisted-timeline-video',
	});
	assert.deepEqual(model.visibility?.operation, {
		trackId: 'persisted-video-track', hidden: true,
	});
});

interface BaselineTestProject extends Record<string, unknown> {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly primarySequenceId: string;
	timelineAnnotations: unknown[];
	clips: Array<Record<string, unknown> & { avLinkId: string | null }>;
	tracks: Array<Record<string, unknown> & { type: string; hidden: boolean }>;
}

function baselineProject(
	options: Readonly<{ linked?: boolean; hidden?: boolean }> = {},
): BaselineTestProject {
	const project = structuredClone(
		createPersistedVideoProject({ timeline: true }).project,
	) as unknown as BaselineTestProject;
	Object.assign(project, {
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
	});
	if (options.linked === false) {
		for (const clip of project.clips) clip.avLinkId = null;
	}
	const videoTrack = project.tracks.find(({ type }) => type === 'video');
	if (videoTrack && options.hidden !== undefined) videoTrack.hidden = options.hidden;
	return project;
}
