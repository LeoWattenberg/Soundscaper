/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { withCubeLutResourceV1 } from '../src/common/editor/imaging/cube-lut-resource-v1.ts';
import {
	parseCubeLutV1, requireCubeLutBody, sampleCubeLut, VIDEO_COLOR_LIMITS_V1,
	type VideoCubeLutReferenceV1,
} from '../src/common/editor/video-color-cube-lut-v27.ts';

const TEXT = ['TITLE "Borrowed # cube"', 'LUT_3D_SIZE 2',
	'0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n');
function resource(text = TEXT) {
	const body = parseCubeLutV1(text);
	const reference: VideoCubeLutReferenceV1 = { storageKey: `lut-sha256:${body.sha256}`,
		sha256: body.sha256, byteLength: body.byteLength, size: body.size,
		domainMin: body.domainMin, domainMax: body.domainMax };
	return { reference, bytes: new TextEncoder().encode(text) };
}
function opaque() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('opaque get'); },
		getPrototypeOf() { traps++; throw new Error('opaque prototype'); },
		getOwnPropertyDescriptor() { traps++; throw new Error('opaque descriptor'); } });
	return { reason, traps: () => traps };
}
async function refuses(operation: Promise<unknown>, reason: unknown): Promise<void> {
	// Node assert.rejects itself probes the rejection's then property.
	await operation.then(() => assert.fail('expected refusal'), error => { assert.equal(error, reason); });
}

test('a scoped resource reuses the private V27 parser and exact reference, without changing source bytes', async () => {
	const input = resource(), before = input.bytes.slice();
	const result = await withCubeLutResourceV1(input, ({ body, reference }) => {
		assert.equal(body.title, 'Borrowed # cube');
		assert.equal(requireCubeLutBody(reference, body), body);
		assert.deepEqual(sampleCubeLut(body, [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75]);
		assert.equal(Object.isFrozen(reference), true);
		assert.equal(Object.isFrozen(body.values), true);
		assert.throws(() => requireCubeLutBody(reference, { ...body }), /verified/iu);
		return 'joined';
	});
	assert.equal(result, 'joined');
	assert.deepEqual(input.bytes, before);
});

test('reference SHA, length, lattice size, domain and storage identity all bind the actual body', async () => {
	const input = resource();
	for (const change of [{ sha256: 'ab'.repeat(32), storageKey: `lut-sha256:${'ab'.repeat(32)}` },
		{ byteLength: input.bytes.length + 1 }, { size: 3 }, { domainMin: [-1, 0, 0] },
		{ domainMax: [2, 1, 1] }, { storageKey: 'unverified' }]) {
		await assert.rejects(withCubeLutResourceV1({ ...input, reference: { ...input.reference, ...change } },
			() => assert.fail('mismatched body consumed')));
	}
});

test('domains are parsed once with red-fastest axis order and independent clamped/interior samples', async () => {
	const input = resource(TEXT.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MIN -1 -2 -3\nDOMAIN_MAX 1 2 3'));
	await withCubeLutResourceV1(input, ({ body }) => {
		assert.deepEqual(sampleCubeLut(body, [0, 0, 0]), [0.5, 0.5, 0.5]);
		assert.deepEqual(sampleCubeLut(body, [2, -3, 1.5]), [1, 0, 0.75]);
	});
});

test('a native offset view preserves exact CRLF and non-ASCII title bytes inside a bounded backing', async () => {
	const input = resource(TEXT.replace('Borrowed # cube', 'Größe # 東京').replaceAll('\n', '\r\n'));
	const backing = new Uint8Array(input.bytes.length + 11).fill(255);
	backing.set(input.bytes, 7);
	await withCubeLutResourceV1({ ...input, bytes: backing.subarray(7, 7 + input.bytes.length) }, ({ body }) => {
		assert.equal(body.title, 'Größe # 東京');
		assert.equal(body.sha256, input.reference.sha256);
		assert.equal(body.byteLength, input.bytes.length);
	});
	const oversized = new Uint8Array(VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes + 1);
	oversized.set(input.bytes);
	await assert.rejects(withCubeLutResourceV1({ ...input, bytes: oversized.subarray(0, input.bytes.length) },
		() => assert.fail('oversized borrowed backing consumed')), /bound/iu);
});

test('fatal UTF8 and a leading BOM refuse rather than replacing or discarding digest-bound bytes', async () => {
	const input = resource();
	for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xef, 0xbb, 0xbf, ...input.bytes])]) {
		await assert.rejects(withCubeLutResourceV1({ ...input, bytes }, () => assert.fail('invalid text consumed')));
	}
});

test('native byte geometry is admitted before copy and caller byte getters/methods are never invoked', async () => {
	const input = resource();
	let calls = 0;
	Object.defineProperties(input.bytes, { slice: { value: () => { calls++; throw new Error('slice'); } },
		[Symbol.iterator]: { value: () => { calls++; throw new Error('iterator'); } } });
	await withCubeLutResourceV1(input, () => undefined);
	const accessor = resource();
	Object.defineProperty(accessor.bytes, 'byteLength', { get() { calls++; throw new Error('length'); } });
	await assert.rejects(withCubeLutResourceV1(accessor, () => assert.fail('shadowed geometry consumed')));
	for (const bytes of [new Uint16Array(4), new Uint8Array(new SharedArrayBuffer(8)),
		new Uint8Array(Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer), new Uint8Array(0),
		new Uint8Array(VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes + 1)]) {
		await assert.rejects(withCubeLutResourceV1({ ...input, bytes }, () => assert.fail('invalid bytes consumed')));
	}
	assert.equal(calls, 0);
});

test('closed resource and reference admission refuses accessors, extra fields and parsed clones', async () => {
	let calls = 0;
	const input = resource();
	const accessor = Object.defineProperty({ ...input }, 'reference', { enumerable: true,
		get() { calls++; throw new Error('reference getter'); } });
	const badReference = Object.defineProperty({ ...input.reference }, 'sha256', { enumerable: true,
		get() { calls++; throw new Error('SHA getter'); } });
	for (const value of [accessor, { ...input, extra: true }, { ...input, reference: badReference },
		{ ...input, bytes: { ...input.bytes } }, { ...input, body: { ...parseCubeLutV1(TEXT) } }]) {
		await assert.rejects(withCubeLutResourceV1(value, () => assert.fail('invalid resource consumed')));
	}
	assert.equal(calls, 0);
});

test('pre-aborted native cancellation wins before nested admission and never inspects the opaque reason', async () => {
	const controller = new AbortController(), { reason, traps } = opaque();
	controller.abort(reason);
	Object.defineProperty(controller.signal, 'throwIfAborted', { get() { throw new Error('signal shadow'); } });
	const value = { signal: controller.signal, reference: new Proxy({}, { getPrototypeOf() { throw new Error('reference touched'); } }),
		bytes: new Proxy({}, { get() { throw new Error('bytes touched'); } }) };
	await refuses(withCubeLutResourceV1(value, () => assert.fail('cancelled resource consumed')), reason);
	assert.equal(traps(), 0);
});

test('the owned raw copy survives a held consumer, then is wiped after success, refusal or native abort', async () => {
	const Native = globalThis.Uint8Array;
	for (const outcome of ['success', 'refusal', 'abort'] as const) {
		const input = resource(), controller = new AbortController(), { reason, traps } = opaque();
		const allocations: Uint8Array[] = [];
		let release!: () => void, entered!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const started = new Promise<void>(resolve => { entered = resolve; });
		globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
			const result = Reflect.construct(target, args) as Uint8Array;
			if (args.length === 1 && args[0] === input.bytes.length) allocations.push(result);
			return result;
		} });
		let settled = false;
		try {
			const operation = withCubeLutResourceV1({ ...input, signal: controller.signal }, async () => {
				entered(); await held;
				if (outcome === 'refusal') throw reason;
				return 17;
			});
			void operation.then(() => { settled = true; }, () => { settled = true; });
			await started;
			assert.equal(allocations.length, 1);
			assert.deepEqual(allocations[0], input.bytes);
			if (outcome === 'abort') controller.abort(reason);
			await Promise.resolve(); assert.equal(settled, false, 'consumer remains joined after cancellation');
			release();
			if (outcome === 'success') assert.equal(await operation, 17);
			else await refuses(operation, reason);
			assert.equal(allocations[0]?.every(byte => byte === 0), true);
			assert.equal(traps(), 0);
		} finally { globalThis.Uint8Array = Native; release(); }
	}
});

test('a transfer of caller bytes during the joined consumer refuses fulfillment and wipes its owned copy', async () => {
	const input = resource();
	await assert.rejects(withCubeLutResourceV1(input, () => {
		structuredClone(input.bytes.buffer, { transfer: [input.bytes.buffer] });
		return 'not published';
	}), /detach|changed/iu);
});

test('actual allocation refusal and consumer refusal preserve exact opaque failures', async () => {
	const input = resource(), Native = globalThis.Uint8Array, { reason, traps } = opaque();
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
		if (args.length === 1 && args[0] === input.bytes.length) throw reason;
		return Reflect.construct(target, args) as Uint8Array;
	} });
	try { await refuses(withCubeLutResourceV1(input, () => assert.fail('allocation refused')), reason); }
	finally { globalThis.Uint8Array = Native; }
	await refuses(withCubeLutResourceV1(input, () => { throw reason; }), reason);
	assert.equal(traps(), 0);
});
