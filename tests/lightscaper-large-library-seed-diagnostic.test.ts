/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLargePhotoLibrarySeedPhaseV1, observeLargePhotoLibrarySeedConsoleV1,
	createLargePhotoLibraryQueryTransactionObserverV1 } from './helpers/lightscaper-large-library-seed-diagnostic.ts';

const begin = { kind: 'lightscaper-library-seed-phase-v1', schemaVersion: 1, phase: 'readiness', event: 'begin', elapsedMs: 0, durationMs: null };
const progress = { ...begin, phase: 'publication-progress', event: 'progress', elapsedMs: 360_000, photoCount: 20_000,
	batchCount: 1250, retainDurationMs: 360_000, publicationDurationMs: 360_000, pointReads: 5000, nativeWrites: 100_000_000,
	maximumResidentPhotos: 16, maximumAdmittedBytes: 8 * 1024 * 1024, getAllRequests: 0, cursorRequests: 0 };

test('closed scalar setup frames fit the existing byte cap, including maximal aggregate progress', () => {
	for (const frame of [begin, { ...begin, phase: 'managed-import', event: 'end', durationMs: 200 }, progress]) {
		const line = formatLargePhotoLibrarySeedPhaseV1(frame);
		assert.deepEqual(JSON.parse(line), frame); assert.ok(Buffer.byteLength(line, 'utf8') <= 512);
	}
	assert.throws(() => formatLargePhotoLibrarySeedPhaseV1({ ...progress, maximumResidentPhotos: 17 }));
	assert.throws(() => formatLargePhotoLibrarySeedPhaseV1({ ...progress, photoCount: 20_001 }));
	assert.throws(() => formatLargePhotoLibrarySeedPhaseV1({ ...progress, getAllRequests: 1 }));
});

test('future, unbounded, inconsistent and accessor-owned diagnostic facts refuse without reading accessors', () => {
	let gets = 0; const getter = { ...begin };
	Object.defineProperty(getter, 'elapsedMs', { enumerable: true, get() { gets++; return 0; } });
	for (const value of [getter, { ...begin, schemaVersion: 2 }, { ...begin, photoId: 'private-identity' },
		{ ...begin, elapsedMs: Infinity }, { ...begin, durationMs: 0 }, { ...begin, event: 'end' },
		{ ...progress, batchCount: 1251 }, { ...progress, pointReads: 4999 },
		{ ...progress, maximumAdmittedBytes: 8 * 1024 * 1024 + 1 }]) assert.throws(() => formatLargePhotoLibrarySeedPhaseV1(value));
	assert.equal(gets, 0);
});

test('owning console observation forwards only admitted setup frames and shares the caller record budget', () => {
	let count = 44; const lines: string[] = [];
	const emit = (line: string) => { if (++count > 64) throw new RangeError('record bound'); lines.push(line); };
	for (const message of ['ordinary console', '{', 'null', '{"kind":"other","secret":"ignored"}', 'a'.repeat(2000)]) {
		assert.equal(observeLargePhotoLibrarySeedConsoleV1(message, emit), false);
	}
	for (let index = 0; index < 20; index++) assert.equal(observeLargePhotoLibrarySeedConsoleV1(JSON.stringify(begin), emit), true);
	assert.equal(count, 64); assert.equal(lines.length, 20);
	assert.throws(() => observeLargePhotoLibrarySeedConsoleV1(JSON.stringify(begin), emit), /record bound/u);
	assert.throws(() => observeLargePhotoLibrarySeedConsoleV1(JSON.stringify({ ...begin, secret: 'a'.repeat(600) }), emit));
	assert.equal(lines.length, 20);
});

test('passive native transaction observation delegates exact receiver/arguments and observes only selected readonly query terminal events', () => {
	const transactions: EventTarget[] = [], calls: unknown[][] = [], receivers: unknown[] = [];
	const native = function (this: unknown, ...args: unknown[]) {
		receivers.push(this); calls.push(args); const transaction = new EventTarget(); transactions.push(transaction);
		return transaction as IDBTransaction;
	};
	const host = { transaction: native as IDBDatabase['transaction'] }, database = Object.assign(Object.create(host) as IDBDatabase, { name: 'selected' });
	const scope = ['catalogs', 'catalogStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'];
	const observer = createLargePhotoLibraryQueryTransactionObserverV1(host, 'selected', () => 100);
	const captured = host.transaction;
	try {
		const options = { durability: 'strict' as const };
		const first = database.transaction(scope, 'readonly', options);
		assert.equal(first, transactions[0]); assert.equal(receivers[0], database);
		assert.equal(calls[0]![0], scope); assert.equal(calls[0]![2], options);
		transactions[0]!.dispatchEvent(new Event('error')); assert.equal(observer.snapshot().active, 1);
		transactions[0]!.dispatchEvent(new Event('complete')); transactions[0]!.dispatchEvent(new Event('abort'));
		assert.deepEqual(observer.snapshot(), { started: 1, completed: 1, aborted: 0, active: 0, maximumActive: 1, nativeDurationMs: 0 });
		for (const [name, stores, mode] of [['other', scope, 'readonly'], ['selected', [...scope, 'photos'], 'readonly'],
			['selected', scope, 'readwrite']] as const) {
			Reflect.apply(host.transaction, { name }, [stores, mode]);
		}
		assert.equal(observer.snapshot().started, 1);
		const pending = database.transaction(scope, 'readonly'); assert.equal(observer.snapshot().active, 1);
		observer.stop(); assert.equal(host.transaction, native);
		(pending as unknown as EventTarget).dispatchEvent(new Event('abort'));
		assert.equal(observer.snapshot().aborted, 1); assert.equal(observer.snapshot().active, 0);
		Reflect.apply(captured, database, [scope, 'readonly']); assert.equal(observer.snapshot().started, 2);
	} finally { observer.stop(); }
});
