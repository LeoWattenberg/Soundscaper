/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSoundscaperDeliveryPublicationGuardV1,
	validateSoundscaperDeliveryDestinationV1,
	validateSoundscaperDeliveryPublicationFenceV1,
} from '../src/common/editor/controller/export/internal/delivery/soundscaper-delivery-publication-v1.ts';
import { createBoundedByteChunk } from '../src/common/editor/platform/bounded-transfer.ts';
import type { MediaByteWriterPort } from '../src/common/editor/platform/media-stream-port.ts';
import {
	PROJECT, boundDestination, description, result, writer,
} from './helpers/soundscaper-delivery-adapter-fixtures.ts';

const signal = new AbortController().signal;
const chunk = (sequence = 0, final = true) => createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
	sequence, maximumByteLength: 4, final,
});

test('destination admission refuses non-data authority and unsafe destination names before invoking accessors', () => {
	const expected = description();
	const destination = boundDestination(writer([]));
	let accessorCalls = 0;
	const accessor = Object.defineProperty({ ...destination }, 'fileName', {
		enumerable: true,
		get: () => { accessorCalls += 1; return 'master.wav'; },
	});
	for (const invalid of [null, [], new Date(), { ...destination, extra: true }, accessor]) {
		assert.throws(() => validateSoundscaperDeliveryDestinationV1(invalid, expected), TypeError);
	}
	assert.equal(accessorCalls, 0);
	for (const fileName of ['', ' master.wav', 'master.wav ', '.', '..', '../master.wav', 'dir\\master.wav',
		'master\u0000.wav', 'ä'.repeat(513)]) {
		assert.throws(() => validateSoundscaperDeliveryDestinationV1({ ...destination, fileName }, expected),
			/file name is invalid/iu);
	}
	for (const invalidWriter of [null, { ...destination.writer, bytesWritten: -1 },
		{ ...destination.writer, maximumChunkBytes: 0 }, { ...destination.writer, commit: undefined }]) {
		assert.throws(() => validateSoundscaperDeliveryDestinationV1({ ...destination, writer: invalidWriter }, expected),
			/destination writer/iu);
	}
	const plain = Object.assign(Object.create(null) as Record<string, unknown>, destination);
	assert.equal(validateSoundscaperDeliveryDestinationV1(plain, expected).fileName, 'master.wav');
});

test('publication fences require the admitted destination grant and an atomic commit function', () => {
	const expected = description();
	const output = result(expected);
	const destination = boundDestination(writer([]));
	const fence = {
		authority: { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint },
		destinationGrantId: expected.destinationGrantId,
		fileName: destination.fileName,
		commit: () => undefined,
	};
	assert.throws(() => validateSoundscaperDeliveryPublicationFenceV1({
		...fence, destinationGrantId: 'another-grant',
	}, expected, output, destination), /fence destination grant/iu);
	assert.throws(() => validateSoundscaperDeliveryPublicationFenceV1({
		...fence, commit: null,
	}, expected, output, destination), /atomic commit/iu);
});

test('a failed atomic commit consumes the fence and preserves its owner as this', async () => {
	const expected = description();
	const output = result(expected);
	const destination = boundDestination(writer([]));
	const failure = new Error('publication I/O failed');
	let calls = 0;
	const owner = {
		authority: { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint },
		destinationGrantId: expected.destinationGrantId,
		fileName: destination.fileName,
		commit: async function () {
			assert.equal(this, owner);
			calls += 1;
			throw failure;
		},
	};
	const fence = validateSoundscaperDeliveryPublicationFenceV1(owner, expected, output, destination);
	const request = { description: expected, result: output, destination, signal };
	await assert.rejects(async () => { await fence.commit(request); }, (error: unknown) => error === failure);
	assert.throws(() => fence.commit(request), /already consumed/iu);
	assert.equal(calls, 1);
});

test('publication admission checks both the settled staging count and the destination count', async () => {
	const output = result(description()).publication;
	for (const destinationCount of [3, 5]) {
		const destination = { ...writer([]), get bytesWritten() { return destinationCount; } };
		const guard = createSoundscaperDeliveryPublicationGuardV1(destination);
		await guard.writer.write({ signal, chunk: chunk() });
		assert.equal(guard.writer.bytesWritten, destinationCount);
		assert.throws(() => guard.claimPublication(output), /byte count disagrees/iu);
		assert.throws(() => guard.assertPublicationReady(), /not admitted/iu);
	}
	const guard = createSoundscaperDeliveryPublicationGuardV1(writer([]));
	await guard.writer.write({ signal, chunk: chunk() });
	assert.throws(() => guard.claimPublication({ ...output, byteLength: 5 }), /byte count disagrees/iu);
});

test('publication readiness rejects destination mutation after admission', async () => {
	let bytesWritten = 0;
	const destination: MediaByteWriterPort = {
		maximumChunkBytes: 16,
		get bytesWritten() { return bytesWritten; },
		write: async ({ chunk: written }) => { bytesWritten += written.byteLength; },
		commit: async () => ({ bytesWritten }),
		abort: async () => undefined,
	};
	const guard = createSoundscaperDeliveryPublicationGuardV1(destination);
	assert.throws(() => guard.assertPublicationReady(), /not admitted/iu);
	await guard.writer.write({ signal, chunk: chunk() });
	guard.claimPublication(result(description()).publication);
	guard.assertPublicationReady();
	bytesWritten += 1;
	assert.throws(() => guard.assertPublicationReady(), /changed after publication admission/iu);
	bytesWritten = -1;
	assert.throws(() => guard.assertPublicationReady(), /destination writer is invalid/iu);
});

test('staging abort is idempotent and reports only a settled destination abort', async () => {
	for (const fails of [false, true]) {
		let abortCalls = 0;
		const failure = new Error('abort failed');
		const guard = createSoundscaperDeliveryPublicationGuardV1({
			...writer([]),
			abort: async (request) => {
				assert.equal(request.signal, signal);
				abortCalls += 1;
				if (fails) throw failure;
			},
		});
		const abort = guard.writer.abort({ signal });
		if (fails) await assert.rejects(abort, (error: unknown) => error === failure);
		else await abort;
		await guard.writer.abort({ signal });
		assert.equal(abortCalls, 1);
		assert.equal(guard.aborted(), !fails);
		await assert.rejects(guard.writer.write({ signal, chunk: chunk() }), /writer is closed/iu);
	}
});

test('an unsettled staging write prevents concurrent writes, abort and publication', async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	const original = writer([]);
	const guard = createSoundscaperDeliveryPublicationGuardV1({
		...original,
		get bytesWritten() { return original.bytesWritten; },
		write: async (request) => { await pending; await original.write(request); },
	});
	const writing = guard.writer.write({ signal, chunk: chunk() });
	await assert.rejects(guard.writer.write({ signal, chunk: chunk(1) }), /writer is closed/iu);
	await assert.rejects(guard.writer.abort({ signal }), /writer is closed/iu);
	await assert.rejects(guard.writer.commit({ signal }), /writer is closed/iu);
	assert.throws(() => guard.claimPublication(result(description()).publication), /writer is closed/iu);
	release();
	await writing;
	guard.claimPublication(result(description()).publication);
	guard.assertPublicationReady();
});

test('invalid staging requests and additional chunks after finality never reach the destination', async () => {
	const order: string[] = [];
	const guard = createSoundscaperDeliveryPublicationGuardV1(writer(order));
	await assert.rejects(guard.writer.write({ signal: null as never, chunk: chunk() }), /AbortSignal/iu);
	for (const invalid of [null, { ...chunk(), kind: 'message' }, { ...chunk(), maximumByteLength: 32 },
		{ ...chunk(), byteLength: 99 }, { ...chunk(), final: undefined }]) {
		await assert.rejects(guard.writer.write({ signal, chunk: invalid as never }), /bounded byte chunk/iu);
	}
	assert.deepEqual(order, []);
	await guard.writer.write({ signal, chunk: chunk() });
	await assert.rejects(guard.writer.write({ signal, chunk: chunk(1) }), /already received its final byte chunk/iu);
	assert.deepEqual(order, ['write']);
});
