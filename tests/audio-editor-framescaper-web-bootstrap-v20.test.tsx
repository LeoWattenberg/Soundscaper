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

const {
	createFramescaperWebEditorRuntimeV20,
	default: FramescaperAudioEditorBootstrapV20,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV20.tsx');

test('dormant Framescaper web runtime reaches exact V20 without exposing authority', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV20({ locale: 'en', copy: {} });
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(Object.isFrozen(runtime), true);
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 20);
	assert.equal(ready.readOnly, false);
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;
	assert.equal(runtime.controller.getSnapshot().phase, 'disposed');
});

test('V20 bootstrap accepts presentation only and adds no always-visible control', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createFramescaperWebEditorRuntimeV20(
			hostile as unknown as { locale: string; copy: Record<string, unknown> },
		),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV20
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
