/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperFinishingMenuItems,
	framescaperFinishingSurface,
	framescaperFinishingSurfaceId,
	type FramescaperFinishingSurface,
} from '../src/common/editor/ui/framescaper-finishing-menu.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { createApplicationMenuProductItems } from '../src/common/editor/ui/application-menu-product-items.js';

const CAPABILITIES = Object.freeze({
	videoCaptions: true, videoColorManagement: true, videoDenoise: true,
	videoGrading: true, videoMotionTracking: true, videoStabilization: true,
	videoGenerators: true,
	audioAutomation: true, audioEffects: false, audioMixerGraph: true,
});
const PROJECT = Object.freeze({ schemaFamily: 'framescaper', schemaVersion: 1 });

test('Framescaper 1.0 exposes every finishing workflow through existing menus', async () => {
	assert.equal(framescaperFinishingSurfaceId('captions'), 'framescaper-finishing:captions');
	assert.equal(framescaperFinishingSurface('framescaper-finishing:captions'), 'captions');
	assert.equal(framescaperFinishingSurface('framescaper-finishing:openfx'), null);
	const calls: FramescaperFinishingSurface[] = [];
	const items = createFramescaperFinishingMenuItems({
		productId: 'framescaper', project: PROJECT, capabilities: CAPABILITIES,
		editingBlocked: false, readOnly: false,
	}, { open: (surface) => { calls.push(surface); } });
	assert.deepEqual(items.tracks.map(({ id }) => id), [
		'framescaper-caption-tracks', 'framescaper-audio-automation',
	]);
	assert.deepEqual(items.effect[0]?.items?.map(({ id }) => id), [
		'framescaper-visual-inspector',
		'framescaper-color-management', 'framescaper-grading-presets',
		'framescaper-stabilization', 'framescaper-denoise',
	]);
	assert.deepEqual(items.analyze.map(({ id }) => id), ['framescaper-motion-tracking']);
	assert.deepEqual(items.mixer.map(({ id }) => id), [
		'framescaper-mixer', 'framescaper-dialogue-chain',
	]);
	assert.equal(items.mixer[1]?.disabled, false,
		'the selected dialogue action does not require generic audio-effect authoring');
	await items.effect[0]?.items?.[0]?.onClick?.();
	await items.tracks[0]?.onClick?.();
	assert.deepEqual(calls, ['visual-inspector', 'captions']);
});

test('Framescaper finishing menus fail closed outside current mutable capability truth', () => {
	for (const input of [
		{ productId: 'soundscaper', project: PROJECT, capabilities: CAPABILITIES },
		{ productId: 'framescaper', project: { schemaFamily: 'framescaper', schemaVersion: 2 }, capabilities: CAPABILITIES },
		{ productId: 'framescaper', project: { schemaFamily: 'soundscaper', schemaVersion: 1 }, capabilities: CAPABILITIES },
		{ productId: 'framescaper', project: { schemaVersion: 31 }, capabilities: CAPABILITIES },
	]) assert.deepEqual(createFramescaperFinishingMenuItems({
		...input, editingBlocked: false,
	}, { open: () => undefined }), { tracks: [], effect: [], analyze: [], mixer: [], tools: [] });
	const disabled = createFramescaperFinishingMenuItems({
		productId: 'framescaper', project: PROJECT, capabilities: {
			...CAPABILITIES, videoDenoise: false,
		}, editingBlocked: false, readOnly: true,
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.equal(disabled.tracks.every(({ disabled: value }) => value), true);
	assert.equal(disabled.effect[0]?.items?.every(({ disabled: value }) => value), true);
	disabled.effect[0]?.items?.[0]?.onClick?.();
});

test('the product menu seam merges Framescaper finishing rows without Soundscaper production rows', () => {
	const items = createApplicationMenuProductItems({
		productId: 'framescaper', capabilities: CAPABILITIES,
		project: { ...PROJECT, sequences: [], subsequences: [], tracks: [] },
		snapshot: { readOnly: false }, editBlocked: false, copy: {},
		actions: { openFramescaperFinishing: () => undefined },
	});
	assert.equal(items.tracks.some((item: { id?: string } | null) => (
		item?.id === 'framescaper-caption-tracks'
	)), true);
	assert.equal(items.effect.some(({ id }: { id: string }) => id === 'framescaper-video-finishing'), true);
	assert.equal(items.analyze.some(({ id }: { id: string }) => id === 'framescaper-motion-tracking'), true);
	assert.equal(items.mixer.some(({ id }: { id: string }) => id === 'framescaper-mixer'), true);
});

test('Framescaper keeps its finishing branch when audio effects are unavailable', () => {
	const filtered = filterProductMenus([{
		id: 'effect', items: [
			{ id: 'audio-effect' },
			{ id: 'framescaper-video-finishing' },
		],
	}], {
		audioGenerators: false, audioEffects: false, audioAnalysis: false,
		audioMacros: false, audioRecording: false,
	}, 'framescaper');
	assert.deepEqual(filtered[0]?.items.map(({ id }: { id: string }) => id), [
		'framescaper-video-finishing',
	]);
});
