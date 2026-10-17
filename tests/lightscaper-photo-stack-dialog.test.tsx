/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoStackDialog, { type PhotoStackDialogCopyV1, type PhotoStackDialogPropsV1 } from '../src/common/editor/ui/lightscaper/PhotoStackDialog.tsx';
import type { PhotoLibraryStackCommandV1 } from '../src/common/editor/photo-library-stack-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const copy: PhotoStackDialogCopyV1 = {
	photoStackTitle: 'Photo stack', photoStackDescription: 'Group photos without changing their originals.',
	photoStackCover: 'Cover', photoStackMakeCover: 'Make cover', photoStackMoveEarlier: 'Move earlier',
	photoStackMoveLater: 'Move later', photoStackSave: 'Save stack', photoStackDissolve: 'Dissolve stack',
	photoStackDissolveDescription: 'Dissolving keeps every photo in the catalog.', photoStackCreated: 'Stack created',
	photoStackSaved: 'Stack saved', photoStackDissolved: 'Stack dissolved', photoStackRefreshFailed: 'Stack saved; refresh failed.',
	photoStackUnavailable: 'Stack unavailable', photoStackPreviousPage: 'Previous members', photoStackNextPage: 'Next members',
	photoStackPage: 'Members {from}–{to} of {count}', photoStackReload: 'Reload stack', photoStackFailed: 'Stack action failed',
	photoCloseMetadata: 'Close', photoCancelAction: 'Cancel', photoWorking: 'Working', photoOriginalCleanupFailed: 'Cleanup failed',
};
const context = { schemaVersion: 1, catalogId: 'catalog', catalogRevision: 3, indexRevision: 4, stateRevision: 2, stackCount: 1 } as const;
const names = (ids: readonly string[]) => ids.map(photoId => ({ photoId, fileName: `${photoId}.png`, photoRevision: 1 }));
function props(overrides: Partial<PhotoStackDialogPropsV1> = {}): PhotoStackDialogPropsV1 {
	return { generation: {}, mode: 'edit', snapshot: { context, stack: { id: 'stack', revision: 2, photoIds: ['a', 'b', 'c'], coverPhotoId: 'a' } },
		selectedIds: [], members: names(['a', 'b', 'c']), copy, busy: false, error: null, receipt: null, notice: null,
		onReadMembers: async (_binding, ids) => ({ context, rows: names(ids) }), onApply: async () => null,
		onReload: () => undefined, onCancel: () => undefined, onClose: () => undefined, ...overrides };
}

test('real dialog edits ordered IDs and cover through an exact revision-fenced command', async () => {
	const commands: PhotoLibraryStackCommandV1[] = []; const current = props({ onApply: async command => { commands.push(command); return null; } });
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />);
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-stack-member]').length, 3);
		await mounted.event('[data-stack-later="a"]', 'onClick'); await mounted.event('[data-stack-cover="c"]', 'onClick');
		await mounted.event('[data-stack-save]', 'onClick');
		assert.deepEqual(commands, [{ schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3, expectedStateRevision: 2,
			type: 'update', id: 'stack', expectedStackRevision: 2, photoIds: ['b', 'a', 'c'], coverPhotoId: 'c' }]);
		assert.match(mounted.dom.container.textContent, /a.png|b.png|c.png/u);
	} finally { await mounted.dispose(); }
});

test('creation never invents an ID, changes originals, or offers dissolve', async () => {
	let command: PhotoLibraryStackCommandV1 | null = null;
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...props({ mode: 'create', selectedIds: ['c', 'a'],
		snapshot: { context, stack: null }, members: names(['c', 'a']), onApply: async value => { command = value; return null; } })} />);
	try {
		assert.equal(mounted.dom.find('[data-stack-dissolve]'), null); await mounted.event('[data-stack-save]', 'onClick');
		assert.deepEqual(command, { schemaVersion: 1, catalogId: 'catalog', expectedCatalogRevision: 3, expectedStateRevision: 2,
			type: 'create', photoIds: ['c', 'a'], coverPhotoId: 'c' });
	} finally { await mounted.dispose(); }
});

test('a1024-member stack renders64 names at a time and page reads replace the names', async () => {
	const ids = Array.from({ length: 1024 }, (_, index) => `p-${String(index)}`), reads: readonly string[][] = [];
	const current = props({ snapshot: { context, stack: { id: 'stack', revision: 2, photoIds: ids, coverPhotoId: ids[0]! } },
		members: names(ids.slice(0, 64)), onReadMembers: async (binding, page) => {
			assert.equal(binding.stackRevision, 2); (reads as string[][]).push([...page]); return { context, rows: names(page) };
		} });
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />);
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-stack-member]').length, 64);
		await mounted.event('[data-stack-next]', 'onClick');
		assert.equal(reads.length, 1); assert.equal(reads[0]?.length, 64); assert.equal(reads[0]?.[0], 'p-64');
		assert.equal(mounted.dom.container.querySelectorAll('[data-stack-member]').length, 64);
		assert.doesNotMatch(mounted.dom.container.textContent, /p-0.png/u); assert.match(mounted.dom.container.textContent, /p-64.png/u);
	} finally { await mounted.dispose(); }
});

test('Close hides without cancelling a held save; reentry stays locked until native acknowledgment', async () => {
	const save = deferred<null>(); let calls = 0, closes = 0, cancels = 0;
	const current = props({ onApply: async () => { calls++; return save.promise; }, onClose: () => { closes++; }, onCancel: () => { cancels++; } });
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />);
	try {
		await mounted.event('[data-stack-save]', 'onClick'); await mounted.event('[data-stack-save]', 'onClick');
		assert.equal(calls, 1); assert.equal(reactProps(mounted.dom.one('[data-stack-next]')).disabled, true);
		await mounted.event('[data-stack-close]', 'onClick'); assert.equal(closes, 1); assert.equal(cancels, 0);
		assert.equal(mounted.dom.find('[role="dialog"]'), null);
		await act(async () => { save.resolve(null); await settle(); });
	} finally { save.resolve(null); await mounted.dispose(); }
});

test('stale page, generation and unmounted handlers cannot write, navigate or close a current dialog', async () => {
	for (const change of ['generation', 'snapshot', 'unmount'] as const) {
		let actions = 0; let current = props({ onApply: async () => { actions++; return null; }, onClose: () => { actions++; } });
		const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />); let disposed = false;
		try {
			const save = reactProps(mounted.dom.one('[data-stack-save]')).onClick, close = reactProps(mounted.dom.one('[data-stack-close]')).onClick;
			if (change === 'unmount') { await mounted.dispose(); disposed = true; }
			else { current = { ...current, ...(change === 'generation' ? { generation: {} } : { snapshot: { ...current.snapshot! } }) }; await mounted.render(); }
			await act(async () => { save?.({}); close?.({}); await settle(); }); assert.equal(actions, 0);
		} finally { if (!disposed) await mounted.dispose(); }
	}
});

test('late member reads cannot repopulate a replaced generation and saved notices remain distinct from failures', async () => {
	const read = deferred<Awaited<ReturnType<PhotoStackDialogPropsV1['onReadMembers']>>>();
	const ids = Array.from({ length: 65 }, (_, index) => `p-${String(index)}`);
	let current = props({ snapshot: { context, stack: { id: 'stack', revision: 2, photoIds: ids, coverPhotoId: ids[0]! } },
		members: names(ids.slice(0, 64)), onReadMembers: async () => read.promise });
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />);
	try {
		await mounted.event('[data-stack-next]', 'onClick'); current = props({ generation: {}, error: 'Refresh broke', notice: 'refresh-failed',
			receipt: { schemaVersion: 1, catalogId: 'catalog', catalogRevision: 4, stateRevision: 3, action: 'updated', stack: null, notices: ['cleanup-failed'] } });
		await mounted.render(); await act(async () => { read.resolve({ context, rows: names(['p-64']) }); await settle(); });
		assert.doesNotMatch(mounted.dom.container.textContent, /p-64.png/u); assert.match(mounted.dom.one('[data-stack-notice]').textContent, /saved; refresh failed/u);
		assert.equal(mounted.dom.one('[data-stack-error]').getAttribute('role'), 'alert');
		assert.match(mounted.dom.container.textContent, /Cleanup failed/u); assert.equal(reactProps(mounted.dom.one('[data-stack-save]')).disabled, true);
	} finally { read.resolve({ context, rows: [] }); await mounted.dispose(); }
});

test('moving a boundary member reads only the replacement64 names and keeps all1024 IDs in the command', async () => {
	const ids = Array.from({ length: 1024 }, (_, index) => `p-${String(index)}`), requests: string[][] = [];
	const commands: PhotoLibraryStackCommandV1[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...props({
		snapshot: { context, stack: { id: 'stack', revision: 2, photoIds: ids, coverPhotoId: 'p-0' } }, members: names(ids.slice(0, 64)),
		onReadMembers: async (_binding, requested) => { requests.push([...requested]); return { context, rows: names(requested) }; },
		onApply: async value => { commands.push(value); return null; },
	})} />);
	try {
		await mounted.event('[data-stack-later="p-63"]', 'onClick'); assert.equal(requests.length, 1);
		assert.equal(requests[0]?.length, 64); assert.equal(requests[0]?.at(-1), 'p-64');
		assert.equal(mounted.dom.container.querySelectorAll('[data-stack-member]').length, 64);
		assert.match(mounted.dom.container.textContent, /p-64.png/u); assert.doesNotMatch(mounted.dom.container.textContent, /p-63.png/u);
		await mounted.event('[data-stack-save]', 'onClick'); const command = commands[0]; assert.ok(command); assert.equal(command.type, 'update');
		assert.ok('photoIds' in command); assert.equal(command.photoIds.length, 1024);
		assert.deepEqual(command.photoIds.slice(62, 66), ['p-62', 'p-64', 'p-63', 'p-65']);
	} finally { await mounted.dispose(); }
});

test('foreign member response cannot replace a page or discard the draft; explicit retry remains possible', async () => {
	const ids = Array.from({ length: 65 }, (_, index) => `p-${String(index)}`); let reads = 0;
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...props({
		snapshot: { context, stack: { id: 'stack', revision: 2, photoIds: ids, coverPhotoId: 'p-0' } }, members: names(ids.slice(0, 64)),
		onReadMembers: async (_binding, requested) => { reads++; return { context: { ...context, catalogRevision: 999 }, rows: names(requested) }; },
	})} />);
	try {
		await mounted.event('[data-stack-next]', 'onClick'); assert.equal(reads, 1);
		assert.equal(mounted.dom.container.querySelectorAll('[data-stack-member]').length, 64);
		assert.match(mounted.dom.container.textContent, /Stack unavailable/u);
		assert.equal(reactProps(mounted.dom.one('[data-stack-next]')).disabled, false);
		await mounted.event('[data-stack-next]', 'onClick'); assert.equal(reads, 2);
	} finally { await mounted.dispose(); }
});

test('late snapshot keeps initial focus pending until the first member control is enabled, then preserves user focus', async () => {
	let current = props({ busy: true });
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...current} />);
	try {
		const first = mounted.dom.one('[data-stack-cover="a"]');
		assert.equal(reactProps(first).disabled, true); assert.notEqual(mounted.dom.container.ownerDocument.activeElement, first);
		current = { ...current, busy: false }; await mounted.render();
		assert.equal(mounted.dom.container.ownerDocument.activeElement, first);
		const later = mounted.dom.one('[data-stack-later="a"]'); later.focus();
		current = { ...current, busy: true }; await mounted.render(); current = { ...current, busy: false }; await mounted.render();
		assert.equal(mounted.dom.container.ownerDocument.activeElement, later);
	} finally { await mounted.dispose(); }
});

test('Close synchronously retires an idle retained Save in the same event turn', async () => {
	let writes = 0, closes = 0;
	const mounted = await mountPhotoImportUi(() => <PhotoStackDialog {...props({ onApply: async () => { writes++; return null; }, onClose: () => { closes++; } })} />);
	try {
		const save = reactProps(mounted.dom.one('[data-stack-save]')).onClick, close = reactProps(mounted.dom.one('[data-stack-close]')).onClick;
		await act(async () => { close?.({}); save?.({}); close?.({}); await settle(); });
		assert.equal(writes, 0); assert.equal(closes, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { await mounted.dispose(); }
});
