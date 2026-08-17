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
	createSoundscaperWebEditorRuntimeV23,
	default: SoundscaperAudioEditorBootstrapV23,
} = await import('../src/soundscaper/ui/SoundscaperAudioEditorBootstrapV23.tsx');

const ROOT = new URL('../', import.meta.url);

test('Soundscaper web runtime reaches exact V23 and its isolated durable store', async (context) => {
	installIndexedDB(context);
	const runtime = await createSoundscaperWebEditorRuntimeV23({ locale: 'en', copy: {} });
	assert.deepEqual(Object.keys(runtime), ['controller', 'fileService', 'dispose']);
	assert.equal(Object.isFrozen(runtime), true);
	assert.equal(runtime.fileService.kind, 'browser');
	const ready = await runtime.controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 23);
	assert.equal(ready.readOnly, false);
	assert.equal(typeof runtime.controller.actions.audioAutomation.setMode, 'function');
	assert.equal(typeof runtime.controller.actions.audioFreeze.freeze, 'function');
	assert.equal(typeof Object.getOwnPropertyDescriptor(runtime.controller, 'project')?.get, 'function');
	const trackId = String(runtime.controller.project?.tracks?.find(
		(track: Readonly<Record<string, unknown>>) => track.type === 'audio',
	)?.id);
	runtime.controller.actions.edit.commit({
		type: 'automation-lane/set',
		laneId: 'lifecycle-lane',
		expected: null,
		lane: {
			id: 'lifecycle-lane',
			address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'lifecycle-point', position: 0, value: 1 }],
			segments: [],
		},
	});
	runtime.controller.actions.audioAutomation.setMode('touch', 'lifecycle-lane');
	assert.equal(runtime.controller.actions.audioAutomation.getSnapshot().mode, 'touch');
	await runtime.controller.actions.project.create({ title: 'Lifecycle fence', sampleRate: 48_000 });
	assert.equal(runtime.controller.actions.audioAutomation.getSnapshot().mode, 'read');
	const first = runtime.dispose();
	assert.equal(runtime.dispose(), first);
	await first;
	assert.equal(runtime.controller.getSnapshot().phase, 'disposed');
});

test('Soundscaper V23 bootstrap accepts presentation only and stays surface-free while loading', async () => {
	let getterCalls = 0;
	const hostile = Object.defineProperty({ locale: 'en', copy: {} }, 'store', {
		enumerable: true,
		get() { getterCalls += 1; throw new Error('store getter'); },
	});
	await assert.rejects(
		createSoundscaperWebEditorRuntimeV23(
			hostile as unknown as { locale: string; copy: Record<string, unknown> },
		),
		/unsupported|presentation/iu,
	);
	assert.equal(getterCalls, 0);
	const markup = renderToStaticMarkup(<SoundscaperAudioEditorBootstrapV23
		locale="en"
		fallbackCopy={{ loading: 'Loading Soundscaper', genericError: 'Error: {message}' }}
	/>);
	assert.match(markup, /role="status"[^>]*>Loading Soundscaper/u);
	assert.doesNotMatch(markup, /<(?:button|input|select|textarea)\b/iu);
});

test('the shared Soundscaper site route selects only the product-owned V23 bootstrap', async () => {
	const [main, bootstrap, controller, environment] = await Promise.all([
		readSource('src/common/site/App.jsx'),
		readSource('src/soundscaper/ui/SoundscaperAudioEditorBootstrapV23.tsx'),
		readSource('src/soundscaper/editor-controller-v23.ts'),
		readSource('src/soundscaper/editor-project-environment-v23.ts'),
	]);
	assert.match(main, /lazy\(\(\)\s*=>\s*import\('\.\.\/\.\.\/soundscaper\/ui\/SoundscaperAudioEditorBootstrapV23\.tsx'\)\)/u);
	assert.match(main, /productId\s*!==\s*'framescaper'\s*\?\s*SoundscaperAudioEditorBootstrapV23/su);
	assert.match(bootstrap, /createSoundscaperEditorProjectEnvironmentV23/u);
	assert.match(bootstrap, /createSoundscaperAudioEditorControllerV23/u);
	assert.match(environment, /createSoundscaperProjectRuntimeV23Selection/u);
	assert.match(controller, /projectRuntime:\s*environment\.runtime/u);
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
