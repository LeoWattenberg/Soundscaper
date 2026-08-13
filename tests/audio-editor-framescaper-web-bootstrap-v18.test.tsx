/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { resolveControllerProjectRuntime } from '../src/common/editor/controller/project-runtime.ts';
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
	createFramescaperWebEditorRuntimeV18,
	default: FramescaperAudioEditorBootstrapV18,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV18.tsx');

const ROOT = new URL('../', import.meta.url);

test('Framescaper web runtime reaches exact V18 without exposing construction authority', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV18({ locale: 'en', copy: {} });
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(Object.isFrozen(runtime), true);
	assert.equal(runtime.fileService.kind, 'browser');
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 18);
	assert.equal(ready.readOnly, false);
	assert.equal(
		(ready.preferences.workspace as Readonly<{ activeId: string }>).activeId,
		'video-editor',
	);
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;
	assert.equal(runtime.controller.getSnapshot().phase, 'disposed');
});

test('Framescaper bootstrap accepts presentation only and has no always-visible product control', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createFramescaperWebEditorRuntimeV18(hostile as unknown as { locale: string; copy: Record<string, unknown> }),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV18
		locale="en"
		fallbackCopy={{ loading: 'Loading Framescaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Framescaper</u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

test('the shared Main route selects the product bootstrap while Soundscaper stays exact V17', async () => {
	const [main, soundscaperBootstrap, framescaperBootstrap] = await Promise.all([
		readSource('src/common/site/App.jsx'),
		readSource('src/common/editor/ui/AudioEditorBootstrap.jsx'),
		readSource('src/framescaper/ui/FramescaperAudioEditorBootstrapV18.tsx'),
	]);
	assert.match(main, /lazy\(\(\)\s*=>\s*import\('\.\.\/\.\.\/framescaper\/ui\/FramescaperAudioEditorBootstrapV18\.tsx'\)\)/u);
	assert.match(main, /productId\s*===\s*'framescaper'[^?]*\?\s*FramescaperAudioEditorBootstrapV18\s*:\s*AudioEditorBootstrap/su);
	assert.doesNotMatch(soundscaperBootstrap,
		/FRAMESCAPER_V18|createFramescaper|editor-project-runtime-profile-v18|framescaper\/ui/iu);
	assert.match(framescaperBootstrap, /createFramescaperEditorProjectEnvironmentV18/u);
	assert.match(framescaperBootstrap, /createFramescaperAudioEditorControllerV18/u);
	assert.doesNotMatch(framescaperBootstrap,
		/from\s+['"]\.\.\/\.\.\/common\/editor\/app\.js|createAudioEditorController\s*\(/u);

	const soundscaper = resolveControllerProjectRuntime();
	assert.equal(soundscaper.createProject({ id: 'soundscaper-web', title: 'Soundscaper' }).schemaVersion, 17);
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
