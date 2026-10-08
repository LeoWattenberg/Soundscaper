/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import type { PhotoLibrarySavedCollectionCommandV1, PhotoLibrarySavedCollectionDefinitionV1,
	PhotoLibrarySavedCollectionPortV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { PhotoLibrarySavedCollectionSnapshotV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import { mountSurveyApp, surveyAppOwner } from './helpers/lightscaper-survey-app-fixture.tsx';

for (const locale of ['en', 'de']) test(`actual ${locale} saved-filter entry points belong to View and do not eagerly load resources or controls`, async () => {
	let opens = 0, runtimeLoads = 0;
	const copy = bundledLightscaperEditorCopyForLocale(locale);
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return <LightscaperApp locale={locale} createSession={async () => { opens++; return createImportTestPort(); }}
			loadSavedFilterRuntime={async () => { runtimeLoads++; return PHOTO_SAVED_FILTER_RUNTIME_V1; }} />;
	});
	try {
		const save = mounted.dom.one('[data-photo-save-filter-menu]'), manage = mounted.dom.one('[data-photo-saved-filters-menu]');
		assert.equal(save.textContent, copy.photoSaveCurrentFilter); assert.equal(manage.textContent, copy.photoSavedFiltersTitle);
		assert.equal(save.closest('details')?.querySelector('summary')?.textContent, copy.photoViewMenu);
		assert.equal(manage.closest('details')?.querySelector('summary')?.textContent, copy.photoViewMenu);
		assert.equal(opens, 0); assert.equal(runtimeLoads, 0); assert.equal(mounted.dom.find('[data-photo-saved-filters]'), null);
		assert.equal(mounted.dom.find('[data-photo-library]'), null);
	} finally { await mounted.dispose(); }
});

for (const first of ['query', 'compare'] as const) test(`retained ${first} and opposite filter/review handlers admit only one dialog in a native gesture`, async () => {
	const owner = surveyAppOwner(), runtime = async () => PHOTO_SAVED_FILTER_RUNTIME_V1;
	owner.port.readQueryStepV2 = async () => ({ ...await owner.port.readPage(), scanned: 0 });
	const mounted = await mountSurveyApp(owner.factory, 'en', { loadMetadataQueryRuntime: runtime, loadSavedFilterRuntime: runtime });
	try {
		await mounted.menu(mounted.copy.photoShowLibrary); await mounted.photo('a'); await mounted.photo('b', true);
		const query = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === mounted.copy.photoQueryTitle);
		assert.ok(query); const compare = mounted.dom.one('[data-photo-compare-menu]');
		const start = first === 'query' ? query : compare, other = first === 'query' ? compare : query;
		const choose = reactProps(start).onClick, opposite = reactProps(other).onClick;
		await mounted.flush(() => { choose?.({ currentTarget: start }); opposite?.({ currentTarget: other }); });
		assert.equal(mounted.dom.find('[data-photo-compare-dialog]') !== null, first === 'compare');
		const text = mounted.dom.container.querySelectorAll('input').some(input => input.name === 'queryText');
		assert.equal(text, first === 'query');
	} finally { await mounted.dispose(); }
});

test('replacing the pure codec loader retires old menu/context demands, joins cancellation and keeps the same Session', async () => {
	const held = deferred<PhotoLibrarySavedCollectionSnapshotV1>(), base = createImportTestPort();
	let reads = 0, closes = 0, signal: AbortSignal | undefined;
	const snapshot: PhotoLibrarySavedCollectionSnapshotV1 = { collectionId: null, definition: null,
		context: { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 } };
	const unexpected = async (): Promise<never> => { throw new Error('No authoring or query expected.'); };
	const savedCollections: PhotoLibrarySavedCollectionPortV1 = { apply: unexpected, readQueryStep: unexpected,
		readPage: async () => ({ items: [], cursor: null }), readSnapshot: request => {
			reads++; signal = request.signal; return reads === 1 ? held.promise : Promise.resolve(snapshot);
		} };
	base.close = async () => { closes++; };
	const factory = async () => ({ ...base, savedCollections }); let loader = async () => PHOTO_SAVED_FILTER_RUNTIME_V1;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale="en" createSession={factory} loadSavedFilterRuntime={loader} />;
	});
	const click = async (selector: string) => { await act(async () => { const target = mounted.dom.one(selector);
		reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
	try {
		const menu = mounted.dom.one('[data-photo-save-filter-menu]'), stale = reactProps(menu).onClick;
		await click('[data-photo-save-filter-menu]'); assert.equal(reads, 1); assert.equal(signal?.aborted, false);
		loader = async () => PHOTO_SAVED_FILTER_RUNTIME_V1; await mounted.render();
		assert.equal(signal?.aborted, true); assert.equal(mounted.dom.find('[data-photo-saved-filters]'), null);
		await act(async () => { stale?.({ currentTarget: menu }); }); assert.equal(mounted.dom.find('[data-photo-saved-filters]'), null);
		assert.equal(reads, 1); assert.equal(closes, 0);
		await act(async () => { held.resolve(snapshot); await settle(); });
		await click('[data-photo-save-filter-menu]'); assert.equal(reads, 2); assert.ok(mounted.dom.find('[data-photo-saved-filters]'));
		assert.equal(closes, 0);
	} finally { held.resolve(snapshot); await mounted.dispose(); }
});

for (const locale of ['en', 'de']) test(`actual ${locale} menu saves full criteria, explicitly uses them and copies the active recipe into a new definition`, async () => {
	const base = createImportTestPort(), definitions = new Map<string, PhotoLibrarySavedCollectionDefinitionV1>();
	const commands: PhotoLibrarySavedCollectionCommandV1[] = [], snapshots: (string | null)[] = [], reads: string[] = [];
	let revision = 0;
	const context = () => ({ catalogId: 'catalog', catalogRevision: revision, indexRevision: revision,
		collectionStateRevision: revision, collectionCount: definitions.size });
	const row = { id: 'photo', fileName: 'Photo.png', width: 2, height: 3, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const };
	base.readPage = async () => ({ catalogName: 'Library', totalCount: 2, rows: [row], cursor: null });
	const savedCollections: PhotoLibrarySavedCollectionPortV1 = {
		readPage: async () => ({ items: [...definitions.values()].map(({ id, name, revision: current }) => ({ id, name, revision: current })), cursor: null }),
		readSnapshot: async ({ collectionId }) => { snapshots.push(collectionId); return { collectionId, context: context(), definition: collectionId === null ? null : definitions.get(collectionId) ?? null }; },
		apply: async command => {
			commands.push(command); assert.equal(command.context.catalogRevision, revision);
			const id = command.type === 'create' ? `saved-${String(definitions.size)}` : command.collectionId;
			if (command.type === 'delete') definitions.delete(id);
			else definitions.set(id, { id, revision: command.type === 'create' ? 0 : command.expectedDefinitionRevision + 1, name: command.name, queryJson: command.queryJson });
			revision++; const definition = definitions.get(id);
			return { outcome: command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'deleted', collectionId: id,
				context: context(), summary: definition ? { id, name: definition.name, revision: definition.revision } : null, notices: [] };
		},
		readQueryStep: async request => { reads.push(request.collectionId); return { catalogName: 'Library', totalCount: 2, rows: [row], cursor: null,
			scanned: 2, collectionId: request.collectionId, collectionName: definitions.get(request.collectionId)!.name, mode: request.mode,
			context: context(), definitionRevision: definitions.get(request.collectionId)!.revision, definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: null }; },
	};
	const factory = async () => ({ ...base, savedCollections }), runtime = async () => PHOTO_SAVED_FILTER_RUNTIME_V1;
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale={locale} createSession={factory} loadSavedFilterRuntime={runtime} />;
	});
	const click = async (selector: string) => { await act(async () => { const target = mounted.dom.one(selector);
		reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
	const change = async (name: string, value: string) => { await act(async () => {
		const target = mounted.dom.container.querySelectorAll('input,textarea').find(candidate => candidate.name === name || candidate.getAttribute('name') === name);
		assert.ok(target, `Missing ${name}`); reactProps(target).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const queryJson = PHOTO_SAVED_FILTER_RUNTIME_V1.writeQueryJson({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'Photo',
		filter: { kind: 'rating', value: 3 }, sort: { field: 'capture-time', direction: 'descending' },
		predicate: { kind: 'all', terms: [{ kind: 'text', column: 'title', operator: 'contains', value: 'TREE' },
			{ kind: 'number', column: 'iso', minimum: 100, maximum: 800 }] } });
	try {
		await click('[data-photo-save-filter-menu]');
		assert.ok(mounted.dom.find('[data-photo-saved-filters]')); assert.deepEqual(snapshots, [null]);
		await change('savedFilterName', 'Trees');
		await click('[data-saved-json]');
		await change('savedFilterQueryJson', queryJson); await click('[data-saved-save]');
		assert.equal(commands[0]?.type, 'create'); assert.equal(definitions.get('saved-0')?.queryJson, queryJson);
		assert.equal(reads.length, 0); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		await click('[data-saved-use]'); assert.deepEqual(reads, ['saved-0']); assert.ok(mounted.dom.find('[data-photo-library]'));
		await click('[data-saved-close]'); await click('[data-photo-save-filter-menu]');
		assert.deepEqual(snapshots, [null, 'saved-0', null]);
		await change('savedFilterName', 'Trees copy'); await click('[data-saved-save]');
		assert.equal(definitions.get('saved-1')?.queryJson, queryJson); assert.deepEqual(reads, ['saved-0', 'saved-0']);
		await click('[data-saved-close]'); await click('[data-photo-saved-filters-menu]'); await click('[data-saved-load]');
		assert.equal(mounted.dom.one('[data-saved-delete]').hasAttribute('disabled'), true);
		await click('[data-saved-all]'); assert.equal(mounted.dom.one('[data-saved-delete]').hasAttribute('disabled'), false);
		await click('[data-saved-delete]'); assert.equal(definitions.has('saved-0'), false); assert.equal(definitions.size, 1);
		assert.equal(commands.length, 3);
	} finally { await mounted.dispose(); }
});
