/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopPreparedSave,
	createFileSystemPreparedSave,
} from '../src/common/editor/file-save-stream.ts';
import { openDirectPcmDestination } from '../src/common/editor/controller/direct-pcm-export.ts';

const FINAL_PREFIX_BYTES = 32;

test('desktop direct destinations seal, patch one exact prefix, and preserve total accounting', async () => {
	const calls: unknown[][] = [];
	const prepared = createDesktopPreparedSave({
		bridge: {
			async beginWrite(request) {
				calls.push(['begin', request]);
				return { writeId: 'write-prefix', chunkSize: 5 };
			},
			async writeChunk(request) {
				calls.push(['write', request.offset, [...request.bytes]]);
				return { nextOffset: request.offset + request.bytes.byteLength };
			},
			async patchFinalPrefix(request) {
				calls.push(['patch', request.writeId, [...request.bytes]]);
				return { byteLength: 36 };
			},
			async finishWrite(writeId) {
				calls.push(['finish', writeId]);
				return { byteLength: 36 };
			},
			async abortWrite(writeId) { calls.push(['abort', writeId]); },
		},
		fileName: 'session.7z',
		target: { id: 'target-prefix', name: 'session.7z' },
	});
	const opened = await openDirectPcmDestination(
		prepared,
		36,
		'7z',
		'exact',
		{ finalPrefixByteLength: FINAL_PREFIX_BYTES },
	);
	assert.ok(opened.destination);
	const destination = opened.destination;
	const initial = new Uint8Array(36);
	initial.set([9, 8, 7, 6], FINAL_PREFIX_BYTES);
	await destination.write(initial);
	await destination.close();
	const prefix = Uint8Array.from({ length: FINAL_PREFIX_BYTES }, (_, index) => index);
	assert.equal(typeof destination.patchFinalPrefix, 'function');
	await destination.patchFinalPrefix!(prefix);
	assert.equal(destination.bytesWritten(), 36);
	assert.deepEqual(await destination.commit(), {
		method: 'desktop', fileName: 'session.7z', size: 36,
	});

	assert.deepEqual(calls[0], ['begin', {
		targetId: 'target-prefix',
		size: 36,
		finalPrefixByteLength: FINAL_PREFIX_BYTES,
	}]);
	assert.deepEqual(calls.slice(1, 9).map((call) => call.slice(0, 2)), [
		['write', 0], ['write', 5], ['write', 10], ['write', 15],
		['write', 20], ['write', 25], ['write', 30], ['write', 35],
	]);
	assert.deepEqual(calls[9], ['patch', 'write-prefix', [...prefix]]);
	assert.deepEqual(calls[10], ['finish', 'write-prefix']);
});

test('File System Access patches position zero after sealing and closes only at commit', async () => {
	const events: string[] = [];
	const stored = new Uint8Array(36);
	let cursor = 0;
	const prepared = createFileSystemPreparedSave({
		fileName: 'session.7z',
		target: {
			name: 'session.7z',
			async createWritable() {
				events.push('open');
				return {
					async write(value) {
						if (value instanceof Uint8Array) {
							events.push(`append:${value.byteLength}`);
							stored.set(value, cursor);
							cursor += value.byteLength;
							return;
						}
						events.push(`patch:${value.position}:${value.data.byteLength}`);
						stored.set(value.data, value.position);
					},
					async close() { events.push('close'); },
					async abort() { events.push('abort'); },
				};
			},
		},
	});
	const opened = await openDirectPcmDestination(
		prepared,
		stored.byteLength,
		'7z',
		'exact',
		{ finalPrefixByteLength: FINAL_PREFIX_BYTES },
	);
	assert.ok(opened.destination);
	const destination = opened.destination;
	const body = new Uint8Array(stored.byteLength);
	body.set([1, 2, 3, 4], FINAL_PREFIX_BYTES);
	await destination.write(body);
	await destination.close();
	assert.deepEqual(events, ['open', 'append:36']);
	const prefix = Uint8Array.from({ length: FINAL_PREFIX_BYTES }, () => 7);
	assert.equal(typeof destination.patchFinalPrefix, 'function');
	await destination.patchFinalPrefix!(prefix);
	assert.deepEqual(events, ['open', 'append:36', 'patch:0:32']);
	assert.deepEqual([...stored], [...prefix, 1, 2, 3, 4]);
	await destination.commit();
	assert.deepEqual(events, ['open', 'append:36', 'patch:0:32', 'close']);
});

test('final-prefix declarations are exact-size, minimum-size, and capability closed', async () => {
	for (const entry of [
		{ label: 'maximum mode', byteLength: 36, sizeMode: 'maximum' },
		{ label: 'short exact output', byteLength: 31, sizeMode: 'exact' },
		{ label: 'wrong prefix declaration', byteLength: 36, sizeMode: 'exact', prefix: 31 },
	] as const) {
		let opens = 0;
		const prepared = createFileSystemPreparedSave({
			fileName: 'closed.7z',
			target: {
				async createWritable() {
					opens += 1;
					return { async write() {}, async close() {}, async abort() {} };
				},
			},
		});
		await assert.rejects(
			prepared.createWritable(
				entry.byteLength,
				entry.sizeMode,
				{ finalPrefixByteLength: entry.prefix ?? FINAL_PREFIX_BYTES },
			),
			/final prefix|exact|32 bytes/iu,
			entry.label,
		);
		assert.equal(opens, 0, entry.label);
	}
});

test('final-prefix order, length, omission, and repetition abort unpublished staging', async () => {
	await assertPrefixFailure(
		async ({ prepared }) => {
			const writer = (await prepared.createWritable(36, 'exact', {
				finalPrefixByteLength: FINAL_PREFIX_BYTES,
			})).getWriter();
			await writer.write(new Uint8Array(36));
			await prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES));
		},
		/sealed/iu,
	);
	await assertPrefixFailure(
		async ({ prepared }) => {
			const writer = (await prepared.createWritable(36, 'exact', {
				finalPrefixByteLength: FINAL_PREFIX_BYTES,
			})).getWriter();
			await writer.write(new Uint8Array(35));
			await writer.close();
			await prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES));
		},
		/exact declared size/iu,
	);
	await assertPrefixFailure(
		async ({ prepared }) => {
			const writer = (await prepared.createWritable(36, 'exact', {
				finalPrefixByteLength: FINAL_PREFIX_BYTES,
			})).getWriter();
			await writer.write(new Uint8Array(36));
			await writer.close();
			await prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES - 1));
		},
		/exactly 32 bytes/iu,
	);
	await assertPrefixFailure(
		async ({ prepared }) => {
			const writer = (await prepared.createWritable(36, 'exact', {
				finalPrefixByteLength: FINAL_PREFIX_BYTES,
			})).getWriter();
			await writer.write(new Uint8Array(36));
			await writer.close();
			await prepared.commit();
		},
		/final prefix/iu,
	);
	await assertPrefixFailure(
		async ({ prepared }) => {
			const writer = (await prepared.createWritable(36, 'exact', {
				finalPrefixByteLength: FINAL_PREFIX_BYTES,
			})).getWriter();
			await writer.write(new Uint8Array(36));
			await writer.close();
			await prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES));
			await prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES));
		},
		/already attempted/iu,
		['open', 'append', 'patch', 'abort'],
	);
});

test('a final-prefix failure terminally fences a retained stream writer', async () => {
	const fixture = prefixFixture();
	const writer = (await fixture.prepared.createWritable(36, 'exact', {
		finalPrefixByteLength: FINAL_PREFIX_BYTES,
	})).getWriter();
	await writer.write(new Uint8Array(36));
	await assert.rejects(
		fixture.prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES)),
		/sealed/iu,
	);
	await assert.rejects(writer.write(Uint8Array.of(1)), /not writable/iu);
	assert.deepEqual(fixture.events, ['open', 'append', 'abort']);
});

test('a failed prefix patch preserves its primary error and abort cleanup failure', async () => {
	const patchFailure = new Error('prefix write failed');
	const cleanupFailure = new Error('prefix cleanup failed');
	const prepared = createFileSystemPreparedSave({
		fileName: 'failure.7z',
		target: {
			async createWritable() {
				return {
					async write(value) {
						if (!(value instanceof Uint8Array)) throw patchFailure;
					},
					async close() { throw new Error('must not close'); },
					async abort() { throw cleanupFailure; },
				};
			},
		},
	});
	const writer = (await prepared.createWritable(32, 'exact', {
		finalPrefixByteLength: FINAL_PREFIX_BYTES,
	})).getWriter();
	await writer.write(new Uint8Array(32));
	await writer.close();
	await assert.rejects(
		prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES)),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors[0], patchFailure);
			assert.equal(error.errors[1], cleanupFailure);
			return true;
		},
	);
});

test('desktop prefix acknowledgement drift aborts without finishing publication', async () => {
	const calls: string[] = [];
	const prepared = createDesktopPreparedSave({
		bridge: {
			async beginWrite() { calls.push('begin'); return { writeId: 'drift-write' }; },
			async writeChunk(request) {
				calls.push('write');
				return { nextOffset: request.offset + request.bytes.byteLength };
			},
			async patchFinalPrefix() { calls.push('patch'); return { byteLength: 32 }; },
			async finishWrite() { calls.push('finish'); return { byteLength: 36 }; },
			async abortWrite() { calls.push('abort'); },
		},
		fileName: 'drift.7z',
		target: { id: 'drift-target', name: 'drift.7z' },
	});
	const writer = (await prepared.createWritable(36, 'exact', {
		finalPrefixByteLength: FINAL_PREFIX_BYTES,
	})).getWriter();
	await writer.write(new Uint8Array(36));
	await writer.close();
	await assert.rejects(
		prepared.patchFinalPrefix(new Uint8Array(FINAL_PREFIX_BYTES)),
		/lost synchronization/iu,
	);
	assert.deepEqual(calls, ['begin', 'write', 'patch', 'abort']);
});

test('ordinary prepared direct saves do not require a prefix bridge capability', async () => {
	const calls: string[] = [];
	const prepared = createDesktopPreparedSave({
		bridge: {
			async beginWrite() { calls.push('begin'); return { writeId: 'ordinary-write' }; },
			async writeChunk(request) {
				calls.push('write');
				return { nextOffset: request.offset + request.bytes.byteLength };
			},
			async finishWrite() { calls.push('finish'); return { byteLength: 2 }; },
		},
		fileName: 'ordinary.wav',
		target: { id: 'ordinary-target', name: 'ordinary.wav' },
	});
	const writer = (await prepared.createWritable(2, 'exact', {
		finalPrefixByteLength: 0,
	})).getWriter();
	await writer.write(Uint8Array.of(1, 2));
	await writer.close();
	await prepared.commit();
	assert.deepEqual(calls, ['begin', 'write', 'finish']);
});

test('a zero prefix request stays ordinary and an optional adapter fails cleanly', async () => {
	let bytes = 0;
	const prepared = {
		mode: 'stream',
		async createWritable() {
			return new WritableStream<Uint8Array>({
				write(chunk) { bytes += chunk.byteLength; },
			});
		},
		bytesWritten: () => bytes,
		commit: () => ({ size: bytes }),
		abort: async () => undefined,
	} as const;
	await assert.rejects(
		openDirectPcmDestination(prepared, 36, 'ordinary', 'maximum', {
			finalPrefixByteLength: FINAL_PREFIX_BYTES,
		}),
		/require exact-size mode/iu,
	);
	await assert.rejects(
		openDirectPcmDestination(prepared, 36, 'ordinary', 'exact', {
			finalPrefixByteLength: FINAL_PREFIX_BYTES - 1,
		}),
		/exactly 32 bytes/iu,
	);
	const opened = await openDirectPcmDestination(
		prepared,
		1,
		'ordinary',
		'exact',
		{ finalPrefixByteLength: 0 },
	);
	assert.ok(opened.destination);
	await opened.destination.write(Uint8Array.of(1));
	await opened.destination.close();
	assert.equal(typeof opened.destination.patchFinalPrefix, 'function');
	await assert.rejects(
		opened.destination.patchFinalPrefix!(new Uint8Array(FINAL_PREFIX_BYTES)),
		/cannot patch a final prefix/iu,
	);
});

async function assertPrefixFailure(
	run: (fixture: ReturnType<typeof prefixFixture>) => Promise<void>,
	expected: RegExp,
	expectedEvents: readonly string[] = ['open', 'append', 'abort'],
): Promise<void> {
	const fixture = prefixFixture();
	await assert.rejects(run(fixture), expected);
	assert.deepEqual(fixture.events, expectedEvents);
}

function prefixFixture() {
	const events: string[] = [];
	const prepared = createFileSystemPreparedSave({
		fileName: 'invalid.7z',
		target: {
			async createWritable() {
				events.push('open');
				return {
					async write(value) {
						events.push(value instanceof Uint8Array ? 'append' : 'patch');
					},
					async close() { events.push('close'); },
					async abort() { events.push('abort'); },
				};
			},
		},
	});
	return { events, prepared };
}
