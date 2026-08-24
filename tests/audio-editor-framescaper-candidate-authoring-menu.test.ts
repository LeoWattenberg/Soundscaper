/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	framescaperCandidateAuthoringActionRuntimeFor,
	type FramescaperCandidateAuthoringSurface,
} from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	createFramescaperCandidateAuthoringMenuItems,
} from '../src/common/editor/ui/framescaper-candidate-authoring-menu.ts';
import {
	createApplicationMenuProductItems,
} from '../src/common/editor/ui/application-menu-product-items.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';

const TRANSITIONS = Object.freeze([
	'video-transition', 'video-transition-dissolve',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);
const VISUALS = Object.freeze([
	...TRANSITIONS,
	'video-still', 'video-title', 'video-shape', 'video-solid',
	'video-external-generator', 'video-adjustment-layer', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);
const SELECTED_V27 = Object.freeze([
	...TRANSITIONS,
	'video-still', 'video-title', 'video-text', 'video-shape', 'video-solid',
	'video-adjustment-layer', 'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const satisfies readonly FramescaperCandidateAuthoringSurface[]);

test('candidate authoring runtimes are owner-bound exact dormant subsets', async () => {
	const owner = Object.freeze({ id: 'candidate-controller' });
	const calls: string[] = [];
	const runtime = createFramescaperCandidateAuthoringActionSubsetRuntime(
		TRANSITIONS,
		Object.fromEntries(TRANSITIONS.map((surface) => [surface, () => { calls.push(surface); }])),
	);
	bindFramescaperCandidateAuthoringActionRuntime(owner, runtime);
	assert.equal(framescaperCandidateAuthoringActionRuntimeFor(owner), runtime);
	assert.equal(framescaperCandidateAuthoringActionRuntimeFor({}), null);
	await runtime.run('video-transition-dissolve');
	assert.deepEqual(calls, ['video-transition-dissolve']);
	await assert.rejects(() => runtime.run('video-freeze'), /unavailable/iu);
});

test('V22 exposes transition authoring only through Effect when exact capabilities and actions agree', async () => {
	const calls: string[] = [];
	const items = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper', project: { schemaVersion: 22 }, editingBlocked: false,
		projectCapabilities: { videoTransitions: true, videoTransitionDissolve: true },
		actionSurfaces: TRANSITIONS,
	}, { open: (surface) => { calls.push(surface); } });
	assert.deepEqual(items.tracks, []);
	assert.deepEqual(items.generate, []);
	assert.equal(items.effect.length, 1);
	assert.deepEqual(items.effect[0]?.items?.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'framescaper-add-video-transition', disabled: false },
		{ id: 'framescaper-add-dissolve-transition', disabled: false },
	]);
	await items.effect[0]?.items?.[1]?.onClick?.();
	assert.deepEqual(calls, ['video-transition-dissolve']);

	const blocked = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper', project: { schemaVersion: 22 }, editingBlocked: false,
		projectCapabilities: { videoTransitions: true, videoTransitionDissolve: false },
		actionSurfaces: ['video-transition'],
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.deepEqual(blocked.effect[0]?.items?.map(({ disabled }) => disabled), [false, true]);
});

test('V24 candidates expose visual authoring in existing menus', async () => {
	const capabilities = {
		videoTransitions: true, videoTransitionDissolve: true,
		videoStills: true, videoGenerators: true, videoAdjustmentLayers: true,
		videoMasksMattes: true, videoFreeze: true,
	};
	for (const schemaVersion of [24]) {
		const items = createFramescaperCandidateAuthoringMenuItems({
			productId: 'framescaper', project: { schemaVersion }, editingBlocked: false,
			projectCapabilities: capabilities, actionSurfaces: VISUALS,
		}, { open: () => undefined });
		assert.deepEqual(items.tracks.map(({ id }) => id), ['framescaper-add-video-adjustment-layer']);
		assert.deepEqual(items.generate.map(({ id }) => id), [
			'framescaper-add-video-still', 'framescaper-video-generators',
		]);
		assert.deepEqual(items.generate[1]?.items?.map(({ id }) => id), [
			'framescaper-add-video-title', 'framescaper-add-video-shape',
			'framescaper-add-video-solid', 'framescaper-add-external-video-generator',
		]);
		assert.deepEqual(items.effect.map(({ id }) => id), [
			'framescaper-video-transitions', 'framescaper-edit-video-mask-matte',
			'framescaper-freeze-video',
		]);
	}

	// V20 remains selected only until V27 boots; Soundscaper never receives Framescaper rows.
	for (const input of [
		{ productId: 'framescaper', project: { schemaVersion: 20 } },
		{ productId: 'soundscaper', project: { schemaVersion: 24 } },
	]) {
		assert.deepEqual(createFramescaperCandidateAuthoringMenuItems({
			...input, editingBlocked: false, projectCapabilities: capabilities, actionSurfaces: VISUALS,
		}, { open: () => undefined }), { tracks: [], generate: [], effect: [] });
	}
});

test('selected V27 and V28 expose maintained visual workflows without the M5 external generator', () => {
	for (const schemaVersion of [27, 28]) {
		const items = createFramescaperCandidateAuthoringMenuItems({
			productId: 'framescaper', project: { schemaVersion }, editingBlocked: false,
			projectCapabilities: {
				videoTransitions: true, videoTransitionDissolve: true, videoStills: true,
				videoGenerators: true, videoAdjustmentLayers: true, videoMasksMattes: true,
				videoFreeze: true,
			},
			actionSurfaces: SELECTED_V27,
		}, { open: () => undefined });
		assert.deepEqual(items.generate[1]?.items?.map(({ id, disabled }) => ({ id, disabled })), [
			{ id: 'framescaper-add-video-title', disabled: false },
			{ id: 'framescaper-add-video-text', disabled: false },
			{ id: 'framescaper-add-video-shape', disabled: false },
			{ id: 'framescaper-add-video-solid', disabled: false },
			{ id: 'framescaper-save-video-visual-preset', disabled: false },
		]);
		assert.equal(JSON.stringify(items).includes('external-video-generator'), false);
	}
});

test('candidate visual entries fail closed for read-only, missing actions, and missing capabilities', () => {
	const items = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper', project: { schemaVersion: 26 }, editingBlocked: false, readOnly: true,
		projectCapabilities: { videoStills: true, videoGenerators: true },
		actionSurfaces: ['video-still'],
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.equal(items.tracks.every(({ disabled }) => disabled), true);
	assert.equal(items.generate.every(({ disabled }) => disabled), true);
	assert.equal(items.effect.every(({ disabled }) => disabled), true);
	items.generate[0]?.onClick?.();
});

test('the product menu seam places dormant authoring in Tracks, Generate, and Effect only', () => {
	const items = createApplicationMenuProductItems({
		productId: 'framescaper', project: { schemaVersion: 24, sequences: [], subsequences: [] },
		capabilities: {
			videoTransitions: true, videoTransitionDissolve: true, videoStills: true,
			videoGenerators: true, videoAdjustmentLayers: true, videoMasksMattes: true,
			videoFreeze: true,
		},
		snapshot: { readOnly: false }, editBlocked: false, copy: {},
		actions: {
			framescaperCandidateAuthoring: { surfaces: VISUALS, open: () => undefined },
		},
	});
	assert.equal(items.tracks.some((item) => (
		item?.id === 'framescaper-add-video-adjustment-layer'
	)), true);
	assert.deepEqual(items.generate.map(({ id }: { id: string }) => id), [
		'framescaper-add-video-still', 'framescaper-video-generators',
	]);
	assert.equal(items.effect.some(({ id }: { id: string }) => (
		id === 'framescaper-video-transitions'
	)), true);
	const filtered = filterProductMenus([
		{ id: 'generate', items: [...items.generate, {
			id: 'silence-generator', disabled: false, onClick: () => undefined,
		}] },
		{ id: 'effect', items: items.effect },
	], {
		audioGenerators: false, audioEffects: false, audioAnalysis: false,
		audioMacros: false, audioRecording: false,
		videoGenerators: true, videoStills: true,
	}, 'framescaper');
	assert.deepEqual(filtered.map(({ id }: { id: string }) => id), ['generate', 'effect']);
	assert.deepEqual(filtered[0]?.items.map(({ id }: { id: string }) => id), [
		'framescaper-add-video-still', 'framescaper-video-generators',
	]);
	assert.deepEqual(filtered[1]?.items.map(({ id }: { id: string }) => id), [
		'framescaper-video-transitions', 'framescaper-edit-video-mask-matte',
		'framescaper-freeze-video',
	]);
});
