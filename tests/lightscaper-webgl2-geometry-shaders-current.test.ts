/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PIXEL_FRAME_WEBGL2_GEOMETRY_FRAGMENT_CURRENT_V1 as fragment } from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-glsl-current-v1.ts';

// These source/ABI contracts complement actual native browser rendering;
// inspecting shader text alone does not establish numerical GPU conformance.
test('geometry fragment has a dedicated highp native sampler and explicit row-major mapping ABI', () => {
	assert.match(fragment, /^#version 300 es/u); assert.match(fragment, /precision highp float;/u);
	assert.match(fragment, /uniform highp sampler2D uImage;/u);
	assert.match(fragment, /uniform vec3 uOutputToAperture\[2\];/u);
	assert.match(fragment, /uniform vec3 uApertureToSource\[3\];/u);
	assert.match(fragment, /uniform ivec4 uCropBounds;/u);
	assert.match(fragment, /uniform int uIntegerPermutation;/u);
	assert.match(fragment, /uniform ivec3 uIntegerToSource\[2\];/u);
	assert.doesNotMatch(fragment, /uKind|uCurve|uCube|colorEncoded|colorLinear|pow\(/u);
});

test('generic geometry maps output pixel centers through aperture then projective division', () => {
	assert.match(fragment, /gl_FragCoord\.xy/u);
	assert.match(fragment, /uOutputToAperture\[0\]/u); assert.match(fragment, /uOutputToAperture\[1\]/u);
	assert.match(fragment, /-1e-12/u); assert.match(fragment, /1\.0\s*\+\s*1e-12/u);
	assert.match(fragment, /clamp\(aperture,\s*vec2\(0\.0\),\s*vec2\(1\.0\)\)/u);
	for (const index of [0, 1, 2]) assert.ok(fragment.includes(`uApertureToSource[${String(index)}]`));
	assert.match(fragment, /\/\s*denominator\s*-\s*vec2\(0\.5\)/u);
	assert.match(fragment, /isnan|isinf/u);
});

test('generic geometry samples four integer taps clamped to crop bounds with native premultiplied accumulation', () => {
	assert.match(fragment, /ivec2\(floor\(position\)\)/u);
	assert.match(fragment, /for\s*\(int dy\s*=\s*0;\s*dy\s*<\s*2;/u);
	assert.match(fragment, /for\s*\(int dx\s*=\s*0;\s*dx\s*<\s*2;/u);
	assert.match(fragment, /clamp\([^;]*uCropBounds\.xy,\s*uCropBounds\.zw\)/u);
	assert.match(fragment, /texelFetch\(uImage,/u);
	assert.match(fragment, /weightedAlpha\s*=\s*color\.a\s*\*\s*weight/u);
	assert.match(fragment, /alpha\s*\+=\s*weightedAlpha/u);
	assert.match(fragment, /rgb\s*\+=\s*color\.rgb\s*\*\s*weightedAlpha/u);
	assert.doesNotMatch(fragment, /\btexture\(|textureLod|textureGrad|\bmix\(|255|65535/u);
});

test('straight output divides by unrounded alpha and canonicalizes every zero-alpha result without clipping RGB', () => {
	assert.match(fragment, /float outputAlpha\s*=\s*clamp\(alpha,\s*0\.0,\s*1\.0\)/u);
	assert.match(fragment, /outputAlpha\s*==\s*0\.0/u);
	assert.match(fragment, /vec4\(rgb\s*\/\s*alpha,\s*outputAlpha\)/u);
	assert.doesNotMatch(fragment, /rgb\s*\/\s*outputAlpha|clamp\(rgb|clamp\(color\.rgb|round\(/u);
	assert.match(fragment, /outColor\s*=\s*vec4\(0\.0\)/u);
});

test('integer permutations bypass rounded normalized coordinates but retain CPU zero canonicalization', () => {
	assert.match(fragment, /uIntegerPermutation\s*==\s*1/u);
	assert.match(fragment, /ivec2\(gl_FragCoord\.xy\)/u);
	assert.match(fragment, /uIntegerToSource\[0\]/u); assert.match(fragment, /uIntegerToSource\[1\]/u);
	assert.match(fragment, /color\.a\s*==\s*0\.0/u);
	for (const channel of ['r', 'g', 'b']) assert.match(fragment, new RegExp(`color\\.${channel}\\s*==\\s*0\\.0\\s*\\?\\s*0\\.0\\s*:\\s*color\\.${channel}`, 'u'));
	assert.match(fragment, /outColor\s*=\s*vec4\([^;]*color\.a\)/u);
});

test('geometry shader module owns only static source and introduces no executable/native lifetime owner', async () => {
	const source = await readFile(new URL('../src/common/editor/imaging/pixel-frame-webgl2-geometry-glsl-current-v1.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /OffscreenCanvas|document\.|WebGL2RenderingContext|new Float32Array|\.replace(?:All)?\(/u);
	assert.equal([...fragment.matchAll(/void main\(\)/gu)].length, 1);
});
