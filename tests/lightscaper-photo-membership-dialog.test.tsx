/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoMembershipDialogCopyV1 } from '../src/common/editor/ui/lightscaper/PhotoMembershipDialog.tsx';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryMembershipPatchV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';
import { PhotoLibraryDefinitionReader } from '../src/common/editor/controller/shared/photo-library-definition-reader.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: Membership } = await import('../src/common/editor/ui/lightscaper/PhotoMembershipDialog.tsx'); hooks.deregister();
const copy: PhotoMembershipDialogCopyV1 = {
	photoDefinitionRoot: 'Root', photoDefinitionUp: 'Up', photoDefinitionNext: 'Next', photoDefinitionReload: 'Reload', photoDefinitionChoose: 'Choose',
	photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear', photoDefinitionSelected: 'Selected', photoDefinitionEmpty: 'Empty', photoDefinitionFailed: 'Unavailable',
	photoWorking: 'Working', photoCloseMetadata: 'Close', photoMembershipTitle: 'Memberships', photoMembershipFolder: 'Folder',
	photoMembershipKeywords: 'Keywords', photoMembershipCollections: 'Collections', photoMembershipAdd: 'Add', photoMembershipRemove: 'Remove',
	photoMembershipClearFolder: 'Clear folder', photoMembershipApply: 'Apply', photoMembershipNone: 'None', photoMembershipManualOnly: 'Only manual collections are assignable',
	photoMembershipPrevious: 'Previous',
};
const ids = Array.from({ length: 70 }, (_, index) => `keyword-${String(index).padStart(3, '0')}`);
const snapshot = { photoId: 'photo', revision: 9, folderId: null, keywordIds: ids, collectionIds: ['manual'] };
const base = { copy, snapshot, busy: false, error: null, onClose: () => undefined, definitionReader: new PhotoLibraryDefinitionReader(),
	readDefinition: async (request: PhotoLibraryDefinitionReadRequestV1) => ({ rootRevision: 12, queryJson: null,
		row: request.kind === 'collection' ? { kind: request.kind, id: request.id, name: 'Manual collection', collectionKind: 'manual' as const }
			: { kind: request.kind, id: request.id, name: `Display ${request.id.replace('keyword-', '')}`, parentId: null } }),
	readDefinitions: async (request: { kind: string }) => ({ rootRevision: 12, parent: null, selected: null, cursor: null,
		rows: request.kind === 'keyword' ? [{ kind: 'keyword' as const, id: 'extra', name: 'Extra', parentId: null }]
			: request.kind === 'collection' ? [{ kind: 'collection' as const, id: 'smart', name: 'Smart', collectionKind: 'smart' as const }] : [] }),
};

test('one bounded membership page adds/removes explicitly while retaining every unseen ID', async () => {
	const writes: Array<{ photo: string; revision: number; patch: PhotoLibraryMembershipPatchV1 }> = [];
	const mounted = await mount({ ...base, onApply: (photo, revision, patch) => { writes.push({ photo, revision, patch }); } });
	try {
		await mounted.change('keyword'); assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 64);
		assert.equal(mounted.dom.one('[data-membership-name="keyword-000"]').textContent, 'Display 000');
		await mounted.click('[data-membership-next]'); assert.equal(mounted.dom.container.querySelectorAll('[data-membership-id]').length, 6);
		await mounted.click('[data-membership-remove="keyword-069"]');
		await mounted.click('[data-definition-choose="extra"]'); await mounted.click('[data-membership-add]'); await mounted.submit();
		assert.equal(writes[0]?.photo, 'photo'); assert.equal(writes[0]?.revision, 9);
		assert.deepEqual(new Set(writes[0]?.patch.keywordIds), new Set([...ids.slice(0, -1), 'extra']));
		assert.deepEqual(writes[0]?.patch.collectionIds, ['manual']); assert.equal(writes[0]?.patch.folderId, null);
	} finally { await mounted.dispose(); }
});

test('smart collections remain query memberships and cannot become authored assignments', async () => {
	let patch: PhotoLibraryMembershipPatchV1 | undefined;
	const mounted = await mount({ ...base, onApply: (_photo, _revision, next) => { patch = next; } });
	try {
		await mounted.change('collection'); await mounted.click('[data-definition-choose="smart"]');
		assert.equal(reactProps(mounted.dom.one('[data-membership-add]')).disabled, true);
		await mounted.click('[data-membership-add]'); await mounted.submit();
		assert.deepEqual(patch?.collectionIds, ['manual']); assert.match(mounted.dom.container.textContent, /Only manual/u);
	} finally { await mounted.dispose(); }
});

test('a failed publication retains its draft, busy submit refuses and a new acknowledged revision resets it', async () => {
	let writes = 0;
	const props = { ...base, onApply: () => { writes++; } }, mounted = await mount(props);
	try {
		await mounted.change('keyword'); await mounted.click('[data-membership-remove="keyword-000"]');
		await mounted.render({ ...props, error: 'Revision conflict' }); await mounted.submit(); assert.equal(writes, 1);
		assert.equal(mounted.dom.find('[data-membership-id="keyword-000"]'), null);
		await mounted.render({ ...props, busy: true }); await mounted.submit(); assert.equal(writes, 1);
		await mounted.render({ ...props, snapshot: { ...snapshot, revision: 10, keywordIds: ['fresh'] } });
		await mounted.change('keyword'); assert.ok(mounted.dom.find('[data-membership-id="fresh"]'));
	} finally { await mounted.dispose(); }
});

test('acknowledged snapshot remounts wait for the canceled old name borrow and preserve the new memberships', async () => {
	const held = deferred<Awaited<ReturnType<typeof base.readDefinition>>>(), calls: PhotoLibraryDefinitionReadRequestV1[] = [];
	let patch: PhotoLibraryMembershipPatchV1 | undefined;
	const props = { ...base, readDefinition: async (request: PhotoLibraryDefinitionReadRequestV1) => {
		calls.push(request); return calls.length === 1 ? held.promise : base.readDefinition(request);
	}, onApply: (_photo: string, _revision: number, next: PhotoLibraryMembershipPatchV1) => { patch = next; } };
	const mounted = await mount(props);
	try {
		await mounted.change('keyword'); assert.equal(calls.length, 1);
		await mounted.render({ ...props, snapshot: { ...snapshot, revision: 10, keywordIds: ['fresh'] } });
		await mounted.change('keyword'); assert.equal(calls.length, 1); assert.equal(calls[0]?.signal?.aborted, true);
		await act(async () => { held.resolve(await base.readDefinition({ kind: 'keyword', id: 'keyword-000' })); });
		assert.deepEqual(calls.map(request => request.id), ['keyword-000', 'fresh']);
		assert.equal(mounted.dom.one('[data-membership-name="fresh"]').textContent, 'Display fresh');
		assert.equal(mounted.dom.container.textContent.includes('Display 000'), false);
		await mounted.submit(); assert.deepEqual(patch?.keywordIds, ['fresh']); assert.deepEqual(patch?.collectionIds, ['manual']);
	} finally { held.resolve(await base.readDefinition({ kind: 'keyword', id: 'keyword-000' })); await mounted.dispose(); }
});

test('closing and reopening reuses the app reader and joins an old nonabortable name borrow', async () => {
	const held = deferred<Awaited<ReturnType<typeof base.readDefinition>>>(), calls: PhotoLibraryDefinitionReadRequestV1[] = [];
	const definitionReader = new PhotoLibraryDefinitionReader();
	const props = { ...base, definitionReader, snapshot: { ...snapshot, folderId: 'old-folder' },
		readDefinition: async (request: PhotoLibraryDefinitionReadRequestV1) => {
			calls.push(request); return calls.length === 1 ? held.promise : base.readDefinition(request);
		}, onApply: () => undefined };
	const closed = await mount(props); await closed.dispose();
	const reopened = await mount({ ...props, snapshot: { ...snapshot, revision: 10, folderId: 'new-folder' } });
	try {
		assert.equal(calls[0]?.signal?.aborted, true); assert.equal(calls.length, 1, 'The old borrowed read must settle before reopening starts another.');
		await act(async () => { held.resolve(await base.readDefinition({ kind: 'folder', id: 'old-folder' })); });
		assert.deepEqual(calls.map(request => request.id), ['old-folder', 'new-folder']);
		assert.equal(reopened.dom.one('[data-membership-name="new-folder"]').textContent, 'Display new-folder');
		assert.equal(reopened.dom.container.textContent.includes('Display old-folder'), false);
	} finally { held.resolve(await base.readDefinition({ kind: 'folder', id: 'old-folder' })); await reopened.dispose(); }
});

type Props = React.ComponentProps<typeof Membership>;
async function mount(props: Props) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async (next: Props) => { await act(async () => { root.render(<Membership {...next} />); }); };
	await render(props);
	return { dom, render, async change(value: string) { const field = dom.container.querySelectorAll('select').find(node => node.name === 'membershipKind' || node.getAttribute('name') === 'membershipKind'); assert.ok(field);
		await act(async () => { reactProps(field).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async submit() { await act(async () => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
