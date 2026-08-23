/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperV27FinishingMenuItems,
	framescaperV27FinishingSurface,
	framescaperV27FinishingSurfaceId,
	type FramescaperV27FinishingSurface,
} from '../src/common/editor/ui/framescaper-v27-finishing-menu.ts';
import { createApplicationMenuProductItems } from '../src/common/editor/ui/application-menu-product-items.js';

const CAPABILITIES = Object.freeze({
	videoCaptions: true, videoColorManagement: true, videoDenoise: true,
	videoGrading: true, videoMotionTracking: true, videoStabilization: true,
	audioAutomation: true, audioEffects: true, audioMixerGraph: true,
});

test('selected Framescaper V27 exposes every finishing workflow through existing menus', async () => {
	assert.equal(framescaperV27FinishingSurfaceId('captions'), 'framescaper-v27-finishing:captions');
	assert.equal(framescaperV27FinishingSurface('framescaper-v27-finishing:captions'), 'captions');
	assert.equal(framescaperV27FinishingSurface('framescaper-v27-finishing:openfx'), null);
	const calls: FramescaperV27FinishingSurface[] = [];
	const items = createFramescaperV27FinishingMenuItems({
		productId: 'framescaper', project: { schemaVersion: 27 }, capabilities: CAPABILITIES,
		editingBlocked: false, readOnly: false,
	}, { open: (surface) => { calls.push(surface); } });
	assert.deepEqual(items.tracks.map(({ id }) => id), [
		'framescaper-v27-caption-tracks', 'framescaper-v27-audio-automation',
	]);
	assert.deepEqual(items.effect[0]?.items?.map(({ id }) => id), [
		'framescaper-v27-color-management', 'framescaper-v27-grading-presets',
		'framescaper-v27-stabilization', 'framescaper-v27-denoise',
	]);
	assert.deepEqual(items.analyze.map(({ id }) => id), ['framescaper-v27-motion-tracking']);
	assert.deepEqual(items.mixer.map(({ id }) => id), [
		'framescaper-v27-mixer', 'framescaper-v27-dialogue-chain',
	]);
	await items.effect[0]?.items?.[0]?.onClick?.();
	await items.tracks[0]?.onClick?.();
	assert.deepEqual(calls, ['color-management', 'captions']);
});

test('V27 finishing menus fail closed outside selected mutable capability truth', () => {
	for (const input of [
		{ productId: 'soundscaper', project: { schemaVersion: 27 }, capabilities: CAPABILITIES },
		{ productId: 'framescaper', project: { schemaVersion: 24 }, capabilities: CAPABILITIES },
	]) assert.deepEqual(createFramescaperV27FinishingMenuItems({
		...input, editingBlocked: false,
	}, { open: () => undefined }), { tracks: [], effect: [], analyze: [], mixer: [], tools: [] });
	const disabled = createFramescaperV27FinishingMenuItems({
		productId: 'framescaper', project: { schemaVersion: 27 }, capabilities: {
			...CAPABILITIES, videoDenoise: false,
		}, editingBlocked: false, readOnly: true,
	}, { open: () => { throw new Error('disabled action ran'); } });
	assert.equal(disabled.tracks.every(({ disabled: value }) => value), true);
	assert.equal(disabled.effect[0]?.items?.every(({ disabled: value }) => value), true);
	disabled.effect[0]?.items?.[0]?.onClick?.();
});

test('the product menu seam merges selected V27 finishing rows without Soundscaper production rows', () => {
	const items = createApplicationMenuProductItems({
		productId: 'framescaper', capabilities: CAPABILITIES,
		project: { schemaVersion: 27, sequences: [], subsequences: [], tracks: [] },
		snapshot: { readOnly: false }, editBlocked: false, copy: {},
		actions: { openFramescaperV27Finishing: () => undefined },
	});
	assert.equal(items.tracks.some((item: { id?: string } | null) => (
		item?.id === 'framescaper-v27-caption-tracks'
	)), true);
	assert.equal(items.effect.some(({ id }: { id: string }) => id === 'framescaper-v27-video-finishing'), true);
	assert.equal(items.analyze.some(({ id }: { id: string }) => id === 'framescaper-v27-motion-tracking'), true);
	assert.equal(items.mixer.some(({ id }: { id: string }) => id === 'framescaper-v27-mixer'), true);
});
