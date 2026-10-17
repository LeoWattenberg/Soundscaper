/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoCatalogOrganizerDialogCopyV1 } from '../src/common/editor/ui/lightscaper/PhotoCatalogOrganizerDialog.tsx';
import type { PhotoLibraryDefinitionSnapshotV1 } from '../src/common/editor/photo-library-organization-port-v1.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: Organizer } = await import('../src/common/editor/ui/lightscaper/PhotoCatalogOrganizerDialog.tsx'); hooks.deregister();
const copy: PhotoCatalogOrganizerDialogCopyV1 = {
	photoDefinitionRoot: 'Root', photoDefinitionUp: 'Up', photoDefinitionNext: 'Next', photoDefinitionReload: 'Reload', photoDefinitionChoose: 'Choose',
	photoDefinitionOpen: 'Open', photoDefinitionClear: 'Clear', photoDefinitionSelected: 'Selected', photoDefinitionEmpty: 'Empty', photoDefinitionFailed: 'Unavailable',
	photoWorking: 'Working', photoCloseMetadata: 'Close', photoOrganizerTitle: 'Organize library', photoOrganizerKind: 'Definitions',
	photoOrganizerFolder: 'Folder', photoOrganizerKeyword: 'Keyword', photoOrganizerCollection: 'Collection', photoOrganizerCreate: 'Create',
	photoOrganizerEdit: 'Edit', photoOrganizerName: 'Name', photoOrganizerId: 'ID', photoOrganizerParent: 'Choose parent', photoOrganizerRename: 'Rename',
	photoOrganizerReparent: 'Move', photoOrganizerDeleteEmpty: 'Delete empty', photoOrganizerReload: 'Reload definition', photoOrganizerManual: 'Manual',
	photoOrganizerSmart: 'Smart', photoOrganizerQueryJson: 'Query JSON', photoOrganizerQueryGrammar: 'All ten existing grammar variants are accepted.', photoOrganizerSaveCollection: 'Save collection',
};
const smart: PhotoLibraryDefinitionSnapshotV1 = { rootRevision: 12, row: { kind: 'collection', id: 'smart', name: 'Live picks', collectionKind: 'smart' },
	queryJson: JSON.stringify({ kind: 'rating', minimum: 4, maximum: 5 }) };
const base = {
	copy, busy: false, error: null, onClose: () => undefined, createId: () => 'new-definition',
	readDefinitions: async (request: { kind: string }) => ({ rootRevision: 12, parent: null, selected: null, cursor: null,
		rows: request.kind === 'collection' ? [smart.row] : [] }),
	readDefinition: async () => smart,
};

test('smart authoring emits the complete JSON draft with its observed root revision and preserves a conflicting draft', async () => {
	const calls: unknown[] = [];
	const mounted = await mount({ ...base, onApply: async (...args) => { calls.push(args); throw new Error('Catalog conflict'); } });
	try {
		await mounted.change('organizerKind', 'collection'); await mounted.click('[data-definition-choose="smart"]');
		const edited = JSON.stringify({ kind: 'all', terms: [{ kind: 'any', terms: [{ kind: 'file-name', contains: 'Raw' }, { kind: 'folder', id: 'folder' }] },
			{ kind: 'not', term: { kind: 'flag', value: 'reject' } }, { kind: 'capture-time', from: null, to: '2026-10-08T12:00:00' }] }, null, 2);
		await mounted.change('definitionName', 'Updated'); await mounted.change('queryJson', edited); await mounted.submit();
		assert.deepEqual(calls[0], [12, { type: 'update-collection', collection: { id: 'smart', name: 'Updated', kind: 'smart', queryJson: edited } }]);
		assert.match(mounted.dom.one('[role="alert"]').textContent, /conflict/u);
		assert.equal(reactProps(mounted.field('queryJson')).value, edited); assert.equal(reactProps(mounted.field('definitionName')).value, 'Updated');
		await mounted.click('[data-organizer-reload]'); assert.equal(reactProps(mounted.field('definitionName')).value, 'Live picks');
	} finally { await mounted.dispose(); }
});

test('creation requires an explicit submit and retries retain the same injected identifier', async () => {
	let ids = 0; const calls: unknown[] = [];
	const mounted = await mount({ ...base, createId: () => `new-${++ids}`, onApply: async (...args) => { calls.push(args); throw new Error('Quota'); } });
	try {
		assert.equal(ids, 0); assert.equal(calls.length, 0);
		await mounted.change('definitionName', 'Virtual folder'); await mounted.submit(); await mounted.submit();
		assert.equal(ids, 1); assert.deepEqual(calls[0], [12, { type: 'create-node', nodeKind: 'folder', id: 'new-1', name: 'Virtual folder', parentId: null }]);
		assert.deepEqual(calls[1], calls[0]);
	} finally { await mounted.dispose(); }
});

test('changing definition kind aborts a held selection read and its late snapshot cannot replace the new draft', async () => {
	const pending = deferred<PhotoLibraryDefinitionSnapshotV1>(); let signal: AbortSignal | undefined;
	const mounted = await mount({ ...base, readDefinition: async request => { signal = request.signal; return pending.promise; },
		onApply: async () => ({ rootRevision: 13, row: null }) });
	try {
		await mounted.change('organizerKind', 'collection'); await mounted.click('[data-definition-choose="smart"]');
		assert.equal(signal?.aborted, false);
		await mounted.change('organizerKind', 'keyword'); assert.equal(signal?.aborted, true);
		await act(async () => { pending.resolve(smart); });
		assert.equal(mounted.dom.find('[data-organizer-selected]'), null); assert.equal(reactProps(mounted.field('definitionName')).value, '');
	} finally { pending.resolve(smart); await mounted.dispose(); }
});

test('choosing the current definition again preserves its unsaved draft and remains publishable', async () => {
	const calls: unknown[] = [];
	const mounted = await mount({ ...base, onApply: async (...args) => { calls.push(args); return { rootRevision: 13, row: smart.row }; } });
	try {
		await mounted.change('organizerKind', 'collection'); await mounted.click('[data-definition-choose="smart"]');
		await mounted.change('definitionName', 'Unsaved name'); await mounted.click('[data-definition-choose="smart"]'); await mounted.submit();
		assert.equal(calls.length, 1); assert.deepEqual(calls[0], [12, { type: 'update-collection',
			collection: { id: 'smart', name: 'Unsaved name', kind: 'smart', queryJson: smart.queryJson } }]);
	} finally { await mounted.dispose(); }
});

type Props = React.ComponentProps<typeof Organizer>;
async function mount(props: Props) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	await act(async () => { root.render(<Organizer {...props} />); });
	const field = (name: string) => { const value = dom.container.querySelectorAll('input,textarea,select').find(node => node.name === name || node.getAttribute('name') === name); assert.ok(value); return value; };
	return { dom, field, async change(name: string, value: string) { await act(async () => { reactProps(field(name)).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async submit() { await act(async () => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
