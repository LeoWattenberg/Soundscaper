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

const { createFramescaperAudioEditorControllerV27 } = await import(
	'../src/framescaper/editor-controller-v27.ts'
);
const { createFramescaperEditorProjectEnvironmentV27 } = await import(
	'../src/framescaper/editor-project-environment-v27.ts'
);
const {
	createFramescaperWebEditorRuntimeV27,
	default: FramescaperAudioEditorBootstrapV27,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV27.tsx');
const { framescaperNativeProjectActionRuntimeFor } = await import(
	'../src/common/editor/ui/framescaper-native-project-actions.ts'
);

test('selected V27 controller creates, edits, saves, undoes, and redoes exact documents', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV27({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV27(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 27);
	assert.equal(ready.readOnly, false);
	controller.actions.project.rename('Framescaper V27');
	assert.equal(controller.project.title, 'Framescaper V27');
	controller.actions.edit.undo();
	assert.notEqual(controller.project.title, 'Framescaper V27');
	controller.actions.edit.redo();
	assert.equal(controller.project.title, 'Framescaper V27');
	await controller.actions.project.save();
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 27);
	assert.equal(framescaperNativeProjectActionRuntimeFor(controller), null);
});

test('selected Framescaper web runtime reaches V27 and its lazy bootstrap adds no visible control', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV27({ locale: 'en', copy: {} });
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 27);
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV27
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
