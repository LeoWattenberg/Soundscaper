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
	assert.equal(result.wasmBytes, 213_293);
	assert.equal(result.wasmSha256, 'd624f2202ce5a560ca38bc156cb80441fe93ec799e59a35d0f9379a990256123');
});

test('bundled LAME build remains reproducible and excludes broader authority', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/lame/source-manifest.json',
	), 'utf8'));
	assert.deepEqual(manifest.buildFeatures, {
		decoder: false, files: false, frontend: false, maximumChannels: 2,
		simd: false, threads: false, vbr: true, xingLameGaplessTag: true,
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

test('the reviewed shim exports Audacity\'s four MP3 bit-rate modes', async () => {
	const manifest = JSON.parse(await readFile(resolve(
		ROOT, 'src/common/editor/lame/source-manifest.json',
	), 'utf8'));
	for (const name of ['sclm_maximum_rate_mode', 'sclm_maximum_vbr_quality', 'sclm_maximum_preset']) {
		assert.ok(manifest.wasm.requiredExports.includes(name), name);
	}
	const wasm = await readFile(resolve(ROOT, 'src/common/editor/lame/lame.wasm'));
	const module = await WebAssembly.compile(Uint8Array.from(wasm).buffer);
	const imports = {};
	for (const descriptor of WebAssembly.Module.imports(module)) {
		imports[descriptor.module] ??= {};
		imports[descriptor.module][descriptor.name] = () => 8;
	}
	const { exports } = await WebAssembly.instantiate(module, imports);
	const exported = (name) => exports[name] ?? exports[`_${name}`];
	exported('_initialize')();
	assert.equal(exported('sclm_abi_version')(), 2);
	assert.equal(exported('sclm_maximum_rate_mode')(), 3);
	assert.equal(exported('sclm_maximum_vbr_quality')(), 9);
	assert.equal(exported('sclm_maximum_preset')(), 3);
});
