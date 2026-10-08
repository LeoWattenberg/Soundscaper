/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { registerHooks } from 'node:module';
import type { PhotoSavedFilterRuntimeV1 } from '../src/common/editor/photo-library-saved-filter-runtime-v1.ts';
import type { PhotoLibrarySavedCollectionSnapshotV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { usePhotoSavedFilters } from '../src/common/editor/ui/lightscaper/use-photo-saved-filters.ts';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 as runtime } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';
import { reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: Surface } = await import('../src/common/editor/ui/lightscaper/PhotoSavedFiltersSurface.tsx');
hooks.deregister();
type Props = React.ComponentProps<typeof Surface>;
const context = { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 0, collectionCount: 0 };
const empty: PhotoLibrarySavedCollectionSnapshotV1 = { collectionId: null, context, definition: null };

test('pure runtime loads once under StrictMode, Close stays reachable, and no authoring reads occur while held', async () => {
	const held = deferred<PhotoSavedFilterRuntimeV1>(); let loads = 0, reads = 0, closes = 0;
	const props = defaults({ loadSavedFilterRuntime: () => { loads++; return held.promise; }, onClose: () => { closes++; },
		savedFilters: filters(async () => { reads++; return empty; }) });
	const mounted = await mountPhotoImportUi(() => <StrictMode><Surface {...props} /></StrictMode>);
	try {
		assert.equal(loads, 1); assert.equal(reads, 0); assert.ok(mounted.dom.find('[role="dialog"]'));
		await mounted.event('[data-saved-surface-close]', 'onClick'); assert.equal(closes, 1);
		await act(async () => { held.resolve(runtime); await settle(); });
		assert.equal(reads, 0); assert.equal(mounted.dom.find('[role="dialog"]'), null);
	} finally { held.resolve(runtime); await mounted.dispose(); }
});

test('ready runtime creates the actual dialog and acquires one creation snapshot without automatic photo reads', async () => {
	let loads = 0, reads = 0;
	const props = defaults({ loadSavedFilterRuntime: async () => { loads++; return runtime; },
		savedFilters: filters(async () => { reads++; return empty; }) });
	const mounted = await mountPhotoImportUi(() => <StrictMode><Surface {...props} /></StrictMode>);
	try { assert.equal(loads, 1); assert.equal(reads, 1); assert.ok(mounted.dom.find('[data-photo-saved-filters]'));
		assert.ok(mounted.dom.container.querySelectorAll('input').find(input => input.name === 'savedFilterName')); }
	finally { await mounted.dispose(); }
});

test('generation replacement fences a late runtime and captured Close before starting the current dialog', async () => {
	const old = deferred<PhotoSavedFilterRuntimeV1>(), fresh = deferred<PhotoSavedFilterRuntimeV1>();
	let oldReads = 0, newReads = 0, closes = 0;
	let props = defaults({ loadSavedFilterRuntime: () => old.promise, onClose: () => { closes++; },
		savedFilters: filters(async () => { oldReads++; return empty; }) });
	const mounted = await mountPhotoImportUi(() => <Surface {...props} />);
	try {
		const staleClose = reactProps(mounted.dom.one('[data-saved-surface-close]')).onClick;
		props = { ...props, generation: {}, loadSavedFilterRuntime: () => fresh.promise,
			savedFilters: filters(async () => { newReads++; return empty; }) };
		await mounted.render();
		await act(async () => { old.resolve(runtime); staleClose?.({}); await settle(); });
		assert.equal(oldReads, 0); assert.equal(newReads, 0); assert.equal(closes, 0);
		await act(async () => { fresh.resolve(runtime); await settle(); });
		assert.equal(oldReads, 0); assert.equal(newReads, 1); assert.ok(mounted.dom.find('[data-photo-saved-filters]'));
	} finally { old.resolve(runtime); fresh.resolve(runtime); await mounted.dispose(); }
});

test('loader rejection presents a closeable bounded error and never invokes saved operations', async () => {
	let reads = 0, closes = 0, inspected = 0;
	const error = new Proxy({}, { getOwnPropertyDescriptor() { inspected++; throw new Error('Opaque loader failure'); } });
	const props = defaults({ loadSavedFilterRuntime: async () => { throw error; }, onClose: () => { closes++; },
		savedFilters: filters(async () => { reads++; return empty; }) });
	const mounted = await mountPhotoImportUi(() => <Surface {...props} />);
	try {
		assert.equal(reads, 0); assert.ok(mounted.dom.find('[role="alert"]')); assert.ok(mounted.dom.find('[role="dialog"]'));
		assert.equal(inspected, 0); await mounted.event('[data-saved-surface-close]', 'onClick'); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('unmount retires a held pure loader and suppresses all late dialog reads', async () => {
	const held = deferred<PhotoSavedFilterRuntimeV1>(); let reads = 0;
	const props = defaults({ loadSavedFilterRuntime: () => held.promise, savedFilters: filters(async () => { reads++; return empty; }) });
	const mounted = await mountPhotoImportUi(() => <Surface {...props} />);
	await mounted.dispose(); held.resolve(runtime); await settle(); assert.equal(reads, 0);
});

function filters(readSnapshot: ReturnType<typeof usePhotoSavedFilters>['readSnapshot']): ReturnType<typeof usePhotoSavedFilters> {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected saved operation'); };
	return { page: null, loaded: null, receipt: null, notice: null, error: null, busy: false,
		readSnapshot, readPage: unexpected, apply: unexpected, use: unexpected, showAll: unexpected };
}
function defaults(overrides: Partial<Props> = {}): Props {
	return { generation: {}, loadSavedFilterRuntime: async () => runtime, initialMode: 'create', activeCollectionId: null,
		initialQuery: { text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } }, savedFilters: filters(async () => empty),
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		copy: bundledLightscaperEditorCopyForLocale('en'), flags: { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' },
		colorLabels: { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' },
		busy: false, error: null, onCancel: () => undefined, onClose: () => undefined, ...overrides };
}
