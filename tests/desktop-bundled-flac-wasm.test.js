/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditFlacWasm } from '../scripts/audit-flac-wasm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('bundled FLAC is an exact narrow libFLAC 1.5.0 artifact', async () => {
	const result = await auditFlacWasm();
	assert.deepEqual(result.findings, []);
	assert.equal(result.ok, true);
	assert.equal(result.version, '1.5.0');
	assert.equal(result.revision, '1507800de4b70e21be71f38caa0d9079d0bc6e45');
	assert.equal(result.archiveSha256, 'f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920');
	assert.equal(result.wasmBytes > 0 && result.wasmBytes <= 512 * 1024, true);
	assert.match(result.wasmSha256, /^[0-9a-f]{64}$/u);
});

test('bundled FLAC build remains reproducible and excludes Ogg, files, threads, SIMD, and metadata mutation', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/flac/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		files: false,
		metadataMutation: false,
		ogg: false,
		simd: false,
		threads: false,
	});
	assert.deepEqual(manifest.toolchain, {
		dockerImage: 'emscripten/emsdk:3.1.64',
		dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		emscriptenVersion: '3.1.64',
		sourceDateEpoch: '1739277988',
	});
	assert.deepEqual(manifest.wasm.requiredExports, [
		'memory', '_initialize', 'scfl_abi_version', 'scfl_maximum_channels',
		'scfl_maximum_frames', 'scfl_initial_memory_bytes', 'scfl_maximum_memory_bytes',
		'scfl_allocate', 'scfl_free', 'scfl_encode_float32', 'scfl_decode_float32',
	]);
	assert.doesNotMatch(
		manifest.compiledSources.join('\n'),
		/(?:ogg|metadata_(?:iterator|object)|intrin|\.S$|\.asm$)/iu,
	);
});
