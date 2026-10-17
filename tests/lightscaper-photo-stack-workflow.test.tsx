/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import type { PhotoLibraryStackPortV1, PhotoLibraryStackCommandV1, PhotoLibraryStackAcknowledgementV1 } from '../src/common/editor/photo-library-stack-port-v1.ts';
import type { PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { usePhotoStacks, type ExecutePhotoStackV1 } from '../src/common/editor/ui/lightscaper/use-photo-stacks.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const context = { schemaVersion: 1, catalogId: 'catalog', catalogRevision: 3, indexRevision: 4, stateRevision: 2, stackCount: 1 } as const;
const rows: readonly PhotoLibraryRowV1[] = ['a', 'b', 'c'].map(id => ({ id, fileName: `${id}.png`, width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none' }));
const stack = { id: 'stack', revision: 2, photoIds: ['c', 'a', 'b'], coverPhotoId: 'a' } as const;
function port(): PhotoLibraryStackPortV1 {
	return { readStackMemberships: async ids => ({ context, memberships: ids.map(photoId => ({ photoId, stackId: null })) }),
		readStackSnapshot: async () => ({ context, stack }), readStackMembers: async (_binding, ids) => ({ context, rows: ids.map(photoId => ({ photoId, fileName: `${photoId}.png`, photoRevision: 1 })) }),
		readStackSummaryPage: async () => ({ context, rows: [], cursor: null }),
		applyStack: async command => ({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3,
			action: command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'dissolved', stack: command.type === 'dissolve' ? null : stack, notices: [] }) };
}
async function mount(owner: PhotoLibraryStackPortV1, refresh: () => Promise<void> = async () => undefined) {
	let generation: unknown = {}, query: unknown = null, page: unknown = {};
	let current: ReturnType<typeof usePhotoStacks> | undefined;
	let active = false, operations = 0; const controller = new AbortController();
	const execute: ExecutePhotoStackV1 = async action => {
		if (active) return 'busy'; active = true; operations++;
		try { await action({ signal: controller.signal, acquire: async () => owner, isCurrent: () => true, refresh }); return 'completed'; }
		catch (error) { if (controller.signal.aborted && error === controller.signal.reason) return 'cancelled'; return 'failed'; }
		finally { active = false; }
	};
	function Harness() { current = usePhotoStacks({ generation, queryIdentity: query, pageIdentity: page, rows, execute }); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	return { ...mounted, get stacks() { assert.ok(current); return current; }, get operations() { return operations; },
		async replace(kind: 'generation' | 'query' | 'page') { if (kind === 'generation') generation = {}; else if (kind === 'query') query = {}; else page = {}; await mounted.render(); },
		cancel() { controller.abort(); },
	};
}

test('menu demand captures actual selected order and fresh grouping context before any create', async () => {
	const owner = port(); let reads = 0, writes = 0; owner.readStackMemberships = async ids => { reads++; return { context, memberships: ids.map(photoId => ({ photoId, stackId: null })) }; };
	owner.applyStack = async () => { writes++; throw new Error('Unexpected automatic write'); };
	const mounted = await mount(owner);
	try {
		assert.equal(reads, 0); assert.equal(mounted.stacks.visible, false);
		await act(async () => { await mounted.stacks.openCreate(['c', 'a']); });
		assert.deepEqual(mounted.stacks.selectedIds, ['c', 'a']); assert.deepEqual(mounted.stacks.members.map(row => row.fileName), ['c.png', 'a.png']);
		assert.equal(mounted.stacks.snapshot?.context, context); assert.equal(mounted.stacks.visible, true); assert.equal(writes, 0);
		await act(async () => { await mounted.stacks.openCreate(['a', 'a']); }); assert.equal(reads, 1);
	} finally { await mounted.dispose(); }
});

test('edit loads only its first64 scalar names and preserves full ordered membership', async () => {
	const owner = port(), ids = Array.from({ length: 1024 }, (_, i) => `p-${String(i)}`); let maximum = 0;
	owner.readStackSnapshot = async () => ({ context, stack: { ...stack, photoIds: ids } });
	owner.readStackMembers = async (binding, names) => { assert.equal(binding.stackRevision, 2); maximum = Math.max(maximum, names.length);
		return { context, rows: names.map(photoId => ({ photoId, fileName: `${photoId}.png`, photoRevision: 1 })) }; };
	const mounted = await mount(owner);
	try { await act(async () => { await mounted.stacks.openEdit('a'); });
		assert.equal(mounted.stacks.snapshot?.stack?.photoIds.length, 1024); assert.equal(mounted.stacks.members.length, 64); assert.equal(maximum, 64);
	} finally { await mounted.dispose(); }
});

test('existing membership refuses create before writes and retains explicit error for reload', async () => {
	const owner = port(); owner.readStackMemberships = async ids => ({ context, memberships: ids.map(photoId => ({ photoId, stackId: 'other' })) });
	const mounted = await mount(owner);
	try { await act(async () => { await mounted.stacks.openCreate(['a', 'b']); }); assert.equal(mounted.stacks.snapshot, null);
		assert.match(mounted.stacks.error ?? '', /already/u); assert.equal(mounted.stacks.visible, true);
	} finally { await mounted.dispose(); }
});

test('held durable write has no queued reentry and Close retains operation until acknowledgment', async () => {
	const owner = port(), acknowledged = deferred<PhotoLibraryStackAcknowledgementV1>(); let writes = 0;
	owner.applyStack = async () => { writes++; return acknowledged.promise; };
	const mounted = await mount(owner); let pending: Promise<PhotoLibraryStackAcknowledgementV1 | null> | undefined;
	try {
		await act(async () => { await mounted.stacks.openCreate(['a', 'b']); });
		const command: PhotoLibraryStackCommandV1 = { schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3, expectedStateRevision: 2,
			type: 'create', photoIds: ['a', 'b'], coverPhotoId: 'a' };
		await act(async () => { pending = mounted.stacks.apply(command); await settle(); mounted.stacks.close(); await mounted.stacks.openEdit('a'); });
		assert.equal(mounted.stacks.visible, false); assert.equal(mounted.stacks.busy, true); assert.equal(writes, 1);
		await act(async () => { assert.equal(await mounted.stacks.apply(command), null); acknowledged.resolve({ schemaVersion: 1,
			catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'created', stack, notices: [] }); await pending; });
		assert.equal(mounted.stacks.busy, false); assert.equal(mounted.stacks.receipt?.action, 'created'); assert.equal(writes, 1);
	} finally { acknowledged.resolve({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'created', stack, notices: [] }); await pending; await mounted.dispose(); }
});

test('durable ACK survives refresh failure and late cancellation, while stale query/generation writes refuse', async () => {
	for (const change of ['query', 'generation', 'page'] as const) {
		const owner = port(); let writes = 0; const original = owner.applyStack; owner.applyStack = async (...args) => { writes++; return original(...args); };
		const mounted = await mount(owner, async () => { throw new Error('Refresh unavailable'); });
		try {
			await act(async () => { await mounted.stacks.openEdit('a'); }); const stale = mounted.stacks.apply;
			const command: PhotoLibraryStackCommandV1 = { schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3, expectedStateRevision: 2,
				type: 'dissolve', id: 'stack', expectedStackRevision: 2 };
			await act(async () => { assert.equal((await mounted.stacks.apply(command))?.action, 'dissolved'); });
			assert.equal(mounted.stacks.notice, 'refresh-failed'); assert.equal(mounted.stacks.receipt?.action, 'dissolved');
			await mounted.replace(change); await act(async () => { assert.equal(await stale(command), null); }); assert.equal(writes, 1);
		} finally { await mounted.dispose(); }
	}
});

test('a late abort keeps the exact durable grouping ACK and reports refresh separately', async () => {
	const owner = port(), saved = deferred<PhotoLibraryStackAcknowledgementV1>(); let calls = 0;
	owner.applyStack = async () => { calls++; return saved.promise; };
	const mounted = await mount(owner); let pending: Promise<PhotoLibraryStackAcknowledgementV1 | null> | undefined;
	const ack: PhotoLibraryStackAcknowledgementV1 = { schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4,
		stateRevision: 3, action: 'updated', stack, notices: ['cleanup-failed'] };
	try {
		await act(async () => { await mounted.stacks.openEdit('a'); });
		await act(async () => { pending = mounted.stacks.apply({ schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3,
			expectedStateRevision: 2, type: 'update', id: 'stack', expectedStackRevision: 2, photoIds: stack.photoIds, coverPhotoId: 'a' }); await settle(); });
		mounted.cancel(); await act(async () => { saved.resolve(ack); assert.equal(await pending, ack); });
		assert.equal(mounted.stacks.receipt, ack); assert.equal(mounted.stacks.notice, 'refresh-failed'); assert.equal(calls, 1);
	} finally { saved.resolve(ack); await pending; await mounted.dispose(); }
});

test('hidden or stale-snapshot grouping commands and member bindings refuse before resource admission', async () => {
	const owner = port(); let writes = 0, reads = 0;
	owner.applyStack = async () => { writes++; throw new Error('Unexpected stale command'); };
	owner.readStackMembers = async (_binding, ids) => { reads++; return { context, rows: ids.map(photoId => ({ photoId, fileName: `${photoId}.png`, photoRevision: 1 })) }; };
	const mounted = await mount(owner);
	try {
		await act(async () => { await mounted.stacks.openEdit('a'); }); const before = mounted.operations;
		await act(async () => { assert.equal(await mounted.stacks.apply({ schemaVersion: 1, catalogId: 'foreign',
			expectedCatalogRevision: 3, expectedStateRevision: 2, type: 'dissolve', id: 'stack', expectedStackRevision: 2 }), null); });
		await act(async () => { await assert.rejects(mounted.stacks.readMembers({ schemaVersion: 1, catalogId: 'catalog',
			catalogRevision: 99, indexRevision: 4, stateRevision: 2, stackId: 'stack', stackRevision: 2 }, ['a'], new AbortController().signal)); });
		await act(async () => { mounted.stacks.close(); assert.equal(await mounted.stacks.apply({ schemaVersion: 1, catalogId: 'catalog',
			expectedCatalogRevision: 3, expectedStateRevision: 2, type: 'dissolve', id: 'stack', expectedStackRevision: 2 }), null); });
		assert.equal(writes, 0); assert.equal(reads, 1); assert.equal(mounted.operations, before);
	} finally { await mounted.dispose(); }
});

for (const interrupted of ['late-abort', 'post-publication-error'] as const) test(`page-before-ACK ${interrupted} retains the saved grouping receipt and paused notice`, async () => {
	const owner = port();
	const mounted = await mount(owner, async (): Promise<void> => {
		assert.ok(mounted); await mounted.replace('page');
		if (interrupted === 'late-abort') mounted.cancel(); else throw new Error('Post-publication refresh failed');
	});
	try {
		await act(async () => { assert.ok(mounted); await mounted.stacks.openEdit('a'); });
		await act(async () => { assert.ok(mounted); assert.equal((await mounted.stacks.apply({ schemaVersion: 1, catalogId: 'catalog',
			expectedCatalogRevision: 3, expectedStateRevision: 2, type: 'dissolve', id: 'stack', expectedStackRevision: 2 }))?.action, 'dissolved'); });
		assert.equal(mounted.stacks.visible, true); assert.equal(mounted.stacks.receipt?.action, 'dissolved');
		assert.equal(mounted.stacks.notice, 'refresh-failed'); assert.equal(mounted.stacks.busy, false);
		await act(async () => { assert.ok(mounted); assert.equal(await mounted.stacks.apply({ schemaVersion: 1, catalogId: 'catalog',
			expectedCatalogRevision: 3, expectedStateRevision: 2, type: 'dissolve', id: 'stack', expectedStackRevision: 2 }), null); });
	} finally { await mounted.dispose(); }
});
