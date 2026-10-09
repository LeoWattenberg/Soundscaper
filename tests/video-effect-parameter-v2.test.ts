/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

import type { VideoEffectParameterV2 } from '../src/common/editor/video-effect-parameter-v2.ts';
import type { VideoEffectParameterV1, VideoCurvePointsV1 } from '../src/common/editor/video-curve-types-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoEffect, normalizeVideoEffect } from '../src/common/editor/video-effects.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const v1Unchanged: Equal<VideoEffectParameterV1, number | VideoCurvePointsV1> = true;
const v2Exact: Equal<VideoEffectParameterV2, VideoEffectParameterV1 | Readonly<VideoCubeLutReferenceV1> | null> = true;

test('V2 is an explicit parameter successor while the old numeric/curve V1 contract stays exact', () => {
	assert.equal(v1Unchanged, true);
	assert.equal(v2Exact, true);
});

test('the successor leaf has only erased narrow type imports and no runtime processing/registry dependency', async () => {
	const source = await readFile(new URL('../src/common/editor/video-effect-parameter-v2.ts', import.meta.url), 'utf8');
	const parsed = ts.createSourceFile('parameter.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const imports = parsed.statements.filter(ts.isImportDeclaration);
	assert.equal(imports.length, 2);
	assert.equal(imports.every(item => item.importClause?.isTypeOnly), true);
	const output = ts.transpileModule(source, { compilerOptions: {
		target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } });
	assert.equal(output.outputText.trim(), 'export {};');
});

test('legacy effect envelope, defaults, ordering and parameter bytes stay unchanged', () => {
	const effect = createVideoEffect('color-adjust', { id: 'old-effect' });
	const expected = '{"id":"old-effect","type":"color-adjust","enabled":true,"params":{"brightness":0,"contrast":1,"saturation":1,"gamma":1,"hueDegrees":0}}';
	assert.equal(JSON.stringify(effect), expected);
	assert.equal(JSON.stringify(normalizeVideoEffect(effect)), expected);
	assert.throws(() => normalizeVideoEffect({ ...effect, params: { ...effect.params, brightness: null } }));
	assert.throws(() => normalizeVideoEffect({ ...effect, params: { ...effect.params, brightness: {
		storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73, size: 2,
		domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }));
});
