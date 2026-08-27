/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const {
	createSoundscaperWebEditorRuntimeV30,
	default: SoundscaperAudioEditorBootstrapV30,
} = await import('../src/soundscaper/ui/SoundscaperAudioEditorBootstrapV30.tsx');

const ROOT = new URL('../', import.meta.url);

test('selected Soundscaper web runtime reaches exact V30 and its native action seam', async (context) => {
	installIndexedDB(context);
	const runtime = await createSoundscaperWebEditorRuntimeV30({ locale: 'en', copy: {} });
	context.after(async () => { await runtime.dispose(); });
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 30);
	assert.equal(ready.readOnly, false);
	assert.equal(typeof runtime.controller.actions.nativePlugins.upsert, 'function');
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(Object.isFrozen(runtime), true);
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;
	assert.equal(runtime.controller.getSnapshot().phase, 'disposed');
});

test('Soundscaper V30 bootstrap accepts presentation only and stays surface-free while loading', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createSoundscaperWebEditorRuntimeV30(
			hostile as unknown as { locale: string; copy: Record<string, unknown> },
		),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);
	const markup = renderToStaticMarkup(<SoundscaperAudioEditorBootstrapV30
		locale="en"
		fallbackCopy={{ loading: 'Loading Soundscaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Soundscaper/u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

test('the shared Soundscaper site route advances to the product-owned V30 bootstrap', async () => {
	const [main, bootstrap, controller, environment] = await Promise.all([
		readSource('src/common/site/App.jsx'),
		readSource('src/soundscaper/ui/SoundscaperAudioEditorBootstrapV30.tsx'),
		readSource('src/soundscaper/editor-controller-v30.ts'),
		readSource('src/soundscaper/editor-project-environment-v30.ts'),
	]);
	assert.match(main, /lazy\(\(\)\s*=>\s*import\('\.\.\/\.\.\/soundscaper\/ui\/SoundscaperAudioEditorBootstrapV30\.tsx'\)\)/u);
	assert.match(main, /productId\s*!==\s*'framescaper'\s*\?\s*SoundscaperAudioEditorBootstrapV30/su);
	assert.match(bootstrap, /createSoundscaperEditorProjectEnvironmentV30/u);
	assert.match(bootstrap, /createSoundscaperAudioEditorControllerV30/u);
	assert.ok(
		bootstrap.indexOf('const fileService = createAudioEditorFileService()')
			< bootstrap.indexOf('const environment = await createSoundscaperEditorProjectEnvironmentV30'),
		'the desktop file ports must exist before the exact store is constructed',
	);
	assert.match(bootstrap, /createSoundscaperEditorProjectEnvironmentV30\(\{\s*storeOptions:\s*\{\s*linkedOriginalPort:\s*fileService\.linkedOriginalPort,\s*linkedVideoOriginalPort:\s*fileService\.linkedVideoOriginalPort,?\s*\},?\s*\}\)/su);
	assert.match(environment, /createSoundscaperProjectRuntimeV30Selection/u);
	assert.match(controller, /projectRuntime:\s*environment\.runtime/u);
	assert.match(controller, /createSoundscaperVideoExportStrategyV30\(\s*environment\.runtime\s*\)/u);
	assert.doesNotMatch(controller, /createSoundscaperDesktopVideoExportStrategyV30/u);
	assert.doesNotMatch(bootstrap, /createAudioEditorController|AudioEditorBootstrap\.jsx/u);
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

async function readSource(path: string): Promise<string> {
	return readFile(new URL(path, ROOT), 'utf8');
}
