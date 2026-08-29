/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SELECTED_FINISHING_DIALOG_AUTHORING_SURFACES as SURFACES,
	assertFramescaperSelectedVisualAuthoringFenceFinishing,
	createFramescaperSelectedVisualAuthoringFenceFinishing,
	createFramescaperSelectedVisualAuthoringModelFinishing,
} from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';

type Data = Record<string, unknown>;

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		id: 'project-1',
		revision: 3,
		selection: { clipIds: ['clip-1'] },
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', trackIds: ['video-track'] }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['clip-1'] }],
		clips: [{
			id: 'clip-1', kind: 'video', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10,
		}],
		videoVisualPresets: [],
		videoFinishingPresets: [],
		videoFreezeFallbacks: [],
		videoAdjustmentLayers: [],
		videoVisualPresentations: [],
		videoMaskMattes: [],
		videoTransitionsByTrackId: {},
		...overrides,
	};
}

function model(surface: string, overrides: Data = {}): Data {
	return createFramescaperSelectedVisualAuthoringModelFinishing({
		surface: surface as never,
		project: project(),
		selectedClipId: 'clip-1',
		playheadSample: 0,
		...overrides,
	}) as unknown as Data;
}

function fence(overrides: Data = {}): Data {
	return createFramescaperSelectedVisualAuthoringFenceFinishing({
		project: project(),
		selectedClipId: 'clip-1',
		playheadSample: 5,
		...overrides,
	}) as unknown as Data;
}

test('every authoring surface resolves to its own titled model', () => {
	const titles = new Set<string>();

	for (const surface of SURFACES) {
		const built = model(surface);
		assert.equal(built.surface, surface);
		assert.equal(typeof built.title, 'string');
		assert.equal(typeof built.description, 'string');
		titles.add(String(built.title));
	}

	assert.equal(titles.size, SURFACES.length, 'each surface must carry its own copy');
});

test('an authoring model reports the selected clip and its kind', () => {
	const built = model('video-adjustment-layer');

	assert.equal(built.selectedClipId, 'clip-1');
	assert.equal(built.selectedClipKind, 'video');
	assert.deepEqual(built.attachedMaskIds, []);
	assert.equal(built.selectedMaskId, null);
	assert.equal(built.selectedFreezeSourceId, null);
});

test('an authoring model carries a fence bound to the project it read', () => {
	const built = model('video-mask-matte');
	const bound = built.fence as Data;

	assert.equal(bound.projectId, 'project-1');
	assert.equal(bound.projectRevision, 3);
	assert.deepEqual(bound.selectedClipIds, ['clip-1']);
});

test('an unsupported authoring surface is refused', () => {
	assert.throws(() => model('video-nonsense'), RangeError);
});

test('a project outside the Framescaper schema family cannot author a surface', () => {
	assert.throws(
		() => model('video-freeze', { project: project({ schemaFamily: 'soundscaper' }) }),
		RangeError,
	);
});

test('a negative playhead sample is refused', () => {
	assert.throws(() => model('video-freeze', { playheadSample: -1 }), RangeError);
});

test('a fence records the project revision, selection and playhead it was taken at', () => {
	assert.deepEqual(fence(), {
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		projectId: 'project-1',
		projectRevision: 3,
		selectedClipIds: ['clip-1'],
		projectSelection: JSON.stringify({ clipIds: ['clip-1'] }),
		playheadSample: 5,
	});
});

test('a fence taken with no selected clip records an empty selection', () => {
	assert.deepEqual((fence({ selectedClipId: null }) as Data).selectedClipIds, []);
});

test('a fence admits the exact project revision it was taken from', () => {
	assert.doesNotThrow(() => assertFramescaperSelectedVisualAuthoringFenceFinishing(
		project(), fence(), 'clip-1',
	));
});

test('a fence refuses a project that advanced under the open dialog', () => {
	assert.throws(
		() => assertFramescaperSelectedVisualAuthoringFenceFinishing(
			project({ revision: 4 }), fence(), 'clip-1',
		),
		/project is stale\. Reopen the dialog/u,
	);
});

test('a fence refuses a selection that changed under the open dialog', () => {
	assert.throws(
		() => assertFramescaperSelectedVisualAuthoringFenceFinishing(
			project({ selection: { clipIds: [] } }), fence(), 'clip-1',
		),
		/selection changed\. Reopen the dialog/u,
	);
});

test('a fence refuses authoring a clip it never fenced', () => {
	assert.throws(
		() => assertFramescaperSelectedVisualAuthoringFenceFinishing(project(), fence(), 'clip-2'),
		/stale selection\. Reopen the dialog/u,
	);
});
