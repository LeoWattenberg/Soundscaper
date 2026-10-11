/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpfsSyncWorkerClient, OpfsSyncWriter } from '../src/common/editor/storage/opfs-sync-worker-client.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { remainsPending, settle } from './helpers/async-test-control.ts';
import { observed, WriterAcquisitionFixture } from './helpers/lightscaper-opfs-writer-acquisition-fixture.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
const PATH = 'admitted.blob', PRIOR_PATH = 'prior.blob';
const BYTES = Uint8Array.of(9, 41, 103, 227), PRIOR = Uint8Array.of(2, 7, 1, 8);

// Explicit Node Worker/FileSystem ports forward the real client/runtime requests
// and results. These controls prove owner joining, not native browser OPFS.
async function open(fixture: WriterAcquisitionFixture, client: OpfsSyncWorkerClient): Promise<OpfsSyncWriter> {
	fixture.seed(PRIOR_PATH, PRIOR); fixture.path = PATH;
	assert.equal(await client.initialize(fixture.directory as unknown as FileSystemDirectoryHandle), true);
	const writer = await client.openWriter('media-asset-chunk-write', PATH);
	assert.equal(Object.isFrozen(writer), true); await writer.write(BYTES);
	assert.deepEqual(fixture.file().bytes, BYTES);
	return writer;
}

async function entered<Value>(gate: Promise<void>, work: ReturnType<typeof observed<Value>>, description: string): Promise<void> {
	await Promise.race([gate, work.then(result => {
		if (!result.ok) throw result.error;
		throw new Error(`Actual operation settled without ${description}.`);
	})]);
}

function retained(fixture: WriterAcquisitionFixture): void {
	assert.equal(fixture.files.has(PATH), true, 'A held or failed removal cannot prove physical absence.');
	assert.deepEqual(fixture.file().bytes, BYTES); assert.deepEqual(fixture.files.get(PRIOR_PATH)?.bytes, PRIOR);
	assert.equal(fixture.file().calls.filter(call => call === 'close').length, 1);
	assert.equal(fixture.file().calls.filter(call => call === 'write').length, 1);
}

async function pastDeadline(work: Promise<unknown>, closing: Promise<unknown>, resources: () => number): Promise<void> {
	for (let turn = 0; turn < 3; turn++) {
		await settle(1, { delayMs: 20 });
		assert.equal(await remainsPending(work), true, 'Admitted cleanup settled at the broker deadline before actual removal.');
		assert.equal(await remainsPending(closing), true, 'Session Close bypassed admitted writer cleanup.');
		assert.equal(resources(), 0, 'Session resources closed before cleanup terminal.');
	}
}

async function abortControl(failure?: Error): Promise<void> {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10);
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(), reason = Symbol('first local cancellation');
	let work: ReturnType<typeof observed<void>> | undefined, closing: Promise<void> | undefined;
	let aborting: Promise<void> | undefined, joined: AbortSignal | undefined, resources = 0;
	fixture.removeFailure = failure;
	try {
		const writer = await open(fixture, client);
		work = observed(lifetime.mutation(async signal => { joined = signal; aborting = writer.abort(); await aborting; }, caller.signal));
		await entered(fixture.removalEntered.promise, work, 'actual admitted abort removal');
		assert.ok(aborting); const duplicate = writer.abort(), duplicateOutcome = observed(duplicate);
		await assert.rejects(writer.write(Uint8Array.of(0)), /closed/u);
		caller.abort(reason); closing = lifetime.close(async () => { resources++; client.close(); });
		assert.equal(lifetime.close(async () => assert.fail('Second resource cleanup.')), closing);
		caller.abort(Symbol('later cancellation')); assert.ok(joined); assert.equal(Object.is(joined.reason, reason), true);
		await assert.rejects(lifetime.operation(async () => assert.fail('New work entered.')), /closed/u);
		await pastDeadline(work, closing, () => resources); retained(fixture); assert.equal(worker.terminated, 0);
		assert.equal(duplicate, aborting, 'Every duplicate abort must join the cached physical cleanup.');
		assert.deepEqual(worker.requests.filter(request => request.type === 'abort-writer').map(request => request.type), ['abort-writer']);
		assert.equal(fixture.events.some(event => event.startsWith('remove-ack:')), false);
		fixture.removalRelease.resolve(); const result = await work, repeated = await duplicateOutcome; await closing; await worker.drain();
		assert.equal(result.ok, failure === undefined); assert.equal(repeated.ok, result.ok);
		assert.equal(writer.abort(), aborting, 'Settled success or failure must remain cached.');
		if (!result.ok) {
			assert.ok(failure); assert.ok(result.error instanceof Error);
			assert.equal(result.error.name, failure.name); assert.equal(result.error.message, failure.message);
			assert.equal(repeated.ok, false); if (!repeated.ok) assert.equal(Object.is(repeated.error, result.error), true);
			const later = await observed(writer.abort()); assert.equal(later.ok, false);
			if (!later.ok) assert.equal(Object.is(later.error, result.error), true);
			retained(fixture);
		} else {
			assert.equal(fixture.files.has(PATH), false); assert.deepEqual(fixture.file().bytes, BYTES);
			assert.deepEqual(fixture.files.get(PRIOR_PATH)?.bytes, PRIOR);
		}
		assert.equal(resources, 1); assert.equal(worker.terminated, 1);
	} finally {
		fixture.releaseAll(); if (work) await work; if (aborting) await observed(aborting);
		await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
}

test('Light Session Close and duplicate admitted aborts join physical cleanup beyond the real broker deadline', OPTIONS, async () => {
	await abortControl();
});

test('late actual abort cleanup failure survives the deadline and every cached abort rejection', OPTIONS, async () => {
	const error = new Error('Actual delayed abort removal was refused.'); error.name = 'NotAllowedError';
	await abortControl(error);
});

async function completedCloseFallback(failure?: Error): Promise<void> {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10);
	const lifetime = new PhotoLibrarySessionLifetime(), caller = new AbortController(), reason = new Error('First completed-close cancellation.');
	let work: ReturnType<typeof observed<void>> | undefined, closing: Promise<void> | undefined;
	let aborting: Promise<void> | undefined, resources = 0;
	fixture.removeFailure = failure;
	try {
		const writer = await open(fixture, client); fixture.arm('close-result');
		work = observed(lifetime.mutation(async signal => {
			try { await writer.close(signal); } catch (primary) { aborting = writer.abort(); await aborting; throw primary; }
		}, caller.signal));
		await entered(fixture.entered.promise, work, 'already completed native close delivery');
		assert.equal(fixture.file().calls.filter(call => call === 'flush').length, 1); retained(fixture);
		caller.abort(reason); closing = lifetime.close(async () => { resources++; client.close(); });
		assert.equal(lifetime.close(async () => assert.fail('Repeated cleanup.')), closing);
		fixture.release.resolve(); await entered(fixture.removalEntered.promise, work, 'real removed:false fallback');
		assert.ok(aborting); const duplicate = writer.abort(), duplicateOutcome = observed(duplicate);
		assert.deepEqual(worker.requests.slice(-2).map(request => request.type), ['abort-writer', 'remove']);
		await pastDeadline(work, closing, () => resources); retained(fixture); assert.equal(worker.terminated, 0);
		assert.equal(duplicate, aborting);
		fixture.removalRelease.resolve(); const result = await work, repeated = await duplicateOutcome; await closing; await worker.drain();
		assert.equal(result.ok, false);
		if (!result.ok) {
			if (failure) {
				assert.ok(result.error instanceof Error); assert.equal(result.error.name, failure.name); assert.equal(result.error.message, failure.message);
				assert.equal(repeated.ok, false); if (!repeated.ok) assert.equal(Object.is(repeated.error, result.error), true);
				retained(fixture);
			} else { assert.equal(Object.is(result.error, reason), true); assert.equal(repeated.ok, true); assert.equal(fixture.files.has(PATH), false); }
		}
		assert.equal(writer.abort(), aborting); assert.equal(resources, 1); assert.equal(worker.terminated, 1);
		assert.deepEqual(fixture.files.get(PRIOR_PATH)?.bytes, PRIOR);
	} finally {
		fixture.releaseAll(); if (work) await work; if (aborting) await observed(aborting);
		await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
}

test('a genuinely completed cancelled close joins removed:false fallback and Session Close beyond its cleanup deadline', OPTIONS, async () => {
	await completedCloseFallback();
});

test('completed-close fallback retains its real late removal error rather than timeout or absence', OPTIONS, async () => {
	const error = new Error('Actual delayed fallback removal was refused.'); error.name = 'SecurityError';
	await completedCloseFallback(error);
});

test('a close delivery that sets closed cannot bypass an already admitted cached abort', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10), lifetime = new PhotoLibrarySessionLifetime();
	let work: ReturnType<typeof observed<void>> | undefined, closeResult: ReturnType<typeof observed<void>> | undefined;
	let aborting: Promise<void> | undefined, closing: Promise<void> | undefined, resources = 0;
	try {
		const writer = await open(fixture, client); fixture.arm('close-result');
		work = observed(lifetime.mutation(async () => {
			closeResult = observed(writer.close()); await entered(fixture.entered.promise, closeResult, 'real close-result hold');
			aborting = writer.abort(); await aborting;
		}));
		await entered(fixture.removalEntered.promise, work, 'admitted fallback while close delivery remains held');
		fixture.release.resolve(); assert.ok(closeResult); assert.equal((await closeResult).ok, true); assert.ok(aborting);
		const duplicate = writer.abort(), duplicateOutcome = observed(duplicate); assert.equal(duplicate, aborting);
		closing = lifetime.close(async () => { resources++; client.close(); });
		await pastDeadline(work, closing, () => resources); retained(fixture);
		fixture.removalRelease.resolve(); assert.equal((await work).ok, true); assert.equal((await duplicateOutcome).ok, true);
		await closing; await worker.drain(); assert.equal(fixture.files.has(PATH), false); assert.equal(resources, 1);
		assert.equal(writer.abort(), aborting); assert.equal(worker.requests.filter(request => request.type === 'abort-writer').length, 1);
	} finally {
		fixture.releaseAll(); if (closeResult) await closeResult; if (work) await work; if (aborting) await observed(aborting);
		await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
});

for (const terminal of ['worker-fault', 'client-close'] as const) test(`admitted abort waiting survives its deadline then refuses explicit ${terminal} without claiming absence`, OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10), lifetime = new PhotoLibrarySessionLifetime();
	const caller = new AbortController(), reason = Symbol('first cancellation'), fault = new Error('Actual controlled worker transport failure.');
	let work: ReturnType<typeof observed<void>> | undefined, closing: Promise<void> | undefined, aborting: Promise<void> | undefined, resources = 0;
	try {
		const writer = await open(fixture, client);
		work = observed(lifetime.mutation(async () => { aborting = writer.abort(); await aborting; }, caller.signal));
		await entered(fixture.removalEntered.promise, work, 'real abort removal hold');
		caller.abort(reason); closing = lifetime.close(async () => { resources++; client.close(); });
		await settle(3, { delayMs: 20 });
		const beforeFault = { work: await remainsPending(work), close: await remainsPending(closing), resources, terminated: worker.terminated };
		retained(fixture);
		if (terminal === 'worker-fault') worker.fail(fault); else client.close();
		const result = await work; await closing; assert.equal(result.ok, false);
		if (!result.ok) {
			if (terminal === 'worker-fault') assert.equal(Object.is(result.error, fault), true);
			else { assert.ok(result.error instanceof Error); assert.match(result.error.message, /worker is closed/iu); }
			assert.ok(aborting); assert.equal(writer.abort(), aborting);
			const duplicate = await observed(writer.abort()); assert.equal(duplicate.ok, false);
			if (!duplicate.ok) assert.equal(Object.is(duplicate.error, result.error), true);
		}
		assert.deepEqual(beforeFault, { work: true, close: true, resources: 0, terminated: 0 });
		assert.equal(resources, 1); assert.equal(worker.terminated, 1); assert.equal(client.isAvailable(), false); retained(fixture);
		assert.equal(fixture.events.some(event => event.startsWith('remove-ack:')), false, 'Transport retirement is not a removal ACK.');
		await assert.rejects(client.openWriter('media-asset-chunk-write', 'after-termination.blob'), /unavailable/u);
	} finally {
		fixture.releaseAll(); if (work) await work; if (aborting) await observed(aborting);
		await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
});

test('a successfully closed writer with no abort in flight keeps its exact body and abort remains a no-op', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), { client, worker } = fixture.client(10), lifetime = new PhotoLibrarySessionLifetime();
	let closing: Promise<void> | undefined, resources = 0;
	try {
		const writer = await open(fixture, client); await lifetime.mutation(() => writer.close()); await worker.drain();
		retained(fixture); const requests = worker.requests.length;
		await writer.abort(); await writer.abort(); assert.equal(worker.requests.length, requests);
		assert.equal(fixture.events.some(event => event.startsWith('remove-enter:')), false);
		closing = lifetime.close(async () => { resources++; client.close(); }); await closing;
		assert.equal(resources, 1); assert.equal(worker.terminated, 1); retained(fixture);
	} finally {
		fixture.releaseAll(); await observed(closing ?? lifetime.close(async () => client.close())); await fixture.dispose();
	}
});
