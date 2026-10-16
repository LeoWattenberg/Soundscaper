/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PIXEL_FRAME_WEBGL2_SPATIAL_FRAGMENT_CURRENT_V1 as fragment } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_SPATIAL_NEIGHBORHOOD_FUNCTIONS_CURRENT_V1 as neighborhoods } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-neighborhood-glsl-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_SPATIAL_LATTICE_FUNCTIONS_CURRENT_V1 as lattice } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-lattice-glsl-current-v1.ts';

// ABI and branch-structure contracts only. These tests do not execute GLSL.
// Native browser readback, CPU parity and truthful fallback qualify arithmetic.
test('native spatial has a separate highp integer-texel program with the exact two-vec4 ABI', () => {
	assert.match(fragment, /^#version 300 es/u);
	for (const declaration of ['precision highp float;', 'precision highp int;', 'uniform highp sampler2D uImage;',
		'uniform int uSpatialKind;', 'uniform ivec2 uExtent;', 'uniform vec4 uParams0;', 'uniform vec4 uParams1;']) assert.ok(fragment.includes(declaration));
	assert.equal([...fragment.matchAll(/\buniform\b/gu)].length, 5);
	assert.equal([...fragment.matchAll(/void main\(\)/gu)].length, 1);
	assert.ok(fragment.includes(neighborhoods)); assert.ok(fragment.includes(lattice));
	assert.doesNotMatch(fragment, /\btexture\(|textureLod|sampler3D|uCurve|uBands/u);
});

test('all seven native families dispatch from the exact kind without omitting active work', () => {
	const main = fragment.slice(fragment.indexOf('void main()'));
	const routes = [[14, 'spatialDetailCurrentV1'], [15, 'spatialVignetteCurrentV1'], [16, 'spatialClarityCurrentV1'],
		[17, 'spatialNoiseCurrentV1'], [18, 'spatialGrainCurrentV1'], [19, 'spatialTextureCurrentV1'], [20, 'spatialDehazeCurrentV1']] as const;
	for (const [kind, name] of routes) assert.match(main, new RegExp('uSpatialKind\\s*==\\s*' + String(kind) + '\\)\\s*next\\s*=\\s*' + name, 'u'));
	assert.equal([...main.matchAll(/uSpatialKind\s*==/gu)].length, routes.length);
	const bypass = main.indexOf('if (uParams1.w == 0.0 || center.a == 0.0)');
	assert.ok(bypass >= 0 && bypass < main.indexOf('vec3 encoded ='));
	assert.match(main, /outColor\s*=\s*center;\s*return;/u);
	for (const channel of ['r', 'g', 'b']) assert.match(main, new RegExp('next\\.' + channel + '\\s*==\\s*encoded\\.' + channel + '\\s*\\?\\s*center\\.' + channel, 'u'));
	assert.match(main, /spatialLinearCurrentV1\(next\.b\),\s*center\.a\)/u);
});

test('direct native means retain binomial neighborhoods and replicated immutable input with no rounded mean', () => {
	for (const bins of ['int[3](1, 2, 1)', 'int[5](1, 4, 6, 4, 1)', 'int[7](1, 6, 15, 20, 15, 6, 1)']) assert.ok(neighborhoods.includes(bins));
	assert.match(neighborhoods, /texelFetch\(uImage,\s*clamp\(index,\s*ivec2\(0\),\s*uExtent\s*-\s*ivec2\(1\)\),\s*0\)/u);
	const mean = section('float spatialMeanCurrentV1', 'float spatialDarkCurrentV1');
	assert.match(mean, /for \(int dy = -3; dy <= 3; dy\+\+\) for \(int dx = -3; dx <= 3; dx\+\+\)/u);
	assert.match(mean, /abs\(dx\) > radius \|\| abs\(dy\) > radius/u);
	assert.match(mean, /if \(neighbor\.a == 0\.0\) continue;/u);
	assert.match(mean, /neighbor\.a \* float\(spatialBinCurrentV1\(radius, dx\)\) \* float\(spatialBinCurrentV1\(radius, dy\)\)/u);
	assert.match(mean, /weight \+= w; sum \+= w \* sampleValue;/u);
	assert.match(mean, /return sum \/ weight;/u);
	assert.doesNotMatch(mean, /floor\(|round\(|clamp\(sum|imageStore|textureLod/u);
});

test('native detail clarity and texture retain their distinct threshold gates and direct means', () => {
	const detail = section('vec3 spatialDetailCurrentV1', 'vec3 spatialClarityCurrentV1');
	assert.match(detail, /spatialMeanCurrentV1\(index, 1, channel\)/u);
	assert.match(detail, /abs\(delta\) \* 255\.0 <= uParams0\.y \? original : original \+ delta \* uParams0\.x \/ 256\.0/u);
	const clarity = section('vec3 spatialClarityCurrentV1', 'vec3 spatialTextureCurrentV1');
	assert.match(clarity, /spatialMeanCurrentV1\(index, 3, -1\)/u);
	assert.match(clarity, /2\.0 \* min\(luma, 1\.0 - luma\) \* 255\.0 \/ 254\.0/u);
	const texture = section('vec3 spatialTextureCurrentV1', 'vec3 spatialGrainCurrentV1');
	assert.match(texture, /spatialMeanCurrentV1\(index, 1, -1\)/u); assert.match(texture, /spatialMeanCurrentV1\(index, 2, -1\)/u);
	assert.match(texture, /1\.0 - 4\.0 \* 255\.0 \* abs\(spatialLumaCurrentV1\(encoded\) - coarse\) \/ 256\.0/u);
	assert.match(texture, /\(fine - coarse\) \* uParams0\.x \/ 256\.0 \* gate/u);
});

test('noise keeps continuous YCoCg branches on the same immutable source and avoids protected inverse round trips', () => {
	const noise = section('vec3 spatialNoiseCurrentV1', 'int spatialFloorCurrentV1');
	assert.match(noise, /t = \(encoded\.r \+ encoded\.b\) \/ 2\.0/u);
	assert.match(noise, /cg = encoded\.g - t, luma = t \+ cg \/ 2\.0/u);
	assert.match(noise, /ny = \(rgb\.r \+ rgb\.b\) \/ 4\.0 \+ rgb\.g \/ 2\.0/u);
	assert.match(noise, /if \(uParams0\.x != 0\.0\)/u); assert.match(noise, /if \(uParams0\.w != 0\.0\)/u);
	assert.equal([...noise.matchAll(/spatialSourceCurrentV1\(index \+ ivec2\(dx, dy\)\)/gu)].length, 2);
	assert.match(noise, /uParams0\.z \/ 256\.0 \* clamp\(maximum - minimum, 0\.0, 1\.0\)/u);
	assert.match(noise, /inner \* 16\.0 \* \(1\.0 - uParams1\.y \/ 256\.0\)/u);
	assert.match(noise, /distance \* 255\.0 \* uParams1\.x \/ 256\.0/u);
	assert.match(noise, /nextY == luma && nextCo == co && nextCg == cg\) return encoded;/u);
	assert.match(noise, /nextT = nextY - nextCg \/ 2\.0, nextBlue = nextT - nextCo \/ 2\.0/u);
	assert.match(noise, /return vec3\(nextBlue \+ nextCo, nextCg \+ nextT, nextBlue\)/u);
	assert.doesNotMatch(noise, /floor\(|round\(|clamp\(next|ivec3/u);
});

test('grain retains unsigned integer polynomial hash and signed floor lattice rather than a float or byte noise model', () => {
	assert.match(lattice, /return numerator >= 0 \? numerator \/ denominator : -\(\(-numerator \+ denominator - 1\) \/ denominator\)/u);
	assert.match(lattice, /uint spatialGrainHashCurrentV1\(uint value\)/u);
	assert.match(lattice, /\(value \* value \+ 31u \* value \+ 17u\) % 65521u/u);
	assert.match(lattice, /x \* 73u \+ y \* 151u \+ seed \* 199u \+ 101u/u);
	assert.match(lattice, /\(\(2u \* index \+ uvec2\(1u\)\) \* 32768u\) \/ spacing/u);
	assert.match(lattice, /spatialFloorCurrentV1\(sum \+ 32768, 65536\)/u);
	assert.match(lattice, /spacing \/ 2u, seed/u);
	assert.match(lattice, /spatialFloorCurrentV1\(first \* \(256 - roughness\) \+ second \* roughness \+ 128, 256\)/u);
	const grain = section('vec3 spatialGrainCurrentV1', 'vec3 spatialDehazeCurrentV1');
	assert.match(grain, /float\(spatialGrainNoiseCurrentV1\(index\)\) \* uParams0\.x \/ 256\.0 \* response \/ 1024\.0/u);
	assert.doesNotMatch(grain, /floor\(|round\(|255|ivec3|clamp\(encoded/u);
});

test('post-crop coverage retains signed integer Q8 centers Q16 feather and integer smoothstep before continuous RGB', () => {
	assert.match(lattice, /spatialFloorCurrentV1\(2 \* \(2 \* position \+ 1 - size\) \* 256 \+ denominator, 2 \* denominator\)/u);
	assert.match(lattice, /side = min\(uExtent\.x, uExtent\.y\)/u);
	assert.match(lattice, /circle = min\(131072, cx \* cx \+ cy \* cy\)/u);
	assert.match(lattice, /roundness < 0 \? square : circle/u);
	assert.match(lattice, /spatialFloorCurrentV1\(\(distance - int\(uParams0\.y\)\) \* 256, max\(1, int\(uParams0\.z\)\)\)/u);
	assert.match(lattice, /\(t \* t \* \(768 - 2 \* t\) \+ 32768\) \/ 65536/u);
	const vignette = section('vec3 spatialVignetteCurrentV1', 'void main');
	assert.match(vignette, /float\(spatialVignetteWeightCurrentV1\(index\)\) \/ 256\.0/u);
	assert.match(vignette, /clamp\(max\(encoded\.r, max\(encoded\.g, encoded\.b\)\), 0\.0, 1\.0\) \* uParams1\.x \/ 256\.0/u);
	assert.match(vignette, /return encoded \+ \(vec3\(destination\) - encoded\) \* amount/u);
	assert.doesNotMatch(vignette, /floor\(|round\(|ivec3|clamp\(encoded/u);
});

test('dehaze keeps alpha-composited dark input and separate continuous fog or transmission branches', () => {
	const dark = section('float spatialDarkCurrentV1', 'vec3 spatialNoiseCurrentV1');
	assert.match(dark, /dark = min\(dark, low \* neighbor\.a \+ 1\.0 - neighbor\.a\)/u);
	assert.doesNotMatch(dark, /neighbor\.a == 0\.0|continue;/u);
	const dehaze = section('vec3 spatialDehazeCurrentV1', 'vec3 spatialVignetteCurrentV1');
	assert.match(dehaze, /if \(uParams0\.x < 0\.0\) return encoded \+ \(vec3\(1\.0\) - encoded\) \* uParams0\.y \/ 256\.0/u);
	assert.match(dehaze, /max\(26\.0 \/ 256\.0, 1\.0 - spatialDarkCurrentV1\(index\) \* uParams0\.x \/ 256\.0 \* 243\.0 \/ 256\.0\)/u);
	assert.match(dehaze, /return vec3\(1\.0\) \+ \(encoded - vec3\(1\.0\)\) \/ transmission/u);
});

test('native transfer stays continuous sign-symmetric and RGB never enters a byte or clipped working plane', async () => {
	assert.match(neighborhoods, /sign\(value\) \* \(magnitude <= 0\.0031308/u);
	assert.match(neighborhoods, /sign\(value\) \* \(magnitude <= 0\.04045/u);
	assert.match(neighborhoods, /54\.0 \* value\.r \+ 183\.0 \* value\.g \+ 19\.0 \* value\.b/u);
	assert.doesNotMatch(fragment, /round\(|floor\(|clamp\(next|clamp\(encoded|color\s*\*\s*255|\/\s*65535|sampler2DArray/u);
	for (const name of ['spatial', 'spatial-neighborhood', 'spatial-lattice']) {
		const source = await readFile(new URL('../src/common/editor/imaging/pixel-frame-webgl2-' + name + '-glsl-current-v1.ts', import.meta.url), 'utf8');
		assert.doesNotMatch(source, /video-preview|ffmpeg|OffscreenCanvas|document\.|WebGL2RenderingContext|\.replace(?:All)?\(/u);
	}
});

function section(start: string, end: string): string {
	const from = fragment.indexOf(start), to = fragment.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from); return fragment.slice(from, to);
}
