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
const BASELINE_VISUALS = Object.freeze([
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

test('the baseline exposes transition authoring only through Effect when exact capabilities and actions agree', async () => {
	const calls: string[] = [];
	const items = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper',
		project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false,
		projectCapabilities: { videoTransitions: true, videoTransitionDissolve: true },
		actionSurfaces: TRANSITIONS,
	}, { open: (surface) => { calls.push(surface); } });
	assert.equal(items.tracks.every(({ disabled }) => disabled), true);
	assert.equal(items.generate.every(({ disabled }) => disabled), true);
	assert.equal(items.effect.length, 3);
	assert.deepEqual(items.effect[0]?.items?.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'framescaper-add-video-transition', disabled: false },
		{ id: 'framescaper-add-dissolve-transition', disabled: false },
	]);
	await items.effect[0]?.items?.[1]?.onClick?.();
	assert.deepEqual(calls, ['video-transition-dissolve']);
	assert.equal(items.effect.slice(1).every(({ disabled }) => disabled), true);

	const blocked = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper',
		project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false,
		projectCapabilities: { videoTransitions: true, videoTransitionDissolve: false },
		actionSurfaces: ['video-transition'],
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.deepEqual(blocked.effect[0]?.items?.map(({ disabled }) => disabled), [false, true]);
});

test('the baseline exposes visual authoring in existing menus', async () => {
	const capabilities = {
		videoTransitions: true, videoTransitionDissolve: true,
		videoStills: true, videoGenerators: true, videoAdjustmentLayers: true,
		videoMasksMattes: true, videoFreeze: true,
	};
	{
		const items = createFramescaperCandidateAuthoringMenuItems({
			productId: 'framescaper',
			project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false,
			projectCapabilities: capabilities, actionSurfaces: VISUALS,
		}, { open: () => undefined });
		assert.deepEqual(items.tracks.map(({ id }) => id), ['framescaper-add-video-adjustment-layer']);
		assert.deepEqual(items.generate.map(({ id }) => id), [
			'framescaper-add-video-still', 'framescaper-video-generators',
		]);
		assert.deepEqual(items.generate[1]?.items?.map(({ id }) => id), [
			'framescaper-add-video-title', 'framescaper-add-video-text',
			'framescaper-add-video-shape', 'framescaper-add-video-solid',
			'framescaper-save-video-visual-preset',
		]);
		assert.equal(items.generate[1]?.items?.[1]?.disabled, true);
		assert.equal(items.generate[1]?.items?.[4]?.disabled, true);
		assert.deepEqual(items.effect.map(({ id }) => id), [
			'framescaper-video-transitions', 'framescaper-edit-video-mask-matte',
			'framescaper-freeze-video',
		]);
	}

	// Numeric-only and foreign-family projects never receive Framescaper rows.
	for (const input of [
		{ productId: 'framescaper', project: { schemaVersion: 1 } },
		{ productId: 'soundscaper', project: { schemaFamily: 'soundscaper', schemaVersion: 1 } },
	]) {
		assert.deepEqual(createFramescaperCandidateAuthoringMenuItems({
			...input, editingBlocked: false, projectCapabilities: capabilities, actionSurfaces: VISUALS,
		}, { open: () => undefined }), { tracks: [], generate: [], effect: [] });
	}
});

test('the baseline exposes maintained visual workflows without the external generator', () => {
	{
		const items = createFramescaperCandidateAuthoringMenuItems({
			productId: 'framescaper',
			project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false,
			projectCapabilities: {
				videoTransitions: true, videoTransitionDissolve: true, videoStills: true,
				videoGenerators: true, videoAdjustmentLayers: true, videoMasksMattes: true,
				videoFreeze: true,
			},
			actionSurfaces: BASELINE_VISUALS,
		}, { open: () => undefined });
		assert.deepEqual({
			id: items.generate[0]?.id,
			label: items.generate[0]?.label,
			disabled: items.generate[0]?.disabled,
		}, {
			id: 'framescaper-add-video-still',
			label: 'Add Images…',
			disabled: false,
		});
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

test('the baseline exposes Add Images through Generate when the image action is bound', () => {
	const calls: FramescaperCandidateAuthoringSurface[] = [];
	const items = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper',
		project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false,
		projectCapabilities: { videoStills: true },
		actionSurfaces: ['video-still'],
	}, { open: (surface) => { calls.push(surface); } });
	assert.deepEqual(items.generate.map(({ id }) => id), [
		'framescaper-add-video-still', 'framescaper-video-generators',
	]);
	assert.deepEqual({
		label: items.generate[0]?.label,
		disabled: items.generate[0]?.disabled,
	}, { label: 'Add Images…', disabled: false });
	items.generate[0]?.onClick?.();
	assert.deepEqual(calls, ['video-still']);
});

test('candidate visual entries fail closed for read-only, missing actions, and missing capabilities', () => {
	const items = createFramescaperCandidateAuthoringMenuItems({
		productId: 'framescaper',
		project: { schemaFamily: 'framescaper', schemaVersion: 1 }, editingBlocked: false, readOnly: true,
		projectCapabilities: { videoStills: true, videoGenerators: true },
		actionSurfaces: ['video-still'],
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.equal(items.tracks.every(({ disabled }) => disabled), true);
	assert.equal(items.generate.every(({ disabled }) => disabled), true);
	assert.equal(items.effect.every(({ disabled }) => disabled), true);
	items.generate[0]?.onClick?.();
});

test('the product menu seam places baseline authoring in Tracks, Generate, and Effect only', () => {
	const items = createApplicationMenuProductItems({
		productId: 'framescaper', project: {
			schemaFamily: 'framescaper', schemaVersion: 1, sequences: [], subsequences: [],
		},
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
	assert.equal(items.generate[0]?.label, 'Add Images…');
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
		'framescaper-freeze-video', 'framescaper-video-finishing',
	]);
});
