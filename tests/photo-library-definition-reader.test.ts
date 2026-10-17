/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDefinitionReader } from '../src/common/editor/controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';

const request = (id: string, signal: AbortSignal) => ({ kind: 'folder' as const, id, signal });
const snapshot = (id: string): PhotoLibraryDefinitionSnapshotV1 =>
	({ rootRevision: 1, queryJson: null, row: { kind: 'folder', id, name: `Folder ${id}`, parentId: null } });

test('an aborted active borrow must settle before the replacement port is invoked', async () => {
	const reader = new PhotoLibraryDefinitionReader(), held = deferred<PhotoLibraryDefinitionSnapshotV1>();
	const old = new AbortController(), next = new AbortController(), calls: string[] = []; let active = 0, maximum = 0;
	const read = async (input: PhotoLibraryDefinitionReadRequestV1) => {
		calls.push(input.id); active++; maximum = Math.max(maximum, active);
		try { return input.id === 'old' ? await held.promise : snapshot(input.id); }
		finally { active--; }
	};
	const oldRead = reader.read(read, request('old', old.signal)), oldRefusal = assert.rejects(oldRead, { name: 'AbortError' });
	old.abort(); const newRead = reader.read(read, request('new', next.signal));
	assert.deepEqual(calls, ['old']); held.resolve(snapshot('old'));
	await oldRefusal; assert.equal((await newRead).row.id, 'new'); assert.equal(maximum, 1); assert.deepEqual(calls, ['old', 'new']);
});

test('repeated canceled pending demands never accumulate port work and a second live pending demand refuses', async () => {
	const reader = new PhotoLibraryDefinitionReader(), held = deferred<PhotoLibraryDefinitionSnapshotV1>(), calls: string[] = [];
	const read = async (input: PhotoLibraryDefinitionReadRequestV1) => { calls.push(input.id); return input.id === 'held' ? held.promise : snapshot(input.id); };
	const active = reader.read(read, request('held', new AbortController().signal));
	for (let index = 0; index < 1_000; index++) {
		const controller = new AbortController(), pending = reader.read(read, request(`obsolete-${index}`, controller.signal));
		controller.abort(); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
	}
	const current = reader.read(read, request('current', new AbortController().signal));
	await assert.rejects(reader.read(read, request('overlap', new AbortController().signal)), /already pending/u);
	assert.deepEqual(calls, ['held']); held.resolve(snapshot('held')); await active;
	assert.equal((await current).row.id, 'current'); assert.deepEqual(calls, ['held', 'current']);
});

test('pre-aborted demand refuses before its port and failed active work releases the serial barrier', async () => {
	const reader = new PhotoLibraryDefinitionReader(), held = deferred<PhotoLibraryDefinitionSnapshotV1>(); let calls = 0;
	const port = async () => { calls++; return held.promise; };
	assert.throws(() => reader.read(port, request('aborted', AbortSignal.abort())), { name: 'AbortError' }); assert.equal(calls, 0);
	const failed = reader.read(port, request('failed', new AbortController().signal)), rejection = assert.rejects(failed, /point read failed/u);
	const next = reader.read(async input => { calls++; return snapshot(input.id); }, request('fresh', new AbortController().signal));
	assert.equal(calls, 1); held.reject(new Error('point read failed')); await rejection;
	assert.equal((await next).row.id, 'fresh'); assert.equal(calls, 2);
});
