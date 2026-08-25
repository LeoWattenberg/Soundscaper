/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditOpusWasm } from '../scripts/audit-opus-wasm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('bundled Ogg Opus is an exact libopus 1.6.1 plus libogg 1.3.6 artifact', async () => {
	const result = await auditOpusWasm();
	assert.deepEqual(result.findings, []);
	assert.equal(result.ok, true);
	assert.equal(result.opusVersion, '1.6.1');
	assert.equal(result.oggVersion, '1.3.6');
	assert.equal(result.opusRevision, '22244de5a79bd1d6d623c32e72bf1954b56235be');
	assert.equal(result.oggRevision, 'be05b13e98b048f0b5a0f5fa8ce514d56db5f822');
	assert.equal(result.opusArchiveSha256, '6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1');
	assert.equal(result.oggArchiveSha256, '5c8253428e181840cd20d41f3ca16557a9cc04bad4a3d04cce84808677fa1061');
	assert.equal(result.wasmBytes, 385_789);
	assert.equal(result.wasmSha256, 'c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853');
});

test('bundled Ogg Opus build remains reproducible and excludes wider codec features', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/opus/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		customModes: false, deepPlc: false, dred: false, files: false, mappingFamily: 0,
		maximumChannels: 2, osce: false, packetMilliseconds: 20, qext: false,
		sampleRate: 48_000, simd: false, threads: false,
	});
	assert.deepEqual(manifest.compiledArchiveEvidence, {
		opusMemberCount: 137,
		opusMembersSha256: 'dd54f6b221cb3459dc935edc75f25918dc86d76ab956476bec2aa43251105270',
		oggMemberCount: 2,
		oggMembersSha256: '54ff59975ee6f8cf0011df44e673d566d34dfe917e948cb805a832d30d28710a',
	});
	assert.deepEqual(manifest.toolchain, {
		dockerImage: 'emscripten/emsdk:3.1.64',
		dockerImageDigest: 'sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc',
		emscriptenVersion: '3.1.64', sourceDateEpoch: '1768440600',
	});
	assert.deepEqual(manifest.wasm.requiredExports, [
		'memory', '_initialize', 'scop_abi_version', 'scop_sample_rate',
		'scop_maximum_channels', 'scop_maximum_frames', 'scop_initial_memory_bytes',
		'scop_maximum_memory_bytes', 'scop_allocate', 'scop_free',
		'scop_encode_float32', 'scop_decode_float32',
	]);
	assert.deepEqual(manifest.configureArguments.opus, [
		'--disable-shared', '--enable-static', '--disable-dependency-tracking', '--disable-doc',
		'--disable-extra-programs', '--disable-asm', '--disable-rtcd', '--disable-intrinsics',
		'--disable-custom-modes', '--disable-opus-custom-api', '--disable-qext', '--disable-dred',
		'--disable-deep-plc', '--disable-lossgen', '--disable-osce', '--disable-osce-training-data',
	]);
	assert.doesNotMatch(
		manifest.configureArguments.opus.join('\n'),
		/(?:enable-(?:asm|custom|deep|dred|intrinsics|osce|qext|rtcd)|threads)/iu,
	);
});
