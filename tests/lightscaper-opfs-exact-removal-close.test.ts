/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { remainsPending, settle } from './helpers/async-test-control.ts';
import { observed, WriterAcquisitionFixture } from './helpers/lightscaper-opfs-writer-acquisition-fixture.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
const PATH = 'recoverable-original.blob', PRIOR = 'retained-original.blob';
const BYTES = Uint8Array.of(3, 11, 59, 227);

// Controlled filesystem/Worker ports execute the real exact-deletion owner and
// runtime. These assertions do not establish native browser crash recovery.
for (const failure of [false, true]) test(`Light exact OPFS removal joins its actual ${failure ? 'failure' : 'success'} past the broker deadline before Close`, OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10);
	fixture.path = PATH; fixture.seed(PATH, BYTES); fixture.seed(PRIOR, BYTES);
	const error = new Error('Actual delayed exact removal was refused.'); error.name = 'NotAllowedError';
	if (failure) fixture.removeFailure = error;
	const repository = new OpfsRepository({ preferOpfs: true, opfsRoot: fixture.root as unknown as FileSystemDirectoryHandle,
		syncWorkerClient: client, opfsDirectoryName: PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName });
	const lifetime = new PhotoLibrarySessionLifetime(); let resources = 0;
	const work = observed(lifetime.operation(() => repository.deletePathExact(PATH)));
	let closing: Promise<void> | undefined;
	try {
		await Promise.race([fixture.removalEntered.promise, work.then(result => {
			if (!result.ok) throw result.error;
			throw new Error('Exact removal settled without its physical removal hold.');
		})]);
		closing = lifetime.close(async () => { resources++; repository.close(); });
		assert.equal(lifetime.close(async () => assert.fail('Duplicate resource cleanup.')), closing);
		for (let turn = 0; turn < 3; turn++) {
			await settle(1, { delayMs: 20 });
			assert.equal(await remainsPending(work), true, 'A broker deadline settled exact removal before its physical terminal.');
			assert.equal(await remainsPending(closing), true); assert.equal(resources, 0); assert.equal(worker.terminated, 0);
		}
		assert.deepEqual(fixture.files.get(PATH)?.bytes, BYTES); assert.deepEqual(fixture.files.get(PRIOR)?.bytes, BYTES);
		assert.equal(fixture.events.includes(`remove-ack:${PATH}`), false);
		fixture.removalRelease.resolve(); const result = await work; await closing; await worker.drain();
		assert.equal(result.ok, !failure);
		if (!result.ok) {
			assert.ok(result.error instanceof Error); assert.equal(result.error.name, error.name); assert.equal(result.error.message, error.message);
			assert.deepEqual(fixture.files.get(PATH)?.bytes, BYTES);
		} else assert.equal(fixture.files.has(PATH), false);
		assert.deepEqual(fixture.files.get(PRIOR)?.bytes, BYTES); assert.equal(resources, 1); assert.equal(worker.terminated, 1);
		assert.equal(worker.requests.filter(request => request.type === 'remove').length, 1);
	} finally {
		fixture.releaseAll(); await work; await observed(closing ?? lifetime.close(async () => repository.close())); await fixture.dispose();
	}
});

for (const terminal of ['worker-fault', 'client-close'] as const) test(`Light exact removal retires ${terminal} visibly while its physical path remains`, OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10);
	fixture.path = PATH; fixture.seed(PATH, BYTES);
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const fault = new Error('Actual exact-removal transport fault.'), work = observed(client.remove(PATH));
	try {
		await fixture.removalEntered.promise; await settle(3, { delayMs: 20 });
		const held = await remainsPending(work);
		if (terminal === 'worker-fault') worker.fail(fault); else client.close();
		const result = await work; assert.equal(held, true, 'Timeout must not retire physical removal ownership.');
		assert.equal(result.ok, false);
		if (!result.ok) {
			if (terminal === 'worker-fault') assert.equal(Object.is(result.error, fault), true);
			else { assert.ok(result.error instanceof Error); assert.match(result.error.message, /worker is closed/iu); }
		}
		assert.equal(client.isAvailable(), false); assert.equal(worker.terminated, 1);
		assert.deepEqual(fixture.files.get(PATH)?.bytes, BYTES); assert.equal(fixture.events.includes(`remove-ack:${PATH}`), false);
	} finally { fixture.releaseAll(); await work; client.close(); await fixture.dispose(); }
});
