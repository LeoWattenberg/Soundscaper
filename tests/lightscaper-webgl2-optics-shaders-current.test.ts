/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PIXEL_FRAME_WEBGL2_OPTICS_FRAGMENT_CURRENT_V1 as fragment } from '../src/common/editor/imaging/pixel-frame-webgl2-optics-glsl-current-v1.ts';

// Structural contracts only: actual GL/browser literals separately qualify
// native arithmetic, numerical fallback and resource retirement.
test('native optics has a separate highp texel program and closed two-vec4 stage-local ABI', () => {
	assert.match(fragment, /^#version 300 es/u); assert.match(fragment, /precision highp float;/u);
	for (const declaration of ['uniform highp sampler2D uImage;', 'uniform int uOpticsKind;', 'uniform ivec2 uExtent;',
		'uniform vec4 uParams0;', 'uniform vec4 uParams1;']) assert.ok(fragment.includes(declaration));
	for (const kind of [10, 11, 12, 13]) assert.match(fragment, new RegExp(`uOpticsKind\\s*==\\s*${String(kind)}`, 'u'));
	assert.match(fragment, /uParams1\.w\s*==\s*0\.0/u);
	assert.doesNotMatch(fragment, /\btexture\(|textureLod|sampler3D|uCurve|255|65535|round\(/u);
});

test('lens retains signed radial displacement fractions and zero-extended four-tap premultiplied support', () => {
	const body = section('vec4 opticsLensCurrentV1', 'float opticsCaChannelCurrentV1');
	assert.match(body, /delta\s*\*\s*\(uParams0\.x\s*\*\s*radiusSquared\)/u);
	assert.match(body, /abs\(shift\)/u); assert.match(body, /floor\(magnitude\)/u);
	assert.match(body, /magnitude\s*-\s*vec2\(whole\)/u);
	assert.match(body, /low\s*=\s*index\s*\+\s*direction\s*\*\s*whole/u);
	assert.match(body, /source\s*=\s*low\s*\+\s*direction\s*\*\s*ivec2\(dx,\s*dy\)/u);
	assert.doesNotMatch(body, /floor\(position\)|1\.0\s*\+\s*uParams0\.x/u);
	assert.match(body, /for\s*\(int dy\s*=\s*0;\s*dy\s*<\s*2;/u);
	assert.match(body, /for\s*\(int dx\s*=\s*0;\s*dx\s*<\s*2;/u);
	assert.match(body, /opticsOutsideCurrentV1\(source\)/u); assert.doesNotMatch(body, /clamp\(source/u);
	assert.match(body, /weightedAlpha\s*=\s*color\.a\s*\*\s*weight/u);
	assert.match(body, /rgb\s*\+=\s*color\.rgb\s*\*\s*weightedAlpha/u);
	assert.match(body, /vec4\(rgb\s*\/\s*alpha,\s*outputAlpha\)/u); assert.match(body, /outputAlpha\s*==\s*0\.0/u);
});

test('CA retains signed displacement fractions, channel alpha and independent raw activity flags', () => {
	const body = section('float opticsCaChannelCurrentV1', 'float opticsEncodedCurrentV1');
	assert.match(body, /delta\s*\*\s*\(coefficient\s*\*\s*radiusSquared\)/u);
	assert.match(body, /abs\(shift\)/u); assert.match(body, /floor\(magnitude\)/u);
	assert.match(body, /magnitude\s*-\s*vec2\(whole\)/u);
	assert.match(body, /alpha\s*==\s*0\.0\s*\?\s*0\.0\s*:\s*value\s*\/\s*alpha/u);
	assert.doesNotMatch(body, /round\(|clamp\(alpha|1\.0\s*\+\s*coefficient/u);
	assert.match(fragment, /uParams1\.x\s*!=\s*0\.0\s*\?\s*opticsCaChannelCurrentV1/u);
	assert.match(fragment, /uParams1\.y\s*!=\s*0\.0\s*\?\s*opticsCaChannelCurrentV1/u);
	assert.match(fragment, /vec4\(red,\s*center\.g,\s*blue,\s*center\.a\)/u);
});

test('Defringe evaluates continuous odd transfer and alpha-weighted opponent DIFFERENCES with clamped logical neighbors', () => {
	const body = section('vec4 opticsDefringeCurrentV1', 'vec4 opticsVignetteCurrentV1');
	assert.match(body, /center\.a\s*==\s*0\.0/u); assert.match(body, /dx\s*==\s*0\s*&&\s*dy\s*==\s*0/u);
	assert.match(body, /clamp\(index\s*\+\s*ivec2\(dx,\s*dy\),\s*ivec2\(0\),\s*uExtent\s*-\s*ivec2\(1\)\)/u);
	assert.match(body, /neighbor\.a\s*<=\s*0\.0/u);
	assert.match(body, /purpleDifference\s*\+=\s*neighbor\.a\s*\*\s*\(centerPurple\s*-\s*opticsPurpleCurrentV1\(encodedNeighbor\)\)/u);
	assert.match(body, /greenDifference\s*\+=\s*neighbor\.a\s*\*\s*\(centerGreen\s*-\s*opticsGreenCurrentV1\(encodedNeighbor\)\)/u);
	assert.match(body, /weight\s*==\s*0\.0/u); assert.match(body, /next\.r\s*==\s*encoded\.r\s*\?\s*center\.r/u);
	assert.match(fragment, /0\.0031308/u); assert.match(fragment, /0\.04045/u); assert.match(fragment, /54\.0/u); assert.match(fragment, /183\.0/u); assert.match(fragment, /19\.0/u);
	assert.doesNotMatch(body, /clamp\(next|clamp\(encoded|\bmix\(/u);
});

test('optical vignette directly multiplies linear light with stage-local exp2 and exact bypasses', () => {
	const body = section('vec4 opticsVignetteCurrentV1', 'void main');
	assert.match(body, /center\.a\s*==\s*0\.0/u); assert.match(body, /2\s*\*\s*index\s*\+\s*ivec2\(1\)\s*-\s*uExtent/u);
	assert.match(body, /exp2\(uParams0\.x\s*\*\s*radiusSquared\)/u); assert.match(body, /gain\s*==\s*1\.0/u);
	for (const channel of ['r', 'g', 'b']) assert.match(body, new RegExp(`center\\.${channel}\\s*==\\s*0\\.0\\s*\\?\\s*center\\.${channel}\\s*:\\s*center\\.${channel}\\s*\\*\\s*gain`, 'u'));
	assert.doesNotMatch(body, /Encoded|Linear|clamp\(|pow\(/u);
});

test('optics module is static native shader source without borrowed CPU/video shader ownership', async () => {
	const source = await readFile(new URL('../src/common/editor/imaging/pixel-frame-webgl2-optics-glsl-current-v1.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /video-preview|ffmpeg|OffscreenCanvas|document\.|WebGL2RenderingContext|\.replace(?:All)?\(/u);
	assert.equal([...fragment.matchAll(/void main\(\)/gu)].length, 1);
});
function section(start: string, end: string): string {
	const from = fragment.indexOf(start), to = fragment.indexOf(end, from + start.length); assert.ok(from >= 0 && to > from); return fragment.slice(from, to);
}
