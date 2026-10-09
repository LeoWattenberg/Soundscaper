/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoCubeLutSource } from '../src/lightscaper/controller/photo-cube-lut-source-binding.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const reference = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 1, size: 2,
	domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const };

test('Photo resource binding captures the method and receiver without reading a shadowed bind, name or length', async () => {
	let reflected = 0, calls = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		assert.equal(this, port); calls++; return consume(new Uint8Array([17]));
	} };
	const method = new Proxy(port.withBytes, { get() { reflected++; throw Error('Method metadata inspected'); } });
	port.withBytes = method;
	const captured = capturePhotoCubeLutSource(port);
	port.withBytes = () => { throw Error('Mutable replacement used'); };
	assert.equal(await captured.withBytes(reference, bytes => bytes[0]), 17);
	assert.equal(calls, 1); assert.equal(reflected, 0); assert.equal(Object.isFrozen(captured), true);
});

test('Photo resource binding requires an own data method and preserves opaque reflection failure identity', () => {
	let getters = 0;
	const accessor = Object.defineProperty({}, 'withBytes', { get() { getters++; throw Error('Getter invoked'); } });
	const inherited: unknown = Object.create({ withBytes() { throw Error('Inherited source admitted'); } });
	for (const value of [undefined, null, {}, accessor, inherited, { withBytes: 1 }]) assert.throws(() => capturePhotoCubeLutSource(value));
	assert.equal(getters, 0);
	const failure = new Proxy({}, { getPrototypeOf() { throw Error('Failure inspected'); } });
	assert.throws(() => capturePhotoCubeLutSource(new Proxy({}, { getOwnPropertyDescriptor() { throw failure; } })), error => error === failure);
});
