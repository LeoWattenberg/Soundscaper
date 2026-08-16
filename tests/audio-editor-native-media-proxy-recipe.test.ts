/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNativeMediaExportSourceIsOriginal,
	NATIVE_MEDIA_PROXY_MAXIMUM_HEIGHT,
	NATIVE_MEDIA_PROXY_MAXIMUM_WIDTH,
	NATIVE_MEDIA_PROXY_RECIPE_ID,
	NativeMediaProxyError,
	planNativeMediaProxy,
	resolveNativeMediaProxyGeometry,
} from '../src/common/editor/native-media-proxy-recipe.ts';
import {
	NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS,
} from '../src/common/editor/native-media-professional-profiles.ts';

const CLEARED = NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS;

test('the proxy fits the ceiling while preserving aspect ratio and never upscaling', () => {
	assert.deepEqual(resolveNativeMediaProxyGeometry(3_840, 2_160), {
		width: 1_280, height: 720, scaled: true,
	});
	assert.deepEqual(resolveNativeMediaProxyGeometry(4_096, 2_160), {
		width: 1_280, height: 674, scaled: true,
	});
	assert.deepEqual(resolveNativeMediaProxyGeometry(1_080, 1_920), {
		width: 404, height: 720, scaled: true,
	});
	// Already inside the ceiling: left exactly alone rather than resampled.
	assert.deepEqual(resolveNativeMediaProxyGeometry(640, 480), {
		width: 640, height: 480, scaled: false,
	});
	assert.deepEqual(
		resolveNativeMediaProxyGeometry(NATIVE_MEDIA_PROXY_MAXIMUM_WIDTH, NATIVE_MEDIA_PROXY_MAXIMUM_HEIGHT),
		{ width: 1_280, height: 720, scaled: false },
	);
});

test('proxy geometry is always an even frame size', () => {
	for (const [width, height] of [[1_921, 1_081], [999, 501], [3_841, 2_161]] as const) {
		const geometry = resolveNativeMediaProxyGeometry(width, height);
		assert.equal(geometry.width % 2, 0);
		assert.equal(geometry.height % 2, 0);
		assert.ok(geometry.width <= NATIVE_MEDIA_PROXY_MAXIMUM_WIDTH);
		assert.ok(geometry.height <= NATIVE_MEDIA_PROXY_MAXIMUM_HEIGHT);
	}
	assert.throws(() => resolveNativeMediaProxyGeometry(0, 100), NativeMediaProxyError);
	assert.throws(() => resolveNativeMediaProxyGeometry(100, -1), NativeMediaProxyError);
	assert.throws(() => resolveNativeMediaProxyGeometry(100_000, 1), /even frame size/u);
});

test('a cleared ProRes gate yields the documented recipe and nothing else', () => {
	const plan = planNativeMediaProxy({
		sourceWidth: 3_840, sourceHeight: 2_160, clearedPolicyRowIds: CLEARED,
	});

	assert.equal(plan.blocked, false);
	assert.ok(!plan.blocked);
	assert.deepEqual(plan.recipe, {
		recipeId: NATIVE_MEDIA_PROXY_RECIPE_ID,
		recipeVersion: 1,
		profileId: 'encode-mov-prores-proxy',
		container: 'mov',
		codec: 'prores_ks',
		mimeType: 'video/quicktime',
		geometry: { width: 1_280, height: 720, scaled: true },
		timingRule: 'exact-presentation-boundaries-v1',
		audioPolicy: 'ignore-proxy-container-audio-v1',
		recoveryClass: 'atomic-restart',
	});
});

test('a blocked ProRes gate blocks generation rather than substituting a codec', () => {
	const plan = planNativeMediaProxy({ sourceWidth: 1_920, sourceHeight: 1_080 });

	assert.equal(plan.blocked, true);
	assert.ok(plan.blocked);
	assert.deepEqual(plan.refusals, ['prores-gate-blocked']);
	assert.deepEqual(plan.blockedPolicyRowIds, [
		'codec-mezzanine-and-longform', 'container-mov-mxf-matroska',
	]);
	assert.equal(Object.hasOwn(plan, 'recipe'), false);
});

test('partially cleared rows still block, because every row a profile names must clear', () => {
	const plan = planNativeMediaProxy({
		sourceWidth: 1_920,
		sourceHeight: 1_080,
		clearedPolicyRowIds: ['codec-mezzanine-and-longform'],
	});

	assert.ok(plan.blocked);
	assert.deepEqual(plan.blockedPolicyRowIds, ['container-mov-mxf-matroska']);
});

test('unreported source geometry blocks rather than assuming a frame size', () => {
	for (const request of [
		{ sourceWidth: null, sourceHeight: 1_080 },
		{ sourceWidth: 1_920, sourceHeight: null },
		{ sourceWidth: null, sourceHeight: null },
	]) {
		const plan = planNativeMediaProxy({ ...request, clearedPolicyRowIds: CLEARED });
		assert.ok(plan.blocked);
		assert.deepEqual(plan.refusals, ['source-geometry-unreported']);
	}
});

test('geometry that cannot survive the ceiling blocks with its own reason', () => {
	const plan = planNativeMediaProxy({
		sourceWidth: 100_000, sourceHeight: 1, clearedPolicyRowIds: CLEARED,
	});

	assert.ok(plan.blocked);
	assert.deepEqual(plan.refusals, ['source-geometry-unusable']);
});

test('the original stays the export authority', () => {
	assert.doesNotThrow(() => assertNativeMediaExportSourceIsOriginal('original'));
	for (const role of ['proxy', 'attached-proxy', null, undefined]) {
		assert.throws(() => assertNativeMediaExportSourceIsOriginal(role), /never its authority/u);
	}
});
