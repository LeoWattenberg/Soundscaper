/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { NIGHTLY_IMAGE_TEST_HELPER_INPUTS } from '../scripts/lib/desktop-nightly-image-test-payloads.mjs';
import { staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';
import React, { act, StrictMode } from 'react';
import LightscaperBootstrap from '../src/lightscaper/ui/LightscaperBootstrap.tsx';
import type { LightscaperAppPropsV2 } from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { currentAppLocks, readResidentPhotoLibraryCurrent, seedCurrentAppPhoto, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { settle } from './helpers/async-test-control.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createPhotoLibraryBackupSaveRuntimeV1 } from '../src/lightscaper/photo-library-backup-save-runtime.ts';
import { PHOTO_METADATA_QUERY_RUNTIME_V2 } from '../src/lightscaper/photo-metadata-query-ui-runtime.ts';
import { PHOTO_SAVED_FILTER_RUNTIME_V1 } from '../src/lightscaper/photo-saved-filter-ui-runtime-v1.ts';

test('actual Bootstrap lazily composes current Session3, Restore2 and a selected-source-bound renderer2', () => {
	const source = readFileSync(new URL('../src/lightscaper/ui/LightscaperBootstrap.tsx', import.meta.url), 'utf8');
	const code = transformSync(source, { loader: 'tsx', format: 'esm' }).code;
	for (const module of ['photo-library-session-runtime-v3', 'photo-library-restore-runtime-v2', 'photo-develop-render-runtime-v2']) {
		assert.match(code, new RegExp(`import\\(["']\\.\\./${module}\\.ts["']\\)`));
		assert.ok(!staticRelativeDependencies(code).includes(`../${module}.ts`));
	}
	assert.match(source, /createPhotoLibrarySessionV3/u); assert.match(source, /createPhotoDevelopRenderRuntimeV2\(\{\s*source\s*\}\)/u);
	assert.match(code, /LightscaperAppV2/u); assert.match(source, /recoverPhotoLibraryRestoreV1/u);
});

for (const kind of ['session', 'renderer', 'backup', 'query', 'saved', 'restore'] as const) test(`injected Bootstrap ${kind} capability retains the exact original element.props receiver`, async () => {
	const native = mediaRestoreFixture(), locks = currentAppLocks(), canvas = currentAppCanvasBoundary();
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const seeded = kind === 'renderer' ? await seedCurrentAppPhoto(native.factory, locks) : null, received: unknown[] = [];
	let expected: LightscaperAppPropsV2 | null = null;
	const options: LightscaperAppPropsV2 = { locale: 'en',
		createSession: async function (this: LightscaperAppPropsV2) { if (kind === 'session') received.push(this); return seeded ? seeded.createSession() : createPhotoLibrarySessionV3({ name: 'Current', indexedDB: native.factory, locks }); },
		loadDevelopProxyRuntime: async function (this: LightscaperAppPropsV2, source) { if (kind === 'renderer') received.push(this); return createPhotoDevelopRenderRuntimeV2({ source }); },
		loadBackupSaveRuntime: async function (this: LightscaperAppPropsV2) { if (kind === 'backup') received.push(this); return createPhotoLibraryBackupSaveRuntimeV1(); },
		loadMetadataQueryRuntime: async function (this: LightscaperAppPropsV2) { if (kind === 'query') received.push(this); return PHOTO_METADATA_QUERY_RUNTIME_V2; },
		loadSavedFilterRuntime: async function (this: LightscaperAppPropsV2) { if (kind === 'saved') received.push(this); return PHOTO_SAVED_FILTER_RUNTIME_V1; },
		loadRestoreRuntime: async function (this: LightscaperAppPropsV2) { if (kind === 'restore') received.push(this); return { restoreArchive: async () => ({ catalogId: 'catalog', catalogName: 'Restored', photoCount: 0,
			stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] }), close: async () => undefined }; },
	};
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		const element = React.createElement(LightscaperBootstrap, options); expected = element.props; return <StrictMode>{element}</StrictMode>;
	});
	const flush = async (run: () => void = () => undefined) => { await act(async () => { run(); await settle(); }); };
	const click = async (name: string) => { const button = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === name); assert.ok(button, name); await flush(() => { reactProps(button).onClick?.({ currentTarget: button }); }); };
	try {
		await flush(); assert.equal(received.length, 0);
		if (kind === 'session' || kind === 'renderer') {
			await click('Show photo library');
			if (kind === 'renderer') {
				for (let turn = 0; turn < 64 && !mounted.dom.find('[data-photo-id]'); turn++) await flush();
				await mounted.event('[data-photo-id]', 'onClick', { ctrlKey: false, metaKey: false, shiftKey: false });
				for (let turn = 0; turn < 64 && mounted.dom.one('[data-photo-develop-menu]').hasAttribute('disabled'); turn++) await flush();
				assert.equal(mounted.dom.one('[data-photo-develop-menu]').hasAttribute('disabled'), false);
				await mounted.event('[data-photo-develop-menu]', 'onClick', { currentTarget: mounted.dom.one('[data-photo-develop-menu]') });
			}
		} else if (kind === 'restore') {
			await mounted.event('[data-photo-restore-menu]', 'onClick', { currentTarget: mounted.dom.one('[data-photo-restore-menu]') });
			await mounted.event('[data-photo-restore-file]', 'onChange', { currentTarget: { files: [new File(['archive'], 'Library.liscape')] } });
			await mounted.event('[data-photo-restore-start]', 'onClick');
		} else await click({ backup: 'Back up catalog', query: 'Search, filter and sort', saved: 'Saved filters' }[kind]);
		for (let turn = 0; turn < 64 && received.length === 0; turn++) await flush();
		assert.equal(received.length, 1, mounted.dom.container.textContent); assert.ok(Object.is(received[0], expected));
	} finally { await mounted.dispose(); canvas.restore(); }
});

for (const locale of ['en', 'de']) test(`${locale}: mounted StrictMode Bootstrap leaves native storage cold until the existing Library menu opens the actual current runtime`, async () => {
	const native = mediaRestoreFixture(), locks = currentAppLocks();
	const keys = ['indexedDB', 'IDBKeyRange'] as const, prior = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: native.factory });
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
		return <StrictMode><LightscaperBootstrap locale={locale} /></StrictMode>;
	});
	try {
		assert.equal(native.opens.length, 0); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		const show = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === (locale === 'de' ? 'Fotobibliothek anzeigen' : 'Show photo library')); assert.ok(show);
		await act(async () => { reactProps(show).onClick?.({ currentTarget: show }); await settle(); });
		for (let turn = 0; turn < 64 && native.opens.length === 0; turn++) await act(async () => { await settle(); });
		for (let turn = 0; turn < 64 && mounted.dom.find('[role="status"]'); turn++) await act(async () => { await settle(); });
		assert.ok(native.opens.length > 0); assert.ok(mounted.dom.find('[data-photo-library]')); assert.equal(mounted.dom.find('[role="alert"]'), null);
		const resident = await readResidentPhotoLibraryCurrent([], native.factory); assert.ok(resident.root); assert.equal(resident.namespace, null); assert.deepEqual(resident.photos, []);
	} finally {
		await mounted.dispose();
		for (const [index, key] of keys.entries()) { const saved = prior[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); }
	}
});

test('current Photo2/native selected-namespace observer is an exact packaged browser helper and bundles owning current admission', async () => {
	const helper = 'tests/helpers/lightscaper-current-app-fixture.tsx';
	assert.deepEqual(NIGHTLY_IMAGE_TEST_HELPER_INPUTS.filter(row => row.source === helper).map(row => ({ source: row.source, destination: row.destination, kind: row.kind })),
		[{ source: helper, destination: helper, kind: 'file' }]);
	const output = await build({ stdin: { resolveDir: new URL('../tests/helpers/', import.meta.url).pathname, contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true });
	for (const owner of ['src/lightscaper/catalog/photo-catalog-repository-v2.ts', 'src/lightscaper/catalog/photo-document-v2.ts', 'src/lightscaper/storage/photo-library-location-reader-v2.ts']) assert.ok(Object.hasOwn(output.metafile.inputs, owner), owner);
	assert.match(output.outputFiles[0]!.text, /readResidentPhotoLibraryCurrent/u);
});
