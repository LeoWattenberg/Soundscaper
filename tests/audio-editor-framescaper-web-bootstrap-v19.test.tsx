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
	createFramescaperWebEditorRuntimeV19,
	default: FramescaperAudioEditorBootstrapV19,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV19.tsx');

const ROOT = new URL('../', import.meta.url);

test('Framescaper web runtime reaches exact V19 without exposing construction authority', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV19({ locale: 'en', copy: {} });
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(Object.isFrozen(runtime), true);
	assert.equal(runtime.fileService.kind, 'browser');
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 19);
	assert.equal(ready.readOnly, false);
	assert.equal(
		(ready.preferences.workspace as Readonly<{ activeId: string }>).activeId,
		'video-editor',
	);
	const capture = ready.capture as Readonly<{ readonly availability?: Readonly<{ readonly status?: string }> }>;
	assert.ok(capture);
	assert.equal(capture.availability?.status, 'unavailable');
	assert.equal(typeof runtime.controller.actions.capture.requestPreview, 'function');
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;
	assert.equal(runtime.controller.getSnapshot().phase, 'disposed');
});

test('Framescaper V19 bootstrap accepts presentation only and adds no always-visible control', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createFramescaperWebEditorRuntimeV19(
			hostile as unknown as { locale: string; copy: Record<string, unknown> },
		),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV19
		locale="en"
		fallbackCopy={{ loading: 'Loading Framescaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Framescaper</u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

test('the reserved V19 bootstrap remains unselected when the shared site route selects V27', async () => {
	const [main, soundscaperBootstrap, framescaperBootstrap] = await Promise.all([
		readSource('src/common/site/App.jsx'),
		readSource('src/common/editor/ui/AudioEditorBootstrap.jsx'),
		readSource('src/framescaper/ui/FramescaperAudioEditorBootstrapV27.tsx'),
	]);
	assert.match(main, /lazy\(\(\)\s*=>\s*import\('\.\.\/\.\.\/framescaper\/ui\/FramescaperAudioEditorBootstrapV27\.tsx'\)\)/u);
	assert.doesNotMatch(main, /FramescaperAudioEditorBootstrapV(?:19|20)\.tsx/u);
	assert.doesNotMatch(soundscaperBootstrap,
		/FRAMESCAPER_V20|createFramescaper|editor-project-runtime-profile-v20|framescaper\/ui/iu);
	assert.match(framescaperBootstrap, /createFramescaperEditorProjectEnvironmentV27/u);
	assert.match(framescaperBootstrap, /createFramescaperAudioEditorControllerV27/u);
	assert.doesNotMatch(framescaperBootstrap,
		/from\s+['"]\.\.\/\.\.\/common\/editor\/app\.js|createAudioEditorController\s*\(/u);
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
