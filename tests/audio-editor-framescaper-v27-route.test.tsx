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
const { framescaperCandidateAuthoringActionRuntimeFor } = await import(
	'../src/common/editor/ui/framescaper-candidate-authoring-actions.ts'
);
const { framescaperSelectedRenderSessionRuntimeV27For } = await import(
	'../src/framescaper/editor-selected-v27-render-session.ts'
);
const { framescaperVideoProxyActionRuntimeFor } = await import(
	'../src/framescaper/editor-video-proxy-action-runtime-v20.ts'
);
const { framescaperMotionAnalysisActionsV27For } = await import(
	'../src/framescaper/editor-motion-analysis-actions-v27.ts'
);
const { productVideoVisualPreviewRuntimeFor } = await import(
	'../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts'
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
	assert.ok(framescaperSelectedRenderSessionRuntimeV27For(controller));
	assert.ok(framescaperMotionAnalysisActionsV27For(controller));
	const proxyRuntime = framescaperVideoProxyActionRuntimeFor(controller);
	assert.ok(proxyRuntime);
	assert.equal(typeof proxyRuntime.attachExisting, 'function');
	await controller.actions.video.reportPreviewPressure('video-source', {
		droppedFrameRatio: 0, decodeQueueDepth: 0, viewportScale: 1,
	});
	assert.deepEqual(proxyRuntime.pressure('video-source'), {
		droppedFrameRatio: 0, decodeQueueDepth: 0, viewportScale: 1,
	});
	assert.ok(productVideoVisualPreviewRuntimeFor(controller));
});

test('selected V27 visual authoring commits menu-direct state and fences dialog workflows', async (context) => {
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
	const runtime = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(runtime);
	assert.deepEqual(runtime.surfaces, [
		'video-transition', 'video-transition-dissolve',
		'video-still', 'video-title', 'video-text', 'video-shape', 'video-solid',
		'video-adjustment-layer', 'video-visual-preset', 'video-mask-matte', 'video-freeze',
	]);
	assert.equal(runtime.surfaces.includes('video-external-generator'), false);

	await runtime.run('video-solid');
	let project = visualProject(controller.project);
	assert.equal(project.sources.filter(({ kind }) => kind === 'generator').length, 1);
	assert.equal(project.clips.filter(({ kind }) => kind === 'generator').length, 1);
	const revisionAfterSolid = project.revision;
	controller.actions.edit.undo();
	project = visualProject(controller.project);
	assert.equal(project.sources.some(({ kind }) => kind === 'generator'), false);
	assert.equal(project.revision, revisionAfterSolid + 1);
	controller.actions.edit.redo();
	project = visualProject(controller.project);
	assert.equal(project.sources.filter(({ kind }) => kind === 'generator').length, 1);

	for (const surface of ['video-title', 'video-text', 'video-shape'] as const) {
		await runtime.run(surface);
	}
	for (const surface of [
		'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
		'video-visual-preset', 'video-mask-matte', 'video-freeze',
	] as const) await assert.rejects(runtime.run(surface), /menu-opened dialog/iu);
	project = visualProject(controller.project);
	assert.deepEqual(project.sources.filter(({ kind }) => kind === 'generator')
		.map(({ generator }) => generator?.kind), ['solid', 'title', 'text', 'shape']);
	assert.equal(project.videoAdjustmentLayers.length, 0);
	assert.equal(project.videoMaskMattes.length, 0);
	assert.equal(project.videoVisualPresets.length, 0);
	await controller.actions.project.save();
	const persisted = visualProject(await environment.store.loadProject(ready.project.id));
	assert.equal(persisted.sources.filter(({ kind }) => kind === 'generator').length, 4);
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

interface VisualProjectShape {
	readonly revision: number;
	readonly sources: readonly Readonly<{
		readonly kind?: unknown;
		readonly generator?: Readonly<{ readonly kind?: unknown }>;
	}>[];
	readonly clips: readonly Readonly<{ readonly kind?: unknown }>[];
	readonly videoAdjustmentLayers: readonly unknown[];
	readonly videoMaskMattes: readonly unknown[];
	readonly videoVisualPresets: readonly unknown[];
}

function visualProject(value: unknown): VisualProjectShape {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as VisualProjectShape;
}
