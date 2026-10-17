/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const BASE = new URL('../src/common/editor/imaging/', import.meta.url);
interface Shaders { readonly global: string; readonly old: string; readonly chroma: string; readonly curves: string; readonly fragment: string }
async function shaders(): Promise<Shaders> {
	const names = ['pixel-frame-webgl2-global-current-v1.ts', 'pixel-frame-webgl2-chroma-glsl-current-v1.ts',
		'pixel-frame-webgl2-curves-glsl-current-v1.ts', 'pixel-frame-webgl2-color-glsl-current-v1.ts'];
	const modules = await Promise.all(names.map(async name => {
		const value: unknown = await import(new URL(name, BASE).href); return value as Readonly<Record<string, unknown>>;
	}));
	const strings = [modules[0]!.PIXEL_FRAME_WEBGL2_GLOBAL_FUNCTIONS_CURRENT_V1, modules[0]!.PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1,
		modules[1]!.PIXEL_FRAME_WEBGL2_CHROMA_FUNCTIONS_CURRENT_V1, modules[2]!.PIXEL_FRAME_WEBGL2_CURVES_FUNCTIONS_CURRENT_V1,
		modules[3]!.PIXEL_FRAME_WEBGL2_COLOR_FRAGMENT_CURRENT_V1];
	for (const value of strings) assert.equal(typeof value, 'string');
	return { global: strings[0] as string, old: strings[1] as string, chroma: strings[2] as string, curves: strings[3] as string, fragment: strings[4] as string };
}

// These Node cases certify the actual shader-source ABI and extraction. Native
// shader execution, Float32 numerical conformance and capability fallback are
// separately qualified in the pinned software-GPU browser corpus.
test('native color fragment admits the full prepared uniform ABI and integer straight-alpha texel transport', async () => {
	const { fragment } = await shaders();
	assert.match(fragment, /^#version 300 es/u);
	for (const declaration of ['precision highp float;', 'precision highp int;', 'uniform sampler2D uImage;', 'uniform int uKind;',
		'uniform vec4 uParams0;', 'uniform vec4 uParams1;', 'uniform vec4 uParams2;', 'uniform vec4 uBands[8];',
		'uniform ivec4 uCurveCounts;', 'uniform vec2 uCurvePoints[128];']) assert.ok(fragment.includes(declaration), declaration);
	assert.match(fragment, /texelFetch\(uImage,\s*ivec2\(gl_FragCoord\.xy\),\s*0\)/u);
	assert.match(fragment, /outColor\s*=\s*vec4\(rgb,\s*color\.a\)/u);
	for (let kind = 1; kind <= 7; kind++) assert.match(fragment, new RegExp(`uKind\\s*==\\s*${String(kind)}\\b`, 'u'));
	assert.doesNotMatch(fragment, /UNSIGNED_BYTE|uLookup|uTable|sampler2D\s+(?:lookup|table)|texture\(/u);
});

test('old and extended fragments contain one identical extracted WB/full-tone implementation', async () => {
	const { global, old, fragment } = await shaders();
	assert.ok(global.length > 300);
	for (const target of [old, fragment]) {
		assert.equal(target.split(global).length, 2, 'include the exact common native math once');
		assert.match(target, /globalColorCurrentV1\(color\.rgb\)/u);
	}
	assert.match(global, /rgb\s*\*\s*uParams0\.xyz/u);
	assert.match(global, /rgb\s*\*\s*uParams0\.x\s*\*\s*uParams0\.y\s*\+\s*vec3\(0\.18\s*\*\s*\(1\.0\s*-\s*uParams0\.y\)\)/u);
	for (const bound of ['0.5, 1.0', '0.0, 0.5', '0.75, 1.0', '0.0, 0.25']) assert.ok(global.includes(bound));
	assert.doesNotMatch(global, /clamp\(\s*(?:rgb|exposed|result|color)\b/u);
});

test('encoded-domain native families use odd extended sRGB and preserve every unchanged channel before inverse transfer', async () => {
	const { fragment } = await shaders();
	for (const value of ['0.0031308', '12.92', '1.055', '0.055', '0.04045', '2.4']) assert.ok(fragment.includes(value));
	assert.match(fragment, /sign\(value\)\s*\*/u);
	assert.match(fragment, /abs\(value\)/u);
	for (const channel of ['r', 'g', 'b']) {
		assert.match(fragment, new RegExp(`next\\.${channel}\\s*==\\s*encoded\\.${channel}\\s*\\?\\s*color\\.(?:rgb\\.)?${channel}\\s*:\\s*colorLinearCurrentV1\\(next\\.${channel}\\)`, 'u'));
	}
	assert.doesNotMatch(fragment, /clamp\(\s*(?:rgb|encoded|next|color|gained|value)\b/u);
});

test('chroma keeps continuous weighted luma and applies saturation before adaptive vibrance without byte clipping', async () => {
	const { chroma } = await shaders();
	assert.match(chroma, /54\.0\s*\*\s*rgb\.r\s*\+\s*183\.0\s*\*\s*rgb\.g\s*\+\s*19\.0\s*\*\s*rgb\.b/u);
	assert.match(chroma, /\/\s*256\.0/u);
	assert.match(chroma, /1\.0\s*\+\s*uParams0\.x\s*\/\s*100\.0/u);
	assert.match(chroma, /rgb\s*=\s*vec3\(firstY\)\s*\+\s*\(rgb\s*-\s*vec3\(firstY\)\)\s*\*\s*saturation/u);
	assert.match(chroma, /1\.0\s*\+\s*uParams0\.y\s*\/\s*100\.0\s*\*\s*\(1\.0\s*-\s*clamp\(/u);
	assert.ok(chroma.indexOf('firstY') < chroma.indexOf('float factor'));
	assert.doesNotMatch(chroma, /round\(|floor\([^)]*255|Q8|Q16|clamp\(rgb/u);
});

test('black-white and HSL retain original hue-band interpolation, cyclic knots and exact gray bypass', async () => {
	const { chroma } = await shaders();
	assert.match(chroma, /float\[9\]\(0\.0,\s*0\.5,\s*1\.0,\s*2\.0,\s*3\.0,\s*4\.0,\s*4\.5,\s*5\.0,\s*6\.0\)/u);
	assert.match(chroma, /uBands\[left\]\.xyz/u); assert.match(chroma, /uBands\[\(left\s*\+\s*1\)\s*%\s*8\]\.xyz/u);
	assert.match(chroma, /a\s*\+\s*\(b\s*-\s*a\)\s*\*/u);
	assert.match(chroma, /if\s*\(chroma\s*==\s*0\.0\)\s*return rgb/u);
	assert.match(chroma, /colorLumaCurrentV1\(rgb\)\s*\+\s*chroma\s*\*\s*controls\.x\s*\/\s*100\.0/u);
	assert.match(chroma, /uKind\s*==\s*4/u);
	assert.doesNotMatch(chroma, /mix\(/u);
});

test('HSL correction retains the signed offset and HDR span instead of clamping the incoming RGB cube', async () => {
	const { chroma } = await shaders();
	assert.match(chroma, /offset\s*=\s*min\(0\.0,\s*minimum\)/u);
	assert.match(chroma, /span\s*=\s*max\(1\.0,\s*maximum\s*-\s*offset\)/u);
	assert.match(chroma, /hueControl\s*\/\s*60\.0/u);
	assert.match(chroma, /if\s*\(turn\s*==\s*0\.0\)/u);
	assert.match(chroma, /offset\)\s*\+\s*span\s*\*/u);
	assert.match(chroma, /mod\(mod\(position\s*\+\s*turn,\s*6\.0\)\s*\+\s*6\.0,\s*6\.0\)/u);
	assert.match(chroma, /1\.0\s*-\s*abs\(2\.0\s*\*\s*lightness\s*-\s*1\.0\)/u);
});

test('native curves use bounded authored points, identity bypass and endpoint extrapolation with zero-width guards', async () => {
	const { curves } = await shaders();
	assert.match(curves, /uParams0\[channel\]\s*!=\s*0\.0/u);
	assert.match(curves, /uCurveCounts\[channel\]/u);
	assert.match(curves, /channel\s*\*\s*32/u);
	assert.match(curves, /for\s*\(int\s+\w+\s*=\s*0;\s*\w+\s*<\s*32;/u);
	assert.match(curves, /value\s*>\s*uCurvePoints\[base\s*\+\s*right\]\.x/u);
	assert.match(curves, /uCurvePoints\[base\s*\+\s*right\]\.x\s*==\s*uCurvePoints\[base\s*\+\s*right\s*-\s*1\]\.x/u);
	assert.match(curves, /if\s*\(b\.x\s*==\s*a\.x\)/u);
	assert.match(curves, /slope\s*==\s*1\.0\s*&&\s*a\.x\s*==\s*a\.y\s*\?\s*value/u);
	assert.match(curves, /a\.y\s*\+\s*\(value\s*-\s*a\.x\)\s*\*\s*slope/u);
	assert.doesNotMatch(curves, /clamp\(|round\(|texture\(/u);
});

test('curves compose master then channel in one native stage without intermediate encoded or Float32 tables', async () => {
	const { curves, fragment } = await shaders();
	for (const [channel, number] of [['r', 1], ['g', 2], ['b', 3]] as const) {
		assert.ok(curves.includes(`sampleColorCurveCurrentV1(${String(number)}, sampleColorCurveCurrentV1(0, rgb.${channel}))`));
	}
	assert.ok(fragment.includes(curves));
	assert.doesNotMatch(curves, /sampler|RGBA|texelFetch|255|65535/u);
});

test('wheels use prepared native linear lift gain and sign-preserving gamma with the exact gamma-one branch', async () => {
	const { fragment } = await shaders();
	assert.match(fragment, /gained\s*=\s*\(rgb\s*\+\s*uParams0\.xyz\)\s*\*\s*uParams1\.xyz/u);
	assert.match(fragment, /gamma\s*==\s*1\.0\s*\?\s*value\s*:\s*sign\(value\)\s*\*\s*pow\(abs\(value\),\s*1\.0\s*\/\s*gamma\)/u);
	assert.match(fragment, /uKind\s*==\s*7/u);
	assert.doesNotMatch(fragment, /pow\(max\(|clamp\(gained/u);
});

test('color fragment fits the conservative fragment-uniform ledger and pure helpers have no host or byte renderer dependency', async () => {
	const { fragment } = await shaders();
	const declarations = [...fragment.matchAll(/uniform\s+(sampler2D|int|ivec4|vec[234])\s+\w+(?:\[(\d+)\])?;/gu)];
	const vectors = declarations.reduce((sum, declaration) => sum + Number(declaration[2] ?? 1), 0);
	assert.equal(vectors, 142); assert.ok(vectors <= 144); assert.ok(vectors <= 224);
	for (const name of ['chroma', 'curves', 'color']) {
		const source = await readFile(new URL(`pixel-frame-webgl2-${name}-glsl-current-v1.ts`, BASE), 'utf8');
		for (const dependency of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) assert.match(dependency[1]!, /^\.\/pixel-frame-webgl2-/u);
		assert.doesNotMatch(source, /document\.|OffscreenCanvas|WebGL2RenderingContext|video-preview|video-.*gpu|apply.*Pixel/u);
	}
});
