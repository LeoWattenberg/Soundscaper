/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { registerHooks } from 'node:module';
import { createRoot } from 'react-dom/client';
import type { PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import type { PhotoLibrarySavedCollectionAcknowledgementV1, PhotoLibrarySavedCollectionCommandV1,
	PhotoLibrarySavedCollectionPageV1, PhotoLibrarySavedCollectionSnapshotV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { usePhotoSavedFilters } from '../src/common/editor/ui/lightscaper/use-photo-saved-filters.ts';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 as runtime } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: Dialog } = await import('../src/common/editor/ui/lightscaper/PhotoSavedFiltersDialog.tsx');
hooks.deregister();
type Props = React.ComponentProps<typeof Dialog>;
type Filters = ReturnType<typeof usePhotoSavedFilters>;
const context = { catalogId: 'catalog', catalogRevision: 4, indexRevision: 3, collectionStateRevision: 2, collectionCount: 1 };
const initial: PhotoLibraryQueryV2 = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'photo-id', direction: 'ascending' }, predicate: null };
const savedQuery = runtime.readQueryJson(JSON.stringify({ ...initial, text: 'RAW', filter: { kind: 'keyword', id: 'keyword-1' },
	sort: { field: 'rating', direction: 'descending' }, predicate: { kind: 'any', terms: [
		{ kind: 'presence', column: 'iso', value: 'unknown' }, { kind: 'not', term: { kind: 'keyword', id: 'keyword-2' } }] } }));
const snapshot: PhotoLibrarySavedCollectionSnapshotV1 = { collectionId: 'saved', context,
	definition: { id: 'saved', revision: 2, name: 'Full recipe', queryJson: runtime.writeQueryJson(savedQuery) } };
const labels = { flags: { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' },
	colorLabels: { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } };

test('create acquires only creation context and emits the complete current query without applying it', async () => {
	const mounted = await mount();
	try {
		assert.deepEqual(mounted.snapshots, [null]); assert.deepEqual(mounted.pages, []);
		await mounted.change('savedFilterName', 'Landscapes'); await mounted.change('queryText', 'tree');
		await mounted.click('[data-saved-save]');
		assert.equal(mounted.commands.length, 1); const command = mounted.commands[0];
		assert.equal(command?.type, 'create'); if (command?.type === 'create') {
			assert.deepEqual(command.context, context); assert.equal(command.name, 'Landscapes');
			assert.deepEqual(runtime.readQueryJson(command.queryJson), { ...initial, text: 'tree' });
		}
		assert.deepEqual(mounted.used, []); assert.equal(mounted.shownAll, 0);
		assert.match(mounted.dom.container.textContent, /Filter saved/u);
	} finally { await mounted.dispose(); }
});

test('Save current saved filter decodes its actual criteria then acquires separate creation authority', async () => {
	const calls: string[] = [], actualRuntime = { ...runtime, readQueryJson: (value: unknown) => {
		calls.push('decode'); return runtime.readQueryJson(value);
	} };
	const mounted = await mount({ initialCollectionId: 'saved', runtime: actualRuntime }, {
		readSnapshot: async id => { calls.push(id ?? 'create'); return id === null ? { collectionId: null, context, definition: null } : snapshot; },
	});
	try {
		assert.deepEqual(calls, ['saved', 'decode', 'create']); assert.deepEqual(mounted.pages, []);
		assert.equal(mounted.value('savedFilterName'), 'Full recipe'); assert.equal(mounted.value('queryText'), savedQuery.text);
		await mounted.change('savedFilterName', 'Copy'); await mounted.click('[data-saved-save]');
		const command = mounted.commands[0]; assert.equal(command?.type, 'create');
		if (command?.type === 'create') assert.deepEqual(runtime.readQueryJson(command.queryJson), savedQuery);
		assert.equal(mounted.filters.loaded?.collectionId, 'created');
	} finally { await mounted.dispose(); }
});

test('manage reads one summary page, selection grants no authority, and explicit Load replaces the draft once', async () => {
	let decodes = 0;
	const mounted = await mount({ initialMode: 'manage', initialCollectionId: 'saved', runtime: {
		...runtime, readQueryJson: value => { decodes++; return runtime.readQueryJson(value); },
	} });
	try {
		assert.deepEqual(mounted.pages, [null]); assert.deepEqual(mounted.snapshots, []);
		assert.equal(mounted.disabled('[data-saved-save]'), true); assert.equal(mounted.disabled('[data-saved-delete]'), true);
		await mounted.click('[data-saved-load]'); assert.deepEqual(mounted.snapshots, ['saved']); assert.equal(decodes, 1);
		assert.equal(mounted.value('savedFilterName'), 'Full recipe'); assert.equal(mounted.value('queryText'), savedQuery.text);
		assert.ok(mounted.dom.find('[data-metadata-preserved]'));
		await mounted.change('querySort', 'file-name'); await mounted.click('[data-saved-save]');
		const command = mounted.commands[0]; assert.equal(command?.type, 'update');
		if (command?.type === 'update') {
			assert.equal(command.collectionId, 'saved'); assert.equal(command.expectedDefinitionRevision, 2);
			assert.deepEqual(runtime.readQueryJson(command.queryJson), { ...savedQuery, sort: { ...savedQuery.sort, field: 'file-name' } });
		}
	} finally { await mounted.dispose(); }
});

test('Reload after a conflict renews context but preserves dirty name, full query, and selected ID', async () => {
	let read = 0;
	const mounted = await mount({ initialMode: 'manage', initialCollectionId: 'saved' }, {
		readSnapshot: async () => { read++; return read === 1 ? snapshot : { ...snapshot,
			context: { ...context, catalogRevision: 7, indexRevision: 6, collectionStateRevision: 5 },
			definition: { ...snapshot.definition!, revision: 8, name: 'Remote edit', queryJson: runtime.writeQueryJson(initial) } }; },
		apply: async () => ({ outcome: 'failed' }),
	});
	try {
		await mounted.click('[data-saved-load]'); await mounted.change('savedFilterName', 'Dirty name');
		await mounted.change('queryText', 'Dirty text'); await mounted.click('[data-saved-save]');
		assert.equal(mounted.value('savedFilterName'), 'Dirty name'); assert.equal(mounted.value('queryText'), 'Dirty text');
		await mounted.click('[data-saved-reload]');
		assert.equal(mounted.value('savedFilterName'), 'Dirty name'); assert.equal(mounted.value('queryText'), 'Dirty text');
		await mounted.click('[data-saved-save]'); const command = mounted.commands[1];
		assert.equal(command?.type, 'update'); if (command?.type === 'update') {
			assert.equal(command.context.catalogRevision, 7); assert.equal(command.expectedDefinitionRevision, 8);
			assert.equal(command.name, 'Dirty name'); assert.equal(runtime.readQueryJson(command.queryJson).text, 'dirty text');
		}
	} finally { await mounted.dispose(); }
});

test('a different summary selection disables old write authority until a fresh explicit load', async () => {
	const mounted = await mount({ initialMode: 'manage', initialCollectionId: 'saved' });
	try {
		await mounted.click('[data-saved-load]'); const staleSave = reactProps(mounted.dom.one('[data-saved-save]')).onClick;
		await mounted.select('other'); assert.equal(mounted.disabled('[data-saved-save]'), true);
		await act(async () => { staleSave?.({}); }); assert.equal(mounted.commands.length, 0);
		assert.equal(mounted.value('savedFilterName'), 'Full recipe'); assert.equal(mounted.value('queryText'), savedQuery.text);
	} finally { await mounted.dispose(); }
});

test('active filter deletion stays disabled until the parent acknowledges another active selection', async () => {
	const mounted = await mount({ initialMode: 'manage', initialCollectionId: 'saved', activeCollectionId: 'saved' });
	try {
		await mounted.click('[data-saved-load]'); assert.equal(mounted.disabled('[data-saved-delete]'), true);
		assert.match(mounted.dom.container.textContent, /before deleting the active filter/u);
		await mounted.click('[data-saved-all]'); assert.equal(mounted.shownAll, 1);
		assert.equal(mounted.disabled('[data-saved-delete]'), true);
		await mounted.render({ activeCollectionId: null }); await mounted.click('[data-saved-delete]');
		assert.deepEqual(mounted.commands[0], { type: 'delete', context, collectionId: 'saved', expectedDefinitionRevision: 2 });
		assert.match(mounted.dom.container.textContent, /Filter deleted/u); assert.equal(mounted.disabled('[data-saved-save]'), true);
	} finally { await mounted.dispose(); }
});

test('Next replaces the bounded summary page and Refresh list does not silently Load or overwrite a draft', async () => {
	const mounted = await mount({ initialMode: 'manage' }, { readPage: async cursor => cursor === null
		? { items: Array.from({ length: 64 }, (_, index) => ({ id: `saved-${String(index)}`, name: `Saved ${String(index)}`, revision: 1 })), cursor: 'next' }
		: { items: [{ id: 'other', name: 'Other', revision: 4 }], cursor: null } });
	try {
		assert.equal(mounted.dom.container.querySelectorAll('[data-saved-select]').length, 64);
		await mounted.click('[data-saved-next]'); assert.deepEqual(mounted.pages, [null, 'next']);
		assert.equal(mounted.dom.container.querySelectorAll('[data-saved-select]').length, 1);
		await mounted.change('savedFilterName', 'Local'); await mounted.click('[data-saved-list]');
		assert.equal(mounted.value('savedFilterName'), 'Local'); assert.deepEqual(mounted.snapshots, []);
	} finally { await mounted.dispose(); }
});

test('one synchronous demand blocks double Save, retained Close→Save and new calls while held work settles', async () => {
	const held = deferred<Awaited<ReturnType<Filters['apply']>>>();
	const mounted = await mount({}, { apply: () => held.promise });
	try {
		await mounted.change('savedFilterName', 'Held'); const save = reactProps(mounted.dom.one('[data-saved-save]')).onClick;
		await act(async () => { save?.({}); save?.({}); await settle(); }); assert.equal(mounted.commands.length, 1);
		assert.equal(mounted.disabled('[data-saved-save]'), true); assert.equal(mounted.disabled('[data-saved-close]'), false);
		await mounted.click('[data-saved-cancel]'); assert.equal(mounted.cancels, 1); assert.equal(mounted.commands.length, 1);
		await act(async () => { reactProps(mounted.dom.one('[data-saved-close]')).onClick?.({}); save?.({}); });
		assert.equal(mounted.closes, 1); assert.equal(mounted.cancels, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
		await act(async () => { held.resolve({ outcome: 'acknowledged', receipt: acknowledgement('create', 'Held'), notice: null }); await settle(); });
		assert.equal(mounted.commands.length, 1); assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { held.resolve({ outcome: 'failed' }); await mounted.dispose(); }
});

test('same-gesture Close retires an idle Save and generation replacement fences old handlers and late Load', async () => {
	const mounted = await mount();
	try {
		await mounted.change('savedFilterName', 'Idle'); const save = reactProps(mounted.dom.one('[data-saved-save]')).onClick;
		await act(async () => { reactProps(mounted.dom.one('[data-saved-close]')).onClick?.({}); save?.({}); });
		assert.equal(mounted.commands.length, 0); assert.equal(mounted.closes, 1);
	} finally { await mounted.dispose(); }
	const held = deferred<PhotoLibrarySavedCollectionSnapshotV1 | null>();
	const loading = await mount({ initialMode: 'manage', initialCollectionId: 'saved' }, { readSnapshot: () => held.promise });
	try {
		const load = reactProps(loading.dom.one('[data-saved-load]')).onClick;
		await act(async () => { load?.({}); await settle(); });
		await loading.render({ generation: {} });
		await act(async () => { held.resolve(snapshot); await settle(); load?.({}); });
		assert.equal(loading.value('queryText'), ''); assert.equal(loading.value('savedFilterName'), '');
		assert.equal(loading.disabled('[data-saved-save]'), true); assert.equal(loading.snapshots.length, 1);
	} finally { held.resolve(null); await loading.dispose(); }
});

test('invalid condition drafts refuse Save and full JSON explicitly authors nested grammar without silent narrowing', async () => {
	const mounted = await mount();
	try {
		await mounted.change('savedFilterName', 'Nested'); await mounted.click('[data-metadata-add]');
		assert.equal(mounted.disabled('[data-saved-save]'), true);
		await mounted.toggleJson(true); await mounted.change('savedFilterQueryJson', '{invalid');
		assert.equal(mounted.disabled('[data-saved-save]'), true);
		await mounted.change('savedFilterQueryJson', runtime.writeQueryJson(savedQuery));
		assert.equal(mounted.disabled('[data-saved-save]'), false); await mounted.click('[data-saved-save]');
		const command = mounted.commands[0]; assert.equal(command?.type, 'create');
		if (command?.type === 'create') assert.deepEqual(runtime.readQueryJson(command.queryJson), savedQuery);
		await mounted.toggleJson(false); assert.ok(mounted.dom.find('[data-metadata-preserved]'));
	} finally { await mounted.dispose(); }
});

test('known durable acknowledgement and refresh warning remain distinct from failure or cleanup notice', async () => {
	const mounted = await mount({}, { apply: async command => ({ outcome: 'acknowledged',
		receipt: { ...acknowledgement(command.type, 'Notice'), notices: ['cleanup-failed'] }, notice: 'refresh-failed' }) });
	try {
		await mounted.change('savedFilterName', 'Notice'); await mounted.click('[data-saved-save]');
		assert.ok(mounted.dom.find('[data-saved-receipt]')); assert.ok(mounted.dom.find('[data-saved-refresh-failed]'));
		assert.ok(mounted.dom.find('[data-saved-cleanup-failed]')); assert.equal(mounted.commands.length, 1);
		assert.doesNotMatch(mounted.dom.container.textContent, /original was restored/u);
	} finally { await mounted.dispose(); }
});

test('NaN generation remains legal, busy controls fence retained edits, and prop replacement never resets a dirty draft', async () => {
	const mounted = await mount({ generation: Number.NaN });
	try {
		await mounted.change('savedFilterName', 'Dirty'); await mounted.change('queryText', 'Local');
		const save = reactProps(mounted.dom.one('[data-saved-save]')).onClick;
		await mounted.render({ busy: true, initialQuery: savedQuery });
		await act(async () => { save?.({}); }); assert.equal(mounted.commands.length, 0);
		assert.equal(mounted.value('savedFilterName'), 'Dirty'); assert.equal(mounted.value('queryText'), 'Local');
		await mounted.render({ busy: false }); await mounted.click('[data-saved-save]'); assert.equal(mounted.commands.length, 1);
	} finally { await mounted.dispose(); }
});

test('explicit Use has one admitted intent callback and held use stays owned through Close', async () => {
	const held = deferred<void>(); let intents = 0;
	const mounted = await mount({ initialMode: 'manage', initialCollectionId: 'saved', onUse: () => { intents++; } }, { use: () => held.promise });
	try {
		assert.equal(intents, 0); const chooseSaved = reactProps(mounted.dom.one('[data-saved-use]')).onClick;
		await act(async () => { chooseSaved?.({}); chooseSaved?.({}); await settle(); });
		assert.equal(intents, 1); assert.deepEqual(mounted.used, ['saved']); assert.equal(mounted.disabled('[data-saved-use]'), true);
		await mounted.click('[data-saved-close]'); assert.equal(mounted.cancels, 0);
		await act(async () => { held.resolve(); await settle(); chooseSaved?.({}); }); assert.equal(intents, 1);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('a closed advanced scratch handler cannot edit the remounted controlled criteria', async () => {
	const mounted = await mount();
	try {
		await mounted.change('savedFilterName', 'Current'); await mounted.toggleJson(true);
		const stale = reactProps(mounted.control('savedFilterQueryJson')).onChange;
		await mounted.toggleJson(false); await act(async () => { stale?.({ currentTarget: { value: runtime.writeQueryJson(savedQuery) } }); });
		assert.equal(mounted.value('queryText'), ''); await mounted.click('[data-saved-save]');
		const command = mounted.commands[0]; assert.ok(command && command.type === 'create'); assert.deepEqual(runtime.readQueryJson(command.queryJson), initial);
	} finally { await mounted.dispose(); }
});

test('a codec admission refusal is localized in the dialog before any host write', async () => {
	const mounted = await mount({ runtime: { ...runtime, writeQueryJson: () => { throw new RangeError('Full query byte bound'); } } });
	try {
		await mounted.change('savedFilterName', 'Invalid'); await mounted.click('[data-saved-save]');
		assert.equal(mounted.commands.length, 0); assert.ok(mounted.dom.find('[role="alert"]'));
		assert.ok(mounted.dom.container.textContent.includes(bundledLightscaperEditorCopyForLocale('en').photoMetadataInvalid));
		await mounted.toggleJson(true); assert.ok(mounted.dom.find('[role="alert"]'));
		assert.ok(mounted.dom.find('[data-saved-close]')); assert.equal(mounted.commands.length, 0);
	} finally { await mounted.dispose(); }
});

test('retained Close cannot invoke a replacement generation or an unmounted host', async () => {
	const mounted = await mount();
	try {
		const close = reactProps(mounted.dom.one('[data-saved-close]')).onClick;
		await mounted.render({ generation: {} }); await act(async () => { close?.({}); });
		assert.equal(mounted.closes, 0); assert.ok(mounted.dom.find('[role="dialog"]'));
		await mounted.click('[data-saved-close]'); assert.equal(mounted.closes, 1);
	} finally { await mounted.dispose(); }
	const unmounted = await mount(), close = reactProps(unmounted.dom.one('[data-saved-close]')).onClick;
	await unmounted.dispose(); close?.({}); assert.equal(unmounted.closes, 0);
});

test('the advanced editor has a disabled labelled toggle and retained clicks cannot hide it during a held Save', async () => {
	const held = deferred<Awaited<ReturnType<Filters['apply']>>>(), mounted = await mount({}, { apply: () => held.promise });
	try {
		await mounted.change('savedFilterName', 'Busy JSON'); await mounted.toggleJson(true);
		const toggle = mounted.dom.one('[data-saved-json]'), click = reactProps(toggle).onClick;
		assert.equal(toggle.tagName, 'BUTTON'); assert.equal(reactProps(toggle)['aria-expanded'] as unknown, true);
		await mounted.click('[data-saved-save]'); assert.equal(mounted.disabled('[data-saved-json]'), true);
		await act(async () => { click?.({}); });
		assert.equal(reactProps(mounted.dom.one('[data-saved-json]'))['aria-expanded'] as unknown, true);
		assert.ok(mounted.control('savedFilterQueryJson')); assert.equal(mounted.commands.length, 1);
		await act(async () => { held.resolve({ outcome: 'failed' }); await settle(); });
		assert.equal(mounted.disabled('[data-saved-json]'), false); await mounted.toggleJson(false);
		assert.ok(mounted.control('queryText'));
	} finally { held.resolve({ outcome: 'failed' }); await mounted.dispose(); }
});

test('the name receives initial focus after a held creation snapshot rather than consuming focus while disabled', async () => {
	const held = deferred<PhotoLibrarySavedCollectionSnapshotV1 | null>();
	const mounted = await mount({}, { readSnapshot: () => held.promise });
	try {
		assert.equal(reactProps(mounted.control('savedFilterName')).disabled as unknown, true);
		// The scalar DOM fixture does not implement native selector matching for the
		// shell RAF. Qualify the real delayed focus handoff from its enabled Close.
		mounted.dom.one('[data-saved-close]').focus();
		await act(async () => { held.resolve({ collectionId: null, context, definition: null }); await settle(); });
		assert.equal(document.activeElement === mounted.control('savedFilterName') as unknown, true);
		const text = mounted.control('queryText'); text.focus();
		await mounted.change('queryText', 'Focus retained'); await mounted.render(); assert.equal(document.activeElement === text as unknown, true);
	} finally { held.resolve(null); await mounted.dispose(); }
});

function acknowledgement(type: PhotoLibrarySavedCollectionCommandV1['type'], name: string): PhotoLibrarySavedCollectionAcknowledgementV1 {
	return { outcome: type === 'create' ? 'created' : type === 'delete' ? 'deleted' : 'updated', collectionId: type === 'create' ? 'created' : 'saved',
		context: { ...context, catalogRevision: 5, indexRevision: 4, collectionStateRevision: 3, collectionCount: type === 'create' ? 2 : type === 'delete' ? 0 : 1 },
		summary: type === 'delete' ? null : { id: type === 'create' ? 'created' : 'saved', revision: type === 'create' ? 0 : 3, name }, notices: [] };
}
interface Sources {
	readonly readSnapshot?: Filters['readSnapshot'];
	readonly readPage?: (cursor: string | null) => Promise<PhotoLibrarySavedCollectionPageV1>;
	readonly apply?: Filters['apply'];
	readonly use?: Filters['use'];
}
async function mount(overrides: Partial<Props> = {}, sources: Sources = {}) {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const snapshots: (string | null)[] = [], pages: (string | null)[] = [], commands: PhotoLibrarySavedCollectionCommandV1[] = [], used: string[] = [];
	let closes = 0, cancels = 0, shownAll = 0, props: Props;
	let filters: Filters = { page: null, loaded: null, receipt: null, notice: null, error: null, busy: false,
		readPage: async (cursor = null) => {
			pages.push(cursor); const page = sources.readPage ? await sources.readPage(cursor) : { items: [snapshot.definition!, { id: 'other', revision: 1, name: 'Other' }], cursor: null };
			filters = { ...filters, page }; renderNow();
		},
		readSnapshot: async id => {
			snapshots.push(id); filters = { ...filters, loaded: null }; renderNow();
			const result = sources.readSnapshot ? await sources.readSnapshot(id) : id === null ? { collectionId: null, context, definition: null } : snapshot;
			if (result) { const definition = result.definition; filters = { ...filters, loaded: { collectionId: result.collectionId, context: result.context,
				definition: definition ? { id: definition.id, name: definition.name, revision: definition.revision } : null } }; renderNow(); }
			return result;
		},
		apply: async command => {
			commands.push(command); const result = sources.apply ? await sources.apply(command) : { outcome: 'acknowledged' as const,
				receipt: acknowledgement(command.type, command.type === 'delete' ? '' : command.name), notice: null };
			if (result.outcome === 'acknowledged') { filters = { ...filters, receipt: result.receipt, notice: result.notice,
				loaded: { collectionId: result.receipt.collectionId, context: result.receipt.context, definition: result.receipt.summary } }; renderNow(); }
			return result;
		}, use: async id => { used.push(id); await sources.use?.(id); }, showAll: async () => { shownAll++; } };
	props = { generation: {}, runtime, initialQuery: initial, initialMode: 'create', activeCollectionId: null,
		savedFilters: filters, readDefinitions: async () => ({ rootRevision: 0, rows: [], selected: null, parent: null, cursor: null }),
		copy: bundledLightscaperEditorCopyForLocale('en'), ...labels, busy: false, error: null,
		onClose: () => { closes++; }, onCancel: () => { cancels++; }, ...overrides };
	function renderNow() { root.render(<StrictMode><Dialog {...props} savedFilters={filters} /></StrictMode>); }
	const render = async (next: Partial<Props> = {}) => { props = { ...props, ...next }; await act(async () => { renderNow(); }); };
	const control = (name: string) => { const node = dom.container.querySelectorAll('input,select,textarea')
		.find(candidate => candidate.name === name || candidate.getAttribute('name') === name); assert.ok(node, `Missing ${name}`); return node; };
	try { await render(); } catch (failure) { await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; throw failure; }
	return { dom, snapshots, pages, commands, used, render, control, get filters() { return filters; }, get closes() { return closes; },
		get cancels() { return cancels; }, get shownAll() { return shownAll; }, value: (name: string) => reactProps(control(name)).value as unknown,
		disabled: (selector: string) => reactProps(dom.one(selector)).disabled as unknown,
		async change(name: string, value: string) { await act(async () => { reactProps(control(name)).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async select(id: string) { await act(async () => { reactProps(dom.one(`[data-saved-select="${id}"]`)).onChange?.({}); }); },
		async toggleJson(open: boolean) { await act(async () => {
			const toggle = reactProps(dom.one('[data-saved-json]')); if ((toggle['aria-expanded'] as unknown) !== open) toggle.onClick?.({});
		}); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
