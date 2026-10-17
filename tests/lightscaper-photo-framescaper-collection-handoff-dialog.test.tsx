/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoFramescaperCollectionHandoffDialog, { type PhotoFramescaperCollectionHandoffDialogProps } from '../src/common/editor/ui/lightscaper/PhotoFramescaperCollectionHandoffDialog.tsx';
import type { CapturedPhotoCollectionHandoff } from '../src/common/editor/ui/lightscaper/photo-library-workflow-collection-handoff.ts';
import type { PhotoFramescaperCollectionHandoffTarget } from '../src/lightscaper/controller/photo-framescaper-handoff-download.ts';
import type { PhotoLibraryDefinitionPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibrarySavedCollectionPageV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { PreparedBrowserSave } from '../src/common/editor/browser-file-save-service.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { photoFramescaperCollectionHandoffCopy } from '../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperCollectionHandoffMenuLabel } from '../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const blob = new Blob([Uint8Array.of(1, 2, 3)]);
const archive = () => Object.freeze({ blob, fileName: 'Chosen collection.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: 2 });
const catalogPage = (): PhotoLibraryDefinitionPageV1 => ({ rootRevision: 3, parent: null, selected: null, cursor: 'catalog-next', rows: [
	{ kind: 'collection', id: 'manual', name: 'Manual collection', collectionKind: 'manual' },
	{ kind: 'collection', id: 'smart', name: 'Smart collection', collectionKind: 'smart' },
] });
const savedPage = (): PhotoLibrarySavedCollectionPageV1 => ({ items: [{ id: 'saved', name: 'Saved Query2', revision: 4 }], cursor: 'saved-next' });
function target(scope: 'catalog' | 'saved-query', collectionId: string): PhotoFramescaperCollectionHandoffTarget {
	return { binding: { catalogId: 'catalog', collectionId, scope, expectedCatalogRevision: 3,
		...(scope === 'saved-query' ? { expectedDefinitionRevision: 4 } : {}) },
		capture: { withCapture: async () => assert.fail('Dialog lifecycle controls use the injected archive seam, never body authority.') },
		checkCurrent: async () => undefined };
}
function capture(): CapturedPhotoCollectionHandoff {
	return { readCatalogPage: async () => catalogPage(), readSavedPage: async () => savedPage(),
		prepare: async selection => ({ fileName: 'Chosen collection.fscape', target: target(selection.scope, selection.collectionId) }) };
}
async function mount(value = capture(), locale = 'en') {
	const destinations = new PhotoExportDestinations(), events: string[] = []; let current = true;
	let props: PhotoFramescaperCollectionHandoffDialogProps = { locale, capture: value, isCurrent: () => current,
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave: () => ({ mode: 'cancelled', cancelled: true, fileName: 'Chosen collection.fscape' }),
			saveFile: async () => assert.fail('No file delivery expected') }, buildArchive: async () => archive(),
		registerDestination: cancel => destinations.register(cancel), onClose: () => { events.push('closed'); } };
	const mounted = await mountPhotoImportUi(() => <PhotoFramescaperCollectionHandoffDialog {...props} />);
	const flush = async (action: () => void = () => undefined) => { await act(async () => { action(); await settle(); }); };
	const event = async (selector: string, handler: string, value: unknown = {}) => { await flush(() => { reactProps(mounted.dom.one(selector))[handler]?.(value); }); };
	const chooseScope = async (scope: string) => { await event('[data-photo-collection-handoff-scope]', 'onChange', { currentTarget: { value: scope } }); };
	const ready = async () => { await waitFor(async () => { await flush(); return mounted.dom.one('[data-photo-collection-handoff-download]').disabled === false; }, 'explicit collection download readiness'); };
	return { ...mounted, destinations, events, flush, event, chooseScope, ready, copy: photoFramescaperCollectionHandoffCopy(locale),
		stale() { current = false; }, async replace(next: Partial<PhotoFramescaperCollectionHandoffDialogProps>) { props = { ...props, ...next }; await mounted.render(); } };
}

test('Light collection dialog requires explicit scope and collection in English and German, with honest kind labels', async () => {
	for (const locale of ['en', 'de']) {
		const value = capture(), reads: string[] = [], prepared: unknown[] = [];
		value.readCatalogPage = async request => { reads.push(request?.cursor ?? 'root'); return catalogPage(); };
		value.readSavedPage = async () => { reads.push('saved'); return savedPage(); };
		value.prepare = async selection => { prepared.push(selection); return { fileName: 'Chosen collection.fscape', target: target(selection.scope, selection.collectionId) }; };
		const f = await mount(value, locale);
		try {
			assert.equal(photoFramescaperCollectionHandoffMenuLabel(locale), locale === 'de' ? 'Sammlung als Framescaper-Sequenz herunterladen…' : 'Download collection as Framescaper sequence…');
			assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-scope]')).value, ''); assert.equal(reads.length, 0);
			assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-download]')).disabled, true);
			await f.chooseScope('catalog'); await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'paged catalog collections');
			assert.deepEqual(prepared, []); assert.ok(f.dom.one('[data-definition-choose="manual"]').textContent.includes(f.copy.manual));
			assert.ok(f.dom.one('[data-definition-choose="smart"]').textContent.includes(f.copy.smart));
			await f.event('[data-definition-choose="smart"]', 'onClick'); await f.ready();
			assert.deepEqual(prepared, [{ scope: 'catalog', collectionId: 'smart' }]);
			await f.event('[data-definition-next]', 'onClick'); await waitFor(() => reads.includes('catalog-next'), 'native definition cursor');
		} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
	}
});

test('Light collection dialog pages saved Query2 summaries without auto-selection or recipe projection', async () => {
	const value = capture(), cursors: (string | null)[] = [], prepared: unknown[] = [];
	value.readSavedPage = async request => { cursors.push(request?.cursor ?? null); return savedPage(); };
	value.prepare = async selection => { prepared.push(selection); return { fileName: 'Chosen collection.fscape', target: target(selection.scope, selection.collectionId) }; };
	const f = await mount(value);
	try {
		await f.chooseScope('saved-query'); await waitFor(() => f.dom.container.querySelector('[data-photo-collection-handoff-saved]') !== null, 'saved scalar chooser');
		assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-saved]')).value, ''); assert.deepEqual(prepared, []);
		await f.event('[data-photo-collection-handoff-saved]', 'onChange', { currentTarget: { value: 'saved' } }); await f.ready();
		assert.deepEqual(prepared, [{ scope: 'saved-query', collectionId: 'saved' }]);
		await f.event('[data-photo-collection-handoff-next]', 'onClick');
		await waitFor(() => cursors.length === 2, 'saved continuation page'); assert.deepEqual(cursors, [null, 'saved-next']);
		assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-saved]')).value, '');
		assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-download]')).disabled, true);
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light collection Close joins a held catalog reader and preserves its opaque refusal for retirement', async () => {
	const value = capture(), entered = deferred<void>(), release = deferred<PhotoLibraryDefinitionPageV1>(); let reflections = 0;
	const primary = new Proxy({}, { getOwnPropertyDescriptor() { reflections++; throw new Error('Opaque reader refusal cannot be inspected.'); } });
	value.readCatalogPage = async () => { entered.resolve(); return release.promise; };
	const f = await mount(value);
	try {
		await f.chooseScope('catalog'); await entered.promise; await f.event('[data-photo-collection-handoff-close]', 'onClick');
		const retiring = f.destinations.retireAndJoin(), refusal = assert.rejects(retiring, reason => reason === primary);
		assert.equal(await remainsPending(retiring), true); assert.deepEqual(f.events, []); await f.flush(() => { release.reject(primary); }); await refusal;
		await f.flush(); assert.deepEqual(f.events, []); assert.ok(f.dom.container.querySelector('[role="alert"]')); assert.equal(reflections, 0);
	} finally { release.reject(primary); await f.dispose(); await f.destinations.retireAndJoin().catch(() => undefined); }
});

test('Light collection capture replacement drains the old reader before new reads and prevents old publication', async () => {
	const old = capture(), next = capture(), entered = deferred<void>(), release = deferred<PhotoLibraryDefinitionPageV1>(); let newer = 0;
	old.readCatalogPage = async () => { entered.resolve(); return release.promise; };
	next.readCatalogPage = async () => { newer++; return catalogPage(); };
	const f = await mount(old);
	try {
		await f.chooseScope('catalog'); await entered.promise; await f.replace({ capture: next }); await f.chooseScope('catalog');
		await f.flush(); assert.equal(newer, 0); await f.flush(() => { release.resolve(catalogPage()); });
		await waitFor(async () => { await f.flush(); return newer === 1; }, 'replacement reader after old drain');
		assert.equal(reactProps(f.dom.one('[data-photo-collection-handoff-download]')).disabled, true);
	} finally { release.resolve(catalogPage()); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light collection Close joins held selected preparation without publishing a stale target', async () => {
	const value = capture(), entered = deferred<void>(), release = deferred<Awaited<ReturnType<CapturedPhotoCollectionHandoff['prepare']>>>(); let signal: AbortSignal | undefined;
	value.prepare = async (_selection, stop) => { signal = stop; entered.resolve(); return release.promise; };
	const f = await mount(value);
	try {
		await f.chooseScope('catalog'); await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'definition page');
		await f.event('[data-definition-choose="manual"]', 'onClick'); await entered.promise; await f.event('[data-photo-collection-handoff-close]', 'onClick');
		assert.equal(signal?.aborted, true); assert.deepEqual(f.events, []); assert.equal(await remainsPending(f.destinations.retireAndJoin()), true);
		await f.flush(() => { release.resolve({ fileName: 'Chosen collection.fscape', target: target('catalog', 'manual') }); });
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined selected prepare');
	} finally { release.resolve({ fileName: 'Chosen collection.fscape', target: target('catalog', 'manual') }); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light collection Download pins native receiver in the gesture and Close joins actual picker dismissal', async () => {
	const f = await mount(), picker = deferred<PreparedBrowserSave>(); let pickers = 0, signal: AbortSignal | undefined;
	const runtime = { maximumStreamingBytes: 536870912,
		prepareSave(request: Parameters<NonNullable<PhotoFramescaperCollectionHandoffDialogProps['saveRuntime']>['prepareSave']>[0]) { assert.equal(this, runtime); pickers++; signal = request.signal; return picker.promise; },
		saveFile: async () => assert.fail('Dismissed picker cannot deliver') };
	try {
		await f.replace({ saveRuntime: runtime }); await f.chooseScope('catalog');
		await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'definition page');
		await f.event('[data-definition-choose="manual"]', 'onClick'); await f.ready();
		await f.flush(() => { reactProps(f.dom.one('[data-photo-collection-handoff-download]')).onClick?.({}); assert.equal(pickers, 1); });
		runtime.prepareSave = () => assert.fail('Later native substitution must stay cold');
		await f.event('[data-photo-collection-handoff-close]', 'onClick'); assert.equal(signal?.aborted, true); assert.deepEqual(f.events, []);
		await f.flush(() => { picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Chosen collection.fscape' }); });
		await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined picker dismissal');
	} finally { picker.resolve({ mode: 'cancelled', cancelled: true, fileName: 'Chosen collection.fscape' }); await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light collection stale generation refuses native authority and picker cancellation leaves archive cold', async () => {
	for (const stale of [true, false]) {
		const f = await mount(); let pickers = 0, archives = 0;
		try {
			await f.replace({ saveRuntime: { maximumStreamingBytes: 536870912,
				prepareSave: () => { pickers++; return { mode: 'cancelled', cancelled: true, fileName: 'Chosen collection.fscape' }; }, saveFile: async () => assert.fail('No delivery') },
				buildArchive: async () => { archives++; return archive(); } });
			await f.chooseScope('catalog'); await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'definition page');
			await f.event('[data-definition-choose="manual"]', 'onClick'); await f.ready(); if (stale) f.stale();
			await f.event('[data-photo-collection-handoff-download]', 'onClick'); assert.equal(pickers, stale ? 0 : 1); assert.equal(archives, 0);
			if (!stale) assert.equal(f.dom.one('[data-photo-collection-handoff-receipt]').textContent, f.copy.cancelled);
		} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
	}
});

test('Light collection browser delivery displays its actual download-started receipt without an import claim', async () => {
	const f = await mount();
	try {
		await f.replace({ saveRuntime: { maximumStreamingBytes: 536870912,
			prepareSave: () => ({ mode: 'blob', fileName: 'User collection.fscape', target: { browserDownload: true } }),
			saveFile: async request => { assert.equal(request.blob, blob); return { method: 'download', fileName: 'User collection.fscape', size: 3 }; } } });
		await f.chooseScope('catalog'); await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'definition page');
		await f.event('[data-definition-choose="manual"]', 'onClick'); await f.ready(); await f.event('[data-photo-collection-handoff-download]', 'onClick');
		await waitFor(() => f.dom.container.querySelector('[data-photo-collection-handoff-receipt]') !== null, 'actual download receipt');
		assert.equal(f.dom.one('[data-photo-collection-handoff-receipt]').textContent, f.copy.downloadStarted.replace('{name}', 'User collection.fscape'));
	} finally { await f.dispose(); await f.destinations.retireAndJoin(); }
});

test('Light collection Close and unmount join held native commit without cancelling its acknowledged save', async () => {
	for (const unmount of [false, true]) {
		const f = await mount(), entered = deferred<void>(), release = deferred<void>(); let aborts = 0;
		try {
			await f.replace({ saveRuntime: { maximumStreamingBytes: 536870912, prepareSave: request => createFileSystemPreparedSave({ fileName: 'User sequence.fscape', signal: request.signal,
				target: { name: 'User sequence.fscape', createWritable: async () => ({ write(bytes: Uint8Array) { assert.deepEqual([...bytes], [1, 2, 3]); },
					async close() { entered.resolve(); await release.promise; }, abort() { aborts++; } }) } }), saveFile: async () => assert.fail('Actual direct destination owns delivery') } });
			await f.chooseScope('catalog'); await waitFor(() => f.dom.container.querySelector('[data-definition-choose="manual"]') !== null, 'definition page');
			await f.event('[data-definition-choose="manual"]', 'onClick'); await f.ready(); await f.event('[data-photo-collection-handoff-download]', 'onClick'); await entered.promise;
			if (unmount) await f.dispose(); else await f.event('[data-photo-collection-handoff-close]', 'onClick');
			const retiring = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retiring), true); assert.equal(aborts, 0); assert.deepEqual(f.events, []);
			await f.flush(() => { release.resolve(); }); await retiring; if (!unmount) await waitFor(async () => { await f.flush(); return f.events.includes('closed'); }, 'joined committed dialog close');
			assert.equal(aborts, 0);
		} finally { release.resolve(); if (!unmount) await f.dispose(); await f.destinations.retireAndJoin(); }
	}
});
