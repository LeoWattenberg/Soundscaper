/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useLightscaperEditorCopy, type LightscaperCopyCatalogLoadersV1 } from '../src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts';
import { LIGHTSCAPER_EDITOR_COPY_BY_LOCALE } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function catalog(locale: string, label: string) {
	return { schemaVersion: 2, locale, entries: {
		photoFileMenu: ['human', LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.en.photoFileMenu, label],
		workspacePhoto: ['human', 'Photo library', `${label} library`],
		fileMenu: ['human', 'File', 'Unrelated timeline command'],
	} };
}

test('photo copy paints bundled English or German without opening an absent catalog', async () => {
	let calls = 0;
	const loaders = { fr: async () => { calls++; return catalog('fr', 'Fichier'); } };
	const mounted = await mount('en', loaders);
	try {
		assert.equal(mounted.copy.photoFileMenu, 'File');
		assert.equal(mounted.copy.photoEditor, 'Photo editor');
		assert.equal(Object.hasOwn(mounted.copy, 'fileMenu'), false);
		assert.deepEqual(Object.keys(mounted.copy).sort(), [...Object.keys(LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.en),
			'lightscaperTitle', 'lightscaperMetaDescription', 'photoEditor', 'workspacePhoto'].sort());
		assert.ok(Object.isFrozen(mounted.copy));
		await mounted.render('de-AT', loaders);
		assert.equal(mounted.copy.photoFileMenu, 'Datei');
		assert.equal(mounted.copy.photoEditor, 'Foto-Editor');
		assert.equal(calls, 0);
	} finally { await mounted.dispose(); }
});

test('a late previous locale cannot replace the current translated photo copy', async () => {
	const french = deferred<unknown>(), spanish = deferred<unknown>();
	const loaders = { fr: () => french.promise, es: () => spanish.promise };
	const mounted = await mount('fr', loaders);
	try {
		assert.equal(mounted.copy.photoFileMenu, 'File');
		await mounted.render('es', loaders);
		await act(async () => { spanish.resolve(catalog('es', 'Archivo')); });
		assert.equal(mounted.copy.photoFileMenu, 'Archivo');
		assert.equal(mounted.copy.workspacePhoto, 'Archivo library');
		await act(async () => { french.resolve(catalog('fr', 'Fichier')); });
		assert.equal(mounted.copy.photoFileMenu, 'Archivo');
		assert.equal(Object.hasOwn(mounted.copy, 'fileMenu'), false);
		await mounted.render('de', loaders);
		assert.equal(mounted.copy.photoFileMenu, 'Datei');
	} finally {
		await act(async () => { french.resolve(catalog('fr', 'Cleanup')); spanish.resolve(catalog('es', 'Cleanup')); });
		await mounted.dispose();
	}
});

test('catalog failure retains bundled copy and replacement loaders retire the previous translation', async () => {
	const failed = deferred<unknown>(), replacement = deferred<unknown>();
	const first = { fr: async () => catalog('fr', 'Fichier') };
	const mounted = await mount('fr', first);
	try {
		assert.equal(mounted.copy.photoFileMenu, 'Fichier');
		await mounted.render('fr', { fr: () => failed.promise });
		assert.equal(mounted.copy.photoFileMenu, 'File');
		await act(async () => { failed.reject(new Error('catalog unavailable')); });
		assert.equal(mounted.copy.photoFileMenu, 'File');
		await mounted.render('fr', { fr: () => replacement.promise });
		await act(async () => { replacement.resolve(catalog('fr', 'Nouveau fichier')); });
		assert.equal(mounted.copy.photoFileMenu, 'Nouveau fichier');
	} finally {
		await act(async () => { replacement.resolve(catalog('fr', 'Cleanup')); });
		await mounted.dispose();
	}
});

test('unmount retires a held catalog load without publishing a late render', async () => {
	const pending = deferred<unknown>();
	const mounted = await mount('fr', { fr: () => pending.promise });
	try {
		const renders = mounted.renders;
		await mounted.unmount();
		await act(async () => { pending.resolve(catalog('fr', 'Late fichier')); });
		assert.equal(mounted.renders, renders);
		assert.equal(mounted.copy.photoFileMenu, 'File');
	} finally { await mounted.dispose(); }
});

async function mount(initialLocale: string, initialLoaders: LightscaperCopyCatalogLoadersV1) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current: ReturnType<typeof useLightscaperEditorCopy> | undefined, renders = 0, unmounted = false;
	function Harness({ locale, loaders }: { locale: string; loaders: LightscaperCopyCatalogLoadersV1 }) {
		current = useLightscaperEditorCopy(locale, { loaders }); renders++;
		return null;
	}
	const render = async (locale: string, loaders: LightscaperCopyCatalogLoadersV1) => {
		await act(async () => { root.render(<Harness locale={locale} loaders={loaders} />); });
	};
	const unmount = async () => {
		if (unmounted) return;
		unmounted = true;
		await act(async () => { root.unmount(); });
	};
	try { await render(initialLocale, initialLoaders); }
	catch (error) { await unmount(); dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; throw error; }
	return {
		render, unmount,
		get copy() { assert.ok(current); return current; },
		get renders() { return renders; },
		async dispose() {
			try { await unmount(); }
			finally { actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); }
		},
	};
}
