/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });

for (const locale of ['en', 'de']) test(`${locale} mounted workspace writes real Session history, immutable snapshots and independent virtual copies`, async () => {
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: `workspace-${locale}`, verifyOriginal: async () => undefined });
	await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const before = (await catalog.loadPhoto('catalog', queryPhotoV1().id))!;
	const unexpected = async (): Promise<never> => { throw new Error('No original or import mutation is admitted by Develop.'); };
	const ports: PhotoLibrarySessionPortsV1 = { catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
		closeResources: async () => undefined, exclusive: async (_id, operation, signal) => operation(signal),
		journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
			releaseStaged: unexpected, readPage: unexpected } } };
	const session = new PhotoLibrarySessionV1(ports), messages = photoDevelopCopy(locale);
	const render = () => <StrictMode><PhotoDevelopWorkspace locale={locale} photoId={before.id} label={before.metadata.fileName} generation={session}
		execute={async (run, signal) => { await run({ signal: signal!, isCurrent: () => true, acquire: async () => session.develop,
			refresh: async () => undefined }); }} readPreview={async () => ({ outcome: 'missing' })}
		loadProxy={unexpected} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} /></StrictMode>;
	const mounted = await mountPhotoImportUi(render);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const input = (label: string, kind: 'input' | 'select' = 'input') => { const found = mounted.dom.container.querySelectorAll(kind).find(value => value.parentNode?.textContent.startsWith(label)); assert.ok(found, label); return found; };
	const change = async (target: ReactTestElement, value: string) => { await act(async () => { reactProps(target).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
	try {
		await act(async () => { await settle(); }); await click(button(messages.add));
		const temperature = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamTemperature}`);
		assert.ok(temperature);
		await act(async () => { reactProps(temperature).onFocus?.({}); reactProps(temperature).onChange?.({ currentTarget: { value: '0.25', valueAsNumber: 0.25 } });
			reactProps(temperature).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		await click(button(messages.save));
		await change(input(messages.snapshotName), 'Warm'); await click(button(messages.saveSnapshot));
		await change(input(messages.history, 'select'), '0');
		assert.equal((await session.develop.read({ schemaVersion: 1, photoId: before.id })).develop.effects.length, 0);
		const restore = mounted.dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === `${messages.restoreSnapshot}: Warm`); assert.ok(restore);
		await click(restore);
		await change(input(messages.copyName), 'Alternative'); await click(button(messages.createCopy));
		let current = await session.develop.read({ schemaVersion: 1, photoId: before.id });
		assert.equal(current.versionId, current.activeVersionId); assert.notEqual(current.versionId, 'master');
		assert.equal(current.history.entries.length, 1); assert.equal(current.snapshots.length, 0);
		await change(input(messages.version, 'select'), 'master'); await click(button(messages.useVersion));
		current = await session.develop.read({ schemaVersion: 1, photoId: before.id });
		assert.equal(current.versionId, 'master'); assert.equal(current.history.entries.length, 2); assert.equal(current.history.cursor, 1);
		assert.equal(current.develop.effects[0]?.params.temperature, 0.25); assert.equal(current.snapshots[0]?.name, 'Warm');
		const after = (await catalog.loadPhoto('catalog', before.id))!;
		assert.deepEqual(after.original, before.original); assert.deepEqual(after.extractedMetadata, before.extractedMetadata); assert.deepEqual(after.metadata, before.metadata);
		assert.equal(after.versions[0]?.workspace?.snapshots[0]?.develop.effects[0]?.params.temperature, 0.25);
		const deleted = mounted.dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === `${messages.deleteSnapshot}: Warm`); assert.ok(deleted);
		await click(deleted); assert.equal((await session.develop.read({ schemaVersion: 1, photoId: before.id })).snapshots.length, 0);
	} finally { await mounted.dispose(); await session.close(); await catalog.close(); }
});
