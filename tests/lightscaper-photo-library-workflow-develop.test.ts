/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoLibraryDevelopPortV2 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-develop.ts';
import type { PhotoLibraryDevelopPortV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';

test('current develop capability pins each method and receiver once without reflecting callable metadata', async () => {
	const reads: string[] = [], calls: unknown[] = [];
	const callable = new Proxy(function (this: unknown, ...args: unknown[]) { calls.push(this, ...args); return Promise.resolve(null); },
		{ get() { assert.fail('Do not inspect callable name, length or bind'); } });
	const owner = new Proxy({ schemaVersion: 2, read: callable, apply: callable }, { get(target, key, receiver) {
		reads.push(String(key)); return Reflect.get(target, key, receiver) as unknown;
	} }) as unknown as PhotoLibraryDevelopPortV2;
	const port = capturePhotoLibraryDevelopPortV2(owner);
	assert.equal(port.schemaVersion, 2); assert.ok(Object.isFrozen(port));
	const before = [...reads], request = { schemaVersion: 2 as const, photoId: 'photo-1' };
	await port.read(request); await port.read(request);
	assert.deepEqual(reads, before); assert.equal(calls[0], owner); assert.equal(calls[1], request);
	assert.equal(reads.filter(key => key === 'read').length, 1); assert.equal(reads.filter(key => key === 'apply').length, 1);
});

test('native cancellation during capability capture prevents publication and keeps the exact reason', () => {
	const controller = new AbortController(), reason = Object.freeze({ retired: true });
	const owner = { schemaVersion: 2, get read() { controller.abort(reason); return () => Promise.resolve(null); },
		apply: () => Promise.resolve(null) } as unknown as PhotoLibraryDevelopPortV2;
	assert.throws(() => capturePhotoLibraryDevelopPortV2(owner, controller.signal), error => error === reason);
});

test('fixed current capability rejects a legacy discriminator before borrowing its command methods', () => {
	let borrowed = 0;
	const owner = { schemaVersion: 1, get read() { borrowed++; return () => Promise.resolve(null); } } as unknown as PhotoLibraryDevelopPortV2;
	assert.throws(() => capturePhotoLibraryDevelopPortV2(owner), /current/u); assert.equal(borrowed, 0);
});
