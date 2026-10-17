/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const BASE = new URL('../src/common/editor/imaging/', import.meta.url);
interface Color {
	readonly PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1: string;
	readonly buildPixelFrameWebGl2ColorFragmentCurrentV1: (uniforms?: string, functions?: string, branch?: string) => string;
}
interface Lut { readonly PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1: string; readonly PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1: string }
async function modules() {
	const color: unknown = await import(new URL('pixel-frame-webgl2-color-glsl-current-v1.ts', BASE).href);
	const lut: unknown = await import(new URL('pixel-frame-webgl2-lut-glsl-current-v1.ts', BASE).href);
	return { color: color as Color, lut: lut as Lut };
}

// Source/ABI tests only. The actual native browser corpus separately proves
// authenticated table upload, numerical output, resource limits and retirement.
test('LUT fragment shares the complete color fragment through a static extension builder', async () => {
	const { color, lut } = await modules();
	assert.equal(typeof color.buildPixelFrameWebGl2ColorFragmentCurrentV1, 'function');
	assert.equal(typeof lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1, 'string');
	assert.equal(color.buildPixelFrameWebGl2ColorFragmentCurrentV1(), color.PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1);
	assert.equal(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1, color.buildPixelFrameWebGl2ColorFragmentCurrentV1(
		'precision highp sampler3D;\nuniform sampler3D uCube;', lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1, 'if (uKind == 8) rgb = cubeColorCurrentV1(rgb);'));
	const common = color.PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1, extended = lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1;
	for (const marker of ['float colorEncodedCurrentV1', 'float colorLinearCurrentV1', 'float colorWheelCurrentV1', 'vec3 wheelsColorCurrentV1']) {
		assert.equal(functionBody(extended, marker), functionBody(common, marker));
	}
	const branch = 'if (uKind == 8) rgb = cubeColorCurrentV1(rgb);';
	assert.equal(functionBody(extended, 'void main').replace(branch, '').replaceAll(/\s+/gu, ' '),
		functionBody(common, 'void main').replaceAll(/\s+/gu, ' '));
	assert.equal(extended.split(lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1).length, 2);
});

test('static shader extensions occupy explicit uniform function and main-body insertion sites', async () => {
	const { color } = await modules();
	const uniform = 'uniform float uExtension;', fn = 'vec3 extensionColor(vec3 rgb) { return rgb; }';
	const branch = 'if (uKind == 9) rgb = extensionColor(rgb);';
	const fragment = color.buildPixelFrameWebGl2ColorFragmentCurrentV1(uniform, fn, branch);
	assert.ok(fragment.indexOf(uniform) < fragment.indexOf('void main'));
	assert.ok(fragment.indexOf(fn) < fragment.indexOf('void main'));
	assert.ok(fragment.indexOf(branch) > fragment.indexOf('vec3 rgb = color.rgb;'));
	assert.ok(fragment.indexOf(branch) < fragment.indexOf('if (uKind == 1 || uKind == 2)'));
	assert.doesNotMatch(color.PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1, /uCube|uExtension|uKind == 8|uKind == 9/u);
	const source = await readFile(new URL('pixel-frame-webgl2-color-glsl-current-v1.ts', BASE), 'utf8');
	assert.doesNotMatch(source, /\.replace(?:All)?\(/u, 'build variants from shared static parts rather than rewriting generated shader source');
});

test('native LUT coordinates clamp only the declared domain and bound all taps to the actual pass size', async () => {
	const { lut } = await modules(), functions = lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1;
	assert.match(functions, /int size\s*=\s*int\(uParams0\.w\)/u);
	assert.match(functions, /clamp\(\(rgb\s*-\s*uParams0\.xyz\)\s*\/\s*\(uParams1\.xyz\s*-\s*uParams0\.xyz\),\s*vec3\(0\.0\),\s*vec3\(1\.0\)\)\s*\*\s*float\(size\s*-\s*1\)/u);
	assert.match(functions, /ivec3 low\s*=\s*ivec3\(floor\(position\)\)/u);
	assert.match(functions, /high\s*=\s*min\(low\s*\+\s*ivec3\(1\),\s*ivec3\(size\s*-\s*1\)\)/u);
	assert.match(functions, /vec3 amount\s*=\s*position\s*-\s*vec3\(low\)/u);
	assert.equal([...functions.matchAll(/\bclamp\(/gu)].length, 1);
	assert.doesNotMatch(functions, /textureSize|\btexture\(|colorEncoded|colorLinear|pow\(|255|65535/u);
});

test('manual eight-corner fetches map cube R G B to texture x y z without hardware interpolation', async () => {
	const { lut } = await modules(), functions = lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1;
	for (const r of [0, 1]) for (const g of [0, 1]) for (const b of [0, 1]) {
		const corner = `c${String(r)}${String(g)}${String(b)}`;
		const coordinates = `${r ? 'high' : 'low'}.x, ${g ? 'high' : 'low'}.y, ${b ? 'high' : 'low'}.z`;
		assert.ok(functions.includes(`${corner} = texelFetch(uCube, ivec3(${coordinates}), 0).rgb`), `${corner} red-fastest coordinate`);
	}
	assert.equal([...functions.matchAll(/texelFetch\(uCube,/gu)].length, 8);
	assert.doesNotMatch(functions, /\bmix\(|sampler2D|textureLod|textureGrad/u);
});

test('native LUT difference lerps follow CPU blue then green then red order without output clipping or alpha multiplication', async () => {
	const { lut } = await modules(), functions = lut.PIXEL_FRAME_WEBGL2_LUT_FUNCTIONS_CURRENT_V1;
	assert.match(functions, /return a\s*\+\s*\(b\s*-\s*a\)\s*\*\s*amount/u);
	for (const [name, a, b] of [['z00', 'c000', 'c001'], ['z01', 'c010', 'c011'], ['z10', 'c100', 'c101'], ['z11', 'c110', 'c111']]) {
		assert.ok(functions.includes(`${name} = cubeLerpCurrentV1(${a}, ${b}, amount.z)`));
	}
	assert.ok(functions.includes('cubeLerpCurrentV1(cubeLerpCurrentV1(z00, z01, amount.y), cubeLerpCurrentV1(z10, z11, amount.y), amount.x)'));
	assert.doesNotMatch(functions, /clamp\(\s*(?:result|output|z00|z01|z10|z11)|\.a\b|alpha|round\(/u);
	assert.match(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1, /outColor\s*=\s*vec4\(rgb,\s*color\.a\)/u);
});

test('LUT variant adds one sampler slot and remains a pure shader module with the exact native color functions', async () => {
	const { color, lut } = await modules();
	const vectors = (fragment: string) => [...fragment.matchAll(/uniform\s+(?:sampler[23]D|int|ivec4|vec[234])\s+\w+(?:\[(\d+)\])?;/gu)]
		.reduce((count, match) => count + Number(match[1] ?? 1), 0);
	assert.equal(vectors(color.PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1), 142);
	assert.equal(vectors(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1), 143);
	assert.match(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1, /^#version 300 es/u);
	assert.match(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1, /precision highp sampler3D;\s*uniform sampler3D uCube;/u,
		'GLSL ES provides no default sampler3D precision; lattice reads require explicit highp');
	for (const name of ['GLOBAL', 'CHROMA', 'CURVES']) {
		const module: unknown = await import(new URL(`pixel-frame-webgl2-${name === 'GLOBAL' ? 'global-current' : `${name.toLowerCase()}-glsl-current`}-v1.ts`, BASE).href);
		const functions = (module as Readonly<Record<string, string>>)[`PIXEL_FRAME_WEBGL2_${name}_FUNCTIONS_CURRENT_V1`]!;
		assert.equal(lut.PIXEL_FRAME_WEBGL2_LUT_FRAGMENT_CURRENT_V1.split(functions).length, 2);
	}
	const source = await readFile(new URL('pixel-frame-webgl2-lut-glsl-current-v1.ts', BASE), 'utf8');
	assert.doesNotMatch(source, /OffscreenCanvas|document\.|WebGL2RenderingContext|parseCube|withBytes|\.replace(?:All)?\(/u);
});

function functionBody(source: string, marker: string): string {
	const start = source.indexOf(marker); assert.ok(start >= 0, marker);
	const opening = source.indexOf('{', start); assert.ok(opening >= 0);
	let depth = 1, end = opening + 1;
	for (; end < source.length && depth > 0; end++) { if (source[end] === '{') depth++; else if (source[end] === '}') depth--; }
	assert.equal(depth, 0); return source.slice(opening, end);
}
