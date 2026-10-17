/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1, imageGeometryForVideoEffectV1,
	normalizeImageGeometryVideoEffectV1 } from '../src/common/editor/video-image-geometry-v1.ts';
import { createVideoEffect, VIDEO_EFFECT_TYPES, VIDEO_EFFECT_V5_TYPES, normalizeVideoEffect } from '../src/common/editor/video-effects.js';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { bindImageGeometryVideoUniformsV1 } from '../src/common/editor/ui/video-preview-image-geometry-v1.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { withGeometryPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-geometry-v1.ts';

test('the versioned geometry effect is a menu-authorable numeric recipe with owning EN/DE controls', () => {
	assert.deepEqual(VIDEO_EFFECT_TYPES.filter(type => type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1), [IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1]);
	assert.equal(EFFECT_CODES[IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1], 20);
	assert.deepEqual(Object.entries(EFFECT_CODES).filter(([, code]) => code === 20).map(([type]) => type), [IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1]);
	assert.ok(EFFECT_PROGRAM_COUNT > 20, 'The owning geometry program remains linked when other effects are added.');
	assert.throws(() => normalizeVideoEffect(createVideoEffect(IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1), 'old', { allowedTypes: VIDEO_EFFECT_V5_TYPES }), /not supported/u);
	for (const copy of [VIDEO_EFFECT_COPY_BY_LOCALE.en, VIDEO_EFFECT_COPY_BY_LOCALE.de]) {
		const messages: Readonly<Record<string, string>> = copy;
		assert.ok(copy[IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1.labelKey]);
		for (const parameter of Object.values(IMAGE_GEOMETRY_VIDEO_EFFECT_DEFINITION_V1.params)) assert.ok(messages[parameter.labelKey]);
	}
});

test('shared geometry rejects invalid combined crop/quad, accessor, future, and disabled corrupt state before rendering', () => {
	let reads = 0; const base = createVideoEffect(IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1);
	const getter = Object.defineProperty({}, 'cropX', { enumerable: true, get() { reads++; return 0; } });
	for (const value of [{ ...base, future: 1 }, { ...base, enabled: false, params: getter }, { ...base, params: { cropX: 0.9, cropWidth: 0.5 } },
		{ ...base, params: { perspective: 1, topRightX: 0 } }, { ...base, params: { flipHorizontal: 0.5 } }, { ...base, params: { aspect: 7 } },
		{ ...base, params: { rotationDegrees: -0 } }]) assert.throws(() => normalizeImageGeometryVideoEffectV1(value));
	assert.equal(reads, 0);
});

test('normalized photo develop retains shared perspective settings without widening PhotoGeometryV1 and actually evaluates them', async () => {
	const effect = createVideoEffect(IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, { id: 'geometry', params: { perspective: 1, bottomRightX: 0.75, bottomLeftX: 0.25 } });
	const develop = normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects: [effect] });
	assert.deepEqual(develop.geometry, defaultPhotoDevelopV1().geometry); Object.assign(effect.params, { bottomRightX: 1 });
	assert.equal(develop.effects[0]?.params.bottomRightX, 0.75);
	const source = new Uint8Array([0, 10, 20, 255, 100, 110, 120, 255, 50, 60, 70, 255, 150, 160, 170, 255]);
	const actual = await withGeometryPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source },
		geometry: imageGeometryForVideoEffectV1(develop.effects[0], 2, 2) }, output => Array.from(output.pixels),
		{ limits: { maximumSidePixels: 32, maximumPixels: 1024, maximumBytes: 4096 } });
	assert.deepEqual(actual, [25, 35, 45, 255, 105, 115, 125, 255, 71, 81, 91, 255, 129, 139, 149, 255]);
	assert.equal(Object.isFrozen(develop.effects[0]?.params), true);
});

test('preview carries the exact contained crop inverse matrix and physical sample bounds rather than a stretch', () => {
	const effect = createVideoEffect(IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, { params: { cropX: 0.25, cropWidth: 0.5 } });
	const pass = videoEffectPasses(effect)[0]; assert.equal(pass?.code, 20); assert.ok(pass && 'geometry' in pass); assert.equal(Object.isFrozen(pass.geometry), true);
	const matrices: number[][] = [], bounds: number[][] = [];
	const gl = { uniformMatrix3fv(_location: unknown, _transpose: boolean, matrix: number[]) { matrices.push(matrix); },
		uniform4f(_location: unknown, ...values: number[]) { bounds.push(values); } } as unknown as WebGL2RenderingContext;
	bindImageGeometryVideoUniformsV1(gl, { geometryOutput: null, geometrySource: null, geometryBounds: null }, pass.geometry, 4, 2);
	assert.deepEqual(matrices[0], [0.5, 0, 0, 0, 0.5, 0, -0.5, 0, 1]);
	assert.deepEqual(matrices[1], [2, 0, 0, 0, 2, 0, 1, 0, 1]); assert.deepEqual(bounds, [[1, 0, 2, 1]]);
	assert.deepEqual(videoEffectPasses({ ...effect, enabled: false }), []);
});
