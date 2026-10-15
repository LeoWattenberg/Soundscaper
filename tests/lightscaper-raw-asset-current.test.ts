/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import manifest from '../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
import { assertLibRawMemoryV1, compilePinnedLibRawModuleV1, loadLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';

const artifact = () => readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)).then(bytes => new Uint8Array(bytes));
const header = [0, 97, 115, 109, 1, 0, 0, 0];
const leb = (value: number): number[] => {
	const bytes: number[] = [];
	do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
	return bytes;
};
function memory(flags = 1, minimum = 512, maximum = 8192): number[] {
	const body = [1, flags, ...leb(minimum), ...(flags & 1 ? leb(maximum) : [])];
	return [5, ...leb(body.length), ...body];
}

test('LibRaw memory audit admits only the reviewed bounded nonshared 32–512 MiB definition', () => {
	assert.doesNotThrow(() => assertLibRawMemoryV1(new Uint8Array([...header, ...memory()])));
	for (const bytes of [[], [...header], [...header, ...memory(0)], [...header, ...memory(3)], [...header, ...memory(5)],
		[...header, ...memory(1, 511)], [...header, ...memory(1, 512, 8193)], [...header, ...memory(), ...memory()],
		[...header, 5, 10, 1, 1], [...header, 5, 1, 0], [...header, 5, 0], [...header, 5, 0x80],
		[...header, 5, 0xff, 0xff, 0xff, 0xff, 0x10], [...header, 5, 8, 1, 1, ...leb(512), ...leb(8192), 0, 0]]) {
		assert.throws(() => assertLibRawMemoryV1(new Uint8Array(bytes)));
	}
});

test('LibRaw compiler rejects truncation, extension and same-size byte substitution against the actual artifact pin', async () => {
	const bytes = await artifact();
	await assert.rejects(compilePinnedLibRawModuleV1(bytes.subarray(1)), /length/u);
	await assert.rejects(compilePinnedLibRawModuleV1(new Uint8Array(bytes.length + 1)), /length/u);
	bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
	await assert.rejects(compilePinnedLibRawModuleV1(bytes), /SHA256/u);
});

test('LibRaw compiler bounds the intrinsic byte span before copying a view with shadowed byteLength', async () => {
	const oversized = new Uint8Array(manifest.runtime.byteLength + 1);
	Object.defineProperty(oversized, 'byteLength', { value: manifest.runtime.byteLength });
	await assert.rejects(compilePinnedLibRawModuleV1(oversized), error => error instanceof RangeError && /byte length/u.test(error.message));
});

test('LibRaw compiler owns one synchronous snapshot across hashing, memory audit and actual compilation', async () => {
	const bytes = await artifact(), backing = new Uint8Array(bytes.length + 32); backing.fill(37); backing.set(bytes, 16);
	const borrowed = backing.subarray(16, 16 + bytes.length), compiling = compilePinnedLibRawModuleV1(borrowed);
	// SHA-256 captures its input before returning its promise. Mutating now must
	// neither replace the audited module nor cause a later compile of these bytes.
	borrowed.fill(0);
	const module = await compiling;
	assert.ok(module instanceof WebAssembly.Module);
	assert.deepEqual(WebAssembly.Module.exports(module).map(item => item.name).sort(),
		[...manifest.wasm.requiredExports, ...Object.keys(manifest.wasm.auxiliaryExports)].sort());
	assert.ok(backing.subarray(0, 16).every(byte => byte === 37));
	assert.ok(backing.subarray(backing.length - 16).every(byte => byte === 37));
	assert.ok(borrowed.every(byte => byte === 0));
});

test('LibRaw asset transport retries a rejected download, uses the exact external origin and caches only verified compilation', async () => {
	const bytes = await artifact(), original = globalThis.fetch, requests: { url: string; options?: RequestInit }[] = [];
	try {
		globalThis.fetch = (input, options) => {
			requests.push({ url: String(input), options });
			return Promise.resolve(new Response(requests.length === 1 ? new Uint8Array(bytes.length + 1) : bytes));
		};
		await assert.rejects(loadLibRawModuleV1(), /pinned length/u);
		const loading = loadLibRawModuleV1(); assert.equal(loadLibRawModuleV1(), loading);
		const module = await loading; assert.ok(module instanceof WebAssembly.Module); assert.equal(await loadLibRawModuleV1(), module);
		assert.equal(requests.length, 2);
		for (const request of requests) {
			assert.equal(request.url, 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm');
			assert.deepEqual(request.options, { credentials: 'omit', redirect: 'error', mode: 'cors', cache: 'force-cache' });
		}
	} finally { globalThis.fetch = original; }
});
