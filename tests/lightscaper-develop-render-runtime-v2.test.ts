/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const SHA = createHash('sha256').update(BODY).digest('hex');
const REFERENCE = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: BODY.byteLength, size: 2,
	domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function source() {
	return { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array([64, 128, 192, 127]) };
}

test('the current Photo runtime binds its resource before later mutation and both scoped render paths deliver the same literal frame', async () => {
	let calls = 0, reflected = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.deepEqual(reference, REFERENCE); calls++; return consume(BODY);
	} };
	port.withBytes = new Proxy(port.withBytes, { get() { reflected++; throw Error('Method metadata inspected'); } });
	const options = { source: port }, runtime = createPhotoDevelopRenderRuntimeV2(options);
	port.withBytes = () => { throw Error('Mutable method replacement used'); };
	options.source = { withBytes: () => { throw Error('Mutable options replacement used'); } };
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: REFERENCE } }] });
	for (const method of [runtime.withProxy, runtime.withFullResolution]) {
		let borrowed: PixelFrameV1['pixels'] | undefined;
		const result = await method({ frame: source(), develop, signal: new AbortController().signal }, view => {
			borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		});
		assert.deepEqual(result.pixels, [137, 0, 0, 127]); assert.equal(result.histogram.bins.red[137], 1);
		assert.ok(borrowed?.every(byte => byte === 0));
	}
	assert.equal(calls, 2); assert.equal(reflected, 0); assert.equal(Object.isFrozen(runtime), true);
});

test('the current runtime admits legacy settings without migration and refuses resource capabilities inside a render request', async () => {
	const runtime = createPhotoDevelopRenderRuntimeV2(), frame = source(), develop = defaultPhotoDevelopV1();
	const result = await runtime.withProxy({ frame, develop, signal: new AbortController().signal }, view => [...view.frame.pixels]);
	assert.deepEqual(result, [...frame.pixels]); assert.equal(develop.processVersion, 1);
	let consumed = 0;
	const request = { frame, develop, signal: new AbortController().signal, source: { withBytes() { throw Error('Serialized capability admitted'); } } };
	const work = Reflect.apply(runtime.withProxy, runtime, [request, () => { consumed++; }]) as Promise<void>;
	await assert.rejects(work); assert.equal(consumed, 0);
});
