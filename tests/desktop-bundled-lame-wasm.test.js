/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditLameWasm } from '../scripts/audit-lame-wasm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('bundled MP3 encode is an exact LAME 4.0 artifact', async () => {
	const result = await auditLameWasm();
	assert.deepEqual(result.findings, []);
	assert.equal(result.ok, true);
	assert.equal(result.version, '4.0');
	assert.equal(result.archiveSha256, '3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb');
	assert.equal(result.wasmBytes, 212_205);
	assert.equal(result.wasmSha256, '654d08f946851134755513c8c0cd4486e8c9d2024df2318dc48b262e4ad7a502');
});

test('bundled LAME build remains reproducible and excludes broader authority', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/lame/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		decoder: false, files: false, frontend: false, maximumChannels: 2,
		simd: false, threads: false, vbr: false, xingLameGaplessTag: true,
	});
	assert.deepEqual(manifest.compiledArchiveEvidence, {
		memberCount: 20,
		membersSha256: '88941a5528ff5f3baeb2e60a85d671f95674236a9953a115f824ee786916a1df',
	});
	assert.deepEqual(manifest.toolchain, {
		dockerImage: 'emscripten/emsdk:3.1.64',
		dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		emscriptenVersion: '3.1.64', sourceDateEpoch: '1783756197',
	});
	assert.deepEqual(manifest.configureArguments, [
		'--disable-shared', '--enable-static', '--disable-dependency-tracking',
		'--disable-frontend', '--disable-decoder', '--disable-gtktest',
		'--disable-cpml', '--disable-nasm',
	]);
	assert.doesNotMatch(manifest.configureArguments.join('\n'), /enable-(?:decoder|frontend|nasm|shared)/iu);
});
