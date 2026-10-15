/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from '../config/lightscaper-libraw-recovery-runtime-manifest.json';
import { compilePinnedLibRawRecoveryModuleV2 } from '../src/common/editor/raw/libraw-runtime-asset-v2.ts';

const asset = () => readFile(new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url)).then(bytes => new Uint8Array(bytes));
test('Recovery asset compilation binds the actual artifact pin and owns its snapshot before hashing awaits', async () => {
	const bytes = await asset(), original = bytes.slice();
	assert.equal(manifest.runtime.byteLength, bytes.byteLength); assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.runtime.sha256);
	const pending = compilePinnedLibRawRecoveryModuleV2(bytes); bytes.fill(0);
	const module = await pending, exports = WebAssembly.Module.exports(module);
	assert.ok(exports.some(entry => entry.name === 'raw_profile_version')); assert.ok(exports.some(entry => entry.name === 'raw_exposure_scale'));
	assert.ok(!exports.some(entry => entry.name === 'raw_preview')); assert.ok(bytes.every(byte => byte === 0)); original.fill(0);
});

test('Recovery asset admission rejects ABI1, truncation and changed bytes instead of compiling an unpinned replacement', async () => {
	const bytes = await asset(), legacy = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)));
	try {
		await assert.rejects(compilePinnedLibRawRecoveryModuleV2(legacy), /length|pin/u);
		await assert.rejects(compilePinnedLibRawRecoveryModuleV2(bytes.subarray(1)), /length/u);
		bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
		await assert.rejects(compilePinnedLibRawRecoveryModuleV2(bytes), /SHA256/u);
	} finally { bytes.fill(0); legacy.fill(0); }
});
