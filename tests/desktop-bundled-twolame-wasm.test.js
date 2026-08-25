/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditTwolameWasm } from '../scripts/audit-twolame-wasm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_SHA256 = 'cc35424f6019a88c6f52570b63e1baf50f62963a3eac52a03a800bb070d7c87d';

test('bundled MP2 encode is an exact TwoLAME 0.4.0 artifact', async () => {
	const result = await auditTwolameWasm();
	assert.deepEqual(result.findings, []);
	assert.equal(result.ok, true);
	assert.equal(result.version, '0.4.0');
	assert.equal(result.revision, 'bec4069996479aa1aa9d9e7fa32c33135b3a2047');
	assert.equal(result.archiveSha256, ARCHIVE_SHA256);
	assert.ok(result.wasmBytes > 0);
	assert.match(result.wasmSha256, /^[0-9a-f]{64}$/u);
});

test('the reproducible TwoLAME build excludes broader runtime authority', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/twolame/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		cli: false, decoder: false, files: false, inputConversion: 'clamp-unit-f32-to-signed-16',
		layers: [2], maximumChannels: 2, sampleRates: [32_000, 44_100, 48_000],
		simd: false, threads: false, vbr: false,
	});
	assert.deepEqual(manifest.toolchain, {
		dockerImage: 'emscripten/emsdk:3.1.64',
		dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		emscriptenVersion: '3.1.64', sourceDateEpoch: '1570818420',
	});
	assert.deepEqual(manifest.configureArguments, [
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-sndfile',
	]);
	assert.doesNotMatch(manifest.configureArguments.join('\n'), /enable-(?:shared|sndfile)/iu);
	assert.equal(manifest.twolame.archiveSha256, ARCHIVE_SHA256);
	assert.equal(manifest.twolame.license, 'LGPL-2.1-or-later');
});
