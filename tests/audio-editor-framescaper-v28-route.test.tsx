/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;
register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createFramescaperAudioEditorControllerV28 } = await import(
	'../src/framescaper/editor-controller-v28.ts'
);
const { FRAMESCAPER_PROFILE } = await import('../src/framescaper/product.js');
const { createFramescaperEditorProjectEnvironmentV28 } = await import(
	'../src/framescaper/editor-project-environment-v28.ts'
);
const {
	createFramescaperWebEditorRuntimeV28,
	default: FramescaperAudioEditorBootstrapV28,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV28.tsx');
const { framescaperCandidateAuthoringActionRuntimeFor } = await import(
	'../src/common/editor/ui/framescaper-candidate-authoring-actions.ts'
);
const { framescaperNativeProjectActionRuntimeFor } = await import(
	'../src/common/editor/ui/framescaper-native-project-actions.ts'
);
const { productVideoVisualPreviewRuntimeFor } = await import(
	'../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts'
);
const { framescaperSelectedRenderSessionRuntimeV28For } = await import(
	'../src/framescaper/editor-selected-v28-render-session.ts'
);
const { framescaperVideoProxyActionRuntimeFor } = await import(
	'../src/framescaper/editor-video-proxy-action-runtime-v20.ts'
);

test('selected V28 preserves inherited editorial runtimes and stays native-default-off', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV28({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV28(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 28);
	assert.equal(ready.readOnly, false);
	assert.equal(FRAMESCAPER_PROFILE.capabilities.ofxEffects, true);
	assert.deepEqual(
		framescaperNativeProjectActionRuntimeFor(controller)?.surfaces,
		['render-queue-enqueue'],
		'the menu-only V14 queue action is bound even though the web bridge stays absent',
	);
	assert.ok(framescaperCandidateAuthoringActionRuntimeFor(controller));
	assert.ok(framescaperVideoProxyActionRuntimeFor(controller));
	assert.ok(productVideoVisualPreviewRuntimeFor(controller));
	assert.ok(framescaperSelectedRenderSessionRuntimeV28For(controller));
	assert.equal(typeof (controller as unknown as Readonly<{
		prepareNativeRenderInputStreamV28?: unknown;
	}>).prepareNativeRenderInputStreamV28, 'function');
	assert.equal(Object.keys(controller).includes('prepareNativeRenderInputStreamV28'), false);
	controller.actions.project.rename('Framescaper V28');
	assert.equal(controller.project.title, 'Framescaper V28');
	await controller.actions.project.save();
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 28);
});

test('selected V28 keeps dormant V25/V26 in opaque read-only custody', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV28({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV28(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;
	for (const schemaVersion of [25, 26]) {
		const opaque = structuredClone(controller.project) as unknown as Record<string, unknown>;
		opaque.schemaVersion = schemaVersion;
		opaque.id = `custody-v${String(schemaVersion)}`;
		opaque.nativeVideoSources = [{ retainedOpaque: schemaVersion }];
		await controller.actions.project.open(opaque);
		assert.deepEqual(controller.project, opaque);
		assert.equal(controller.getSnapshot().readOnly, true);
		assert.equal(await controller.actions.project.rename('Must not mutate'), undefined);
		assert.deepEqual(controller.project, opaque);
	}
});

test('selected V28 production composition binds the menu-only OpenFX action without enabling it', async (context) => {
	installNativeOpenFxBridge(context);
	const environment = await createFramescaperEditorProjectEnvironmentV28({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV28(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(controller)?.surfaces, [
		'render-queue-enqueue', 'ofx-add',
	]);
	assert.equal(FRAMESCAPER_PROFILE.capabilities.ofxEffects, true);
});

test('Framescaper web bootstrap selects V28 without an always-visible control', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV28({ locale: 'en', copy: {} });
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 28);
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV28
		locale="en"
		fallbackCopy={{ loading: 'Loading Framescaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Framescaper/u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

function installIndexedDB(context: TestContext): void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
	Object.defineProperty(globalThis, 'indexedDB', {
		configurable: true,
		value: createInstrumentedIndexedDB() as unknown as IDBFactory,
	});
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
		else Reflect.deleteProperty(globalThis, 'indexedDB');
	});
}

function installNativeOpenFxBridge(context: TestContext): void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	const nativeServices = Object.freeze({
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: false, nativeMediaEnabled: false,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => { throw new Error('queue unavailable'); },
		reorder: async () => [], remove: async () => false,
		capabilities: async () => { throw new Error('OpenFX capability remains closed'); },
		listOpenFxPlugins: async () => [],
	});
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v1: Object.freeze({ nativeServices }) }),
	});
	context.after(() => {
		if (descriptor) Object.defineProperty(globalThis, 'framescaperDesktop', descriptor);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
}
