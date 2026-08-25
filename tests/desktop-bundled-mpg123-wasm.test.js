/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditMpg123Wasm } from '../scripts/audit-mpg123-wasm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('bundled MPEG audio decoding is an exact signed mpg123 1.33.7 artifact', async () => {
	const result = await auditMpg123Wasm();
	assert.deepEqual(result.findings, []);
	assert.equal(result.ok, true);
	assert.equal(result.version, '1.33.7');
	assert.equal(result.archiveSha256, '31d0e35a4ca567ec9b5ebda6c3062bb4435d6d3eacd6ef0d95cadd7854dc03ee');
	assert.equal(result.signatureSha256, '48037de26dd56d479b5a54d91ba301d9958476bd03c1b135ee183c3b23c2793c');
	assert.equal(result.signingFingerprint, 'D021FF8ECF4BE09719D61A27231C4CBC60D5CAFE');
	assert.equal(result.wasmBytes > 0 && result.wasmBytes <= 512 * 1024, true);
	assert.match(result.wasmSha256, /^[0-9a-f]{64}$/u);
});

test('the mpg123 build is feed-only float32 with no wider authority', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/mpg123/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		audioOutput: false, cli: false, files: false, gapless: true, icy: false,
		id3: false, layers: [2, 3], network: false, outputEncoding: 'float32',
		reader: 'feed', simd: false, threads: false,
	});
	assert.deepEqual(manifest.toolchain, {
		dockerImage: 'emscripten/emsdk:3.1.64',
		dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		emscriptenVersion: '3.1.64', sourceDateEpoch: '1785706201',
	});
	assert.deepEqual(manifest.wasm.requiredExports, [
		'memory', '_initialize', 'scmp_abi_version', 'scmp_maximum_frames',
		'scmp_initial_memory_bytes', 'scmp_maximum_memory_bytes', 'scmp_allocate',
		'scmp_free', 'scmp_decode_float32',
	]);
});
