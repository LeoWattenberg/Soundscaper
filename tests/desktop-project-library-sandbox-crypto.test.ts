/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash as createNodeHash } from 'node:crypto';
import test from 'node:test';

import { createHash as createFramescaperHash } from
	'../desktop/project-library-sandbox-crypto.ts';
import { createHash as createSoundscaperHash } from
	'../desktop/soundscaper-project-library-sandbox-crypto.ts';

type SandboxHashFactory = typeof createFramescaperHash;

const IMPLEMENTATIONS: readonly Readonly<{
	name: string;
	createHash: SandboxHashFactory;
}>[] = Object.freeze([
	{ name: 'Framescaper', createHash: createFramescaperHash },
	{ name: 'Soundscaper', createHash: createSoundscaperHash },
]);

for (const implementation of IMPLEMENTATIONS) {
	test(`${implementation.name} sandbox SHA-256 supports empty and chained UTF-8 updates`, () => {
		const expectedEmpty = createNodeHash('sha256').digest('hex');
		assert.equal(implementation.createHash('sha256').digest('hex'), expectedEmpty);

		const value = ['Sound', '🌊', 'scaper'];
		const expected = createNodeHash('sha256').update(value.join('')).digest('hex');
		const hash = implementation.createHash('sha256');
		assert.equal(hash.update(value[0]!).update(value[1]!).update(value[2]!), hash);
		assert.equal(hash.digest('hex'), expected);
	});

	test(`${implementation.name} sandbox SHA-256 snapshots ArrayBuffer input`, () => {
		const input = Uint8Array.from([1, 2, 3, 4]);
		const expected = createNodeHash('sha256').update(input).digest('hex');
		const hash = implementation.createHash('sha256').update(input.buffer);
		input.fill(0xff);
		assert.equal(hash.digest('hex'), expected);
	});

	test(`${implementation.name} sandbox SHA-256 hashes only a typed view's byte range`, () => {
		const input = Uint8Array.from([99, 98, 10, 20, 30, 40, 88, 77]);
		const view = new Uint16Array(input.buffer, 2, 2);
		const expected = createNodeHash('sha256')
			.update(new Uint8Array(input.buffer, 2, 4))
			.digest('hex');
		assert.equal(implementation.createHash('sha256').update(view).digest('hex'), expected);
	});

	test(`${implementation.name} sandbox SHA-256 supports bounded DataView input`, () => {
		const input = Uint8Array.from([99, 10, 20, 30, 88]);
		const view = new DataView(input.buffer, 1, 3);
		const expected = createNodeHash('sha256').update(input.subarray(1, 4)).digest('hex');
		assert.equal(implementation.createHash('sha256').update(view).digest('hex'), expected);
	});

	test(`${implementation.name} sandbox SHA-256 rejects unsupported algorithms`, () => {
		assert.throws(
			() => implementation.createHash('sha512'),
			/only SHA-256/iu,
		);
	});

	test(`${implementation.name} sandbox SHA-256 rejects unsupported digest encodings`, () => {
		assert.throws(
			() => implementation.createHash('sha256').digest('base64' as never),
			/only hexadecimal/iu,
		);
	});

	test(`${implementation.name} sandbox SHA-256 rejects values outside its input domain`, () => {
		assert.throws(
			() => implementation.createHash('sha256').update(42 as never),
			/input is invalid/iu,
		);
	});

	test(`${implementation.name} sandbox SHA-256 rejects updates after finalization`, () => {
		const hash = implementation.createHash('sha256').update('first');
		hash.digest('hex');
		assert.throws(() => hash.update('second'), /already finalized/iu);
	});

	test(`${implementation.name} sandbox SHA-256 rejects repeated finalization`, () => {
		const hash = implementation.createHash('sha256').update('first');
		hash.digest('hex');
		assert.throws(() => hash.digest('hex'), /already finalized/iu);
	});
}
