/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { publishImportedVideo } from '../src/common/editor/controller/import/internal/source-import-video-publication.ts';

interface PublicationFixtureOptions {
	readonly onWrite?: (writeNumber: number) => void;
	readonly onCommit?: () => void;
	readonly onAbort?: () => void;
	readonly onDiscard?: () => void;
	readonly publishedSize?: number;
}

function createPublicationFixture(options: PublicationFixtureOptions = {}) {
	const events: string[] = [];
	let stagedBytes: number[] = [];
	let publishedBytes: number[] | null = null;
	let writeNumber = 0;
	const store = {
		async beginMediaAssetWrite(
			storageKey: string,
			_metadata: Readonly<Record<string, unknown>>,
			admission: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
		) {
			assert.equal(storageKey, 'imported-video');
			events.push('begin');
			return {
				maximumChunkBytes: 4,
				get bytesWritten() { return stagedBytes.length; },
				async write(bytes: Uint8Array) {
					writeNumber += 1;
					events.push(`write:${writeNumber}`);
					options.onWrite?.(writeNumber);
					stagedBytes.push(...bytes);
				},
				async commit() { throw new Error('An imported video must retain publication ownership.'); },
				async commitOwned() {
					events.push('commit');
					assert.equal(stagedBytes.length, admission.expectedBytes);
					publishedBytes = [...stagedBytes];
					options.onCommit?.();
					return {
						metadata: {
							sha256: admission.expectedSha256,
							size: options.publishedSize ?? admission.expectedBytes,
						},
						async discardIfCurrent() {
							events.push('discard');
							options.onDiscard?.();
							publishedBytes = null;
							return true;
						},
					};
				},
				async abort() {
					events.push('abort');
					options.onAbort?.();
					stagedBytes = [];
				},
			};
		},
	};
	return {
		store,
		events,
		get stagedBytes() { return stagedBytes; },
		get publishedBytes() { return publishedBytes; },
	};
}

const VIDEO_BYTES = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8);

test('video publication aborts staged media after a later chunk write fails', async () => {
	const writeFailure = new Error('second chunk failed');
	const fixture = createPublicationFixture({
		onWrite(writeNumber) { if (writeNumber === 2) throw writeFailure; },
	});

	await assert.rejects(
		publishImportedVideo(fixture.store, 'imported-video', new Blob([VIDEO_BYTES]), {}),
		(error: unknown) => error === writeFailure,
	);
	assert.deepEqual(fixture.events, ['begin', 'write:1', 'write:2', 'abort']);
	assert.deepEqual(fixture.stagedBytes, []);
	assert.equal(fixture.publishedBytes, null);
});

test('video publication discards a committed body when cancellation arrives during commit', async () => {
	const controller = new AbortController();
	const cancellation = new Error('import cancelled after commit');
	const fixture = createPublicationFixture({
		onCommit() { controller.abort(cancellation); },
	});

	await assert.rejects(
		publishImportedVideo(fixture.store, 'imported-video', new Blob([VIDEO_BYTES]), {}, controller.signal),
		(error: unknown) => error === cancellation,
	);
	assert.deepEqual(fixture.events, ['begin', 'write:1', 'write:2', 'write:3', 'commit', 'discard']);
	assert.equal(fixture.publishedBytes, null);
});

test('video publication discards a committed body with mismatched metadata', async () => {
	const fixture = createPublicationFixture({ publishedSize: VIDEO_BYTES.length + 1 });

	await assert.rejects(
		publishImportedVideo(fixture.store, 'imported-video', new Blob([VIDEO_BYTES]), {}),
		/Published video metadata disagrees/u,
	);
	assert.deepEqual(fixture.events.slice(-2), ['commit', 'discard']);
	assert.equal(fixture.publishedBytes, null);
});

test('video publication reports both a write error and its abort failure', async () => {
	const writeFailure = new Error('write failed');
	const cleanupFailure = new Error('abort failed');
	const fixture = createPublicationFixture({
		onWrite() { throw writeFailure; },
		onAbort() { throw cleanupFailure; },
	});

	await assert.rejects(
		publishImportedVideo(fixture.store, 'imported-video', new Blob([VIDEO_BYTES]), {}),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [writeFailure, cleanupFailure]);
			assert.equal(error.cause, writeFailure);
			return true;
		},
	);
	assert.deepEqual(fixture.events, ['begin', 'write:1', 'abort']);
});

test('video publication reports both a post-commit error and its discard failure', async () => {
	const cleanupFailure = new Error('discard failed');
	const fixture = createPublicationFixture({
		publishedSize: VIDEO_BYTES.length + 1,
		onDiscard() { throw cleanupFailure; },
	});

	await assert.rejects(
		publishImportedVideo(fixture.store, 'imported-video', new Blob([VIDEO_BYTES]), {}),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /Published video metadata disagrees/u);
			assert.equal(error.errors[1], cleanupFailure);
			assert.equal(error.cause, error.errors[0]);
			return true;
		},
	);
	assert.deepEqual(fixture.events.slice(-2), ['commit', 'discard']);
	assert.deepEqual(fixture.publishedBytes, [...VIDEO_BYTES]);
});
