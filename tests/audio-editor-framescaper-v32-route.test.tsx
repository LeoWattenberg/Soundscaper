/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { productVideoVisualPreviewRuntimeFor } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
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
	createFramescaperWebEditorRuntimeV32,
	default: FramescaperAudioEditorBootstrapV32,
} = await import('../src/framescaper/ui/FramescaperAudioEditorBootstrapV32.tsx');
test('reserved Framescaper V32 bootstrap retains image authority without a visible control', async (context) => {
	installIndexedDB(context);
	const runtime = await createFramescaperWebEditorRuntimeV32({ locale: 'en', copy: {} });
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 32);
	assert.equal(ready.readOnly, false);
	assert.ok(framescaperCandidateAuthoringActionRuntimeFor(runtime.controller)?.surfaces.includes('video-title'));
	assert.ok(framescaperCandidateAuthoringActionRuntimeFor(runtime.controller)?.surfaces.includes('video-still'));
	assert.ok(productVideoVisualPreviewRuntimeFor(runtime.controller));
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(runtime.fileService.kind, 'browser');
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;

	const markup = renderToStaticMarkup(<FramescaperAudioEditorBootstrapV32
		locale="en"
		fallbackCopy={{ loading: 'Loading Framescaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Framescaper/u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

test('Framescaper V32 bootstrap rejects caller-owned construction authority without reading it', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createFramescaperWebEditorRuntimeV32(
			hostile as unknown as { locale: string; copy: Record<string, unknown> },
		),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);
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
