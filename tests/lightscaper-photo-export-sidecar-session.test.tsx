/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import { currentDevelopFixture, currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const f = await currentDevelopFixture(1), previous = f.photos[0]!;
	let photo = normalizePhotoDocumentV2({ ...previous, schemaVersion: 2, metadata: { ...previous.metadata, title: 'Authored' },
		versions: [{ ...previous.versions[0]!, develop: currentRecipe() }] });
	photo = normalizePhotoDocumentV2(await f.repository.savePhoto(photo, previous.revision));
	const ports: PhotoLibrarySessionPortsV2 = { catalog: f.repository, journal: f.settings, settings: f.settings,
		exclusive: async (_id, run, signal) => run(signal),
		initialize: async () => { const root = await f.repository.loadCatalog('catalog-1'); assert.ok(root); return root; }, closeResources: () => f.close(),
		media: { writeAsset: async () => assert.fail('No body write'), custody: { findDigestPage: async () => ({ matches: [], afterAssetId: null }),
			stage: async () => undefined, promote: async () => undefined, releaseStaged: async () => undefined,
			readPage: async () => ({ roots: [], afterKey: null }) } } };
	return { ...f, photo, ports, binding: { catalogId: photo.catalogId, photoId: photo.id, versionId: photo.activeVersionId, expectedRevision: photo.revision } };
}

test('actual Session projects complete original/recipe/authored facts without changing any stored Photo', async () => {
	const f = await fixture(), session = new PhotoLibrarySessionV2(f.ports);
	try { const before = await f.repository.loadPhoto(f.photo.catalogId, f.photo.id);
		assert.equal(await session.readExportSidecar(f.binding), serializePhotoExportSidecarV1(createPhotoExportSidecarV1(before, f.binding)));
		assert.deepEqual(await f.repository.loadPhoto(f.photo.catalogId, f.photo.id), before);
	} finally { await session.close(); }
});

test('closed request capture refuses invalid identity before selected initialization and pins caller mutations', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), initialize = f.ports.initialize; let initialized = 0;
	const session = new PhotoLibrarySessionV2({ ...f.ports, initialize: async signal => { initialized++; entered.resolve(); await release.promise; return initialize(signal); } });
	try { await assert.rejects(session.readExportSidecar({ ...f.binding, versionId: '' }), /ID|identifier/iu); assert.equal(initialized, 0);
		const binding = { ...f.binding }, work = session.readExportSidecar(binding); binding.versionId = 'mutated'; await entered.promise;
		release.resolve(); assert.equal(await work, serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photo, f.binding)));
		for (const delta of [{ catalogId: 'other' }, { expectedRevision: f.photo.revision + 1 }, { photoId: 'missing' }, { versionId: 'missing' }]) {
			await assert.rejects(session.readExportSidecar({ ...f.binding, ...delta }));
		}
	} finally { release.resolve(); await session.close(); }
});

test('actual Session Close joins held complete-document load and refuses its late result', async context => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), nativeLoad = f.repository.loadPhoto; let closed = false;
	context.mock.method(f.repository, 'loadPhoto', async function (this: typeof f.repository, ...args: Parameters<typeof nativeLoad>) {
		entered.resolve(); await release.promise; return Reflect.apply(nativeLoad, this, args);
	});
	const session = new PhotoLibrarySessionV2({ ...f.ports, closeResources: async () => { closed = true; await f.close(); } });
	const work = session.readExportSidecar(f.binding), rejected = assert.rejects(work, { name: 'AbortError' });
	try { await entered.promise; const closing = session.close(); assert.equal(await remainsPending(closing), true); assert.equal(closed, false);
		release.resolve(); await rejected; await closing; assert.equal(closed, true);
	} finally { release.resolve(); await session.close(); }
});

test('gesture-captured workflow reader refuses same-catalog replacement before acquiring the new Session', async () => {
	const f = await fixture(), first = new PhotoLibrarySessionV2(f.ports), second = await fixture(); let opens = 0;
	let factory = async () => first, workflow: ReturnType<typeof usePhotoLibraryWorkflowV2> | null = null;
	function Harness() { workflow = usePhotoLibraryWorkflowV2(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	const current = () => { assert.ok(workflow); return workflow; };
	try { const read = current().captureExportSidecarReader();
		assert.equal(await read(f.binding, { signal: new AbortController().signal }), serializePhotoExportSidecarV1(createPhotoExportSidecarV1(f.photo, f.binding)));
		factory = async () => { opens++; return new PhotoLibrarySessionV2(second.ports); }; await mounted.render();
		await assert.rejects(read(f.binding, { signal: new AbortController().signal }), { name: 'AbortError' }); assert.equal(opens, 0);
	} finally { await mounted.dispose(); await second.close(); }
});

test('captured complete-facts reader retains its real Session method and receiver across later checks', async () => {
	const f = await fixture(), session = new PhotoLibrarySessionV2(f.ports); let workflow: ReturnType<typeof usePhotoLibraryWorkflowV2> | null = null;
	const factory = async () => session;
	function Harness() { workflow = usePhotoLibraryWorkflowV2(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try { assert.ok(workflow); const read = (workflow as ReturnType<typeof usePhotoLibraryWorkflowV2>).captureExportSidecarReader();
		const initial = await read(f.binding, { signal: new AbortController().signal });
		Object.defineProperty(session, 'readExportSidecar', { configurable: true, get() { assert.fail('Replaced Session capability reflected'); } });
		assert.equal(await read(f.binding, { signal: new AbortController().signal }), initial);
	} finally { await mounted.dispose(); }
});
