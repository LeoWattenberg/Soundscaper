/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperNativeProjectActionRuntimeFor } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { productVideoVisualPreviewRuntimeFor } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { framescaperCubeLutActionsV27For } from '../src/framescaper/editor-cube-lut-actions-v27.ts';
import { framescaperMotionAnalysisActionsV27For } from '../src/framescaper/editor-motion-analysis-actions-v27.ts';
import { framescaperNativeOpenFxAuthoringRuntimeForV28 } from '../src/framescaper/editor-native-openfx-action-v28.ts';
import { createFramescaperProjectV31 } from '../src/framescaper/editor-project-v31.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import { framescaperSelectedRenderSessionRuntimeV28For } from '../src/framescaper/editor-selected-v28-render-session.ts';
import { framescaperVideoProxyActionRuntimeFor } from '../src/framescaper/editor-video-proxy-action-runtime-v20.ts';
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

const { createFramescaperAudioEditorControllerV31 } = await import(
	'../src/framescaper/editor-controller-v31.ts'
);
const { createFramescaperEditorProjectEnvironmentV31 } = await import(
	'../src/framescaper/editor-project-environment-v31.ts'
);

const SOURCE_SHA256 = 'ab'.repeat(32);
const BODY_SHA256 = 'cd'.repeat(32);
const MODEL_SHA256 = 'ef'.repeat(32);
const ROOT = new URL('../', import.meta.url);

test('selected F31 controller retains every selected V28 product runtime and owns capture', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV31(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 31);
	const capture = ready.capture as Readonly<{
		readonly availability?: Readonly<{ readonly status?: string }>;
	}>;
	assert.ok(capture);
	assert.equal(capture.availability?.status, 'unavailable');
	assert.equal(typeof controller.actions.capture.requestPreview, 'function');
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(controller)?.surfaces, [
		'render-queue-enqueue',
	]);
	assert.ok(framescaperCandidateAuthoringActionRuntimeFor(controller));
	assert.ok(framescaperVideoProxyActionRuntimeFor(controller));
	assert.ok(productVideoVisualPreviewRuntimeFor(controller));
	assert.ok(framescaperSelectedRenderSessionRuntimeV28For(controller));
	assert.ok(framescaperMotionAnalysisActionsV27For(controller));
	assert.ok(framescaperCubeLutActionsV27For(controller));
	assert.equal(typeof (controller as unknown as Readonly<{
		prepareNativeRenderInputStreamV31?: unknown;
	}>).prepareNativeRenderInputStreamV31, 'function');
	assert.equal(Object.keys(controller).includes('prepareNativeRenderInputStreamV31'), false);
});

test('ordinary F31 controller edits retain transcript reference authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV31(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const project = projectWithTranscript();
	await environment.createProjectIfAbsent(project as never);
	await controller.actions.project.open(project);
	const retained = structuredClone(project.assistanceAssets);
	controller.actions.project.rename('Renamed with transcript custody');
	assert.equal(controller.project.schemaVersion, 31);
	assert.deepEqual(controller.project.assistanceAssets, retained);
	await controller.actions.project.save();
	assert.deepEqual((await environment.store.loadProject(project.id))?.assistanceAssets, retained);
});

test('F31 adopts the optional selected-V28 native image-sequence and OpenFX runtimes', async (context) => {
	installOptionalNativeBridge(context);
	const environment = await createFramescaperEditorProjectEnvironmentV31({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV31(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	assert.deepEqual(framescaperNativeProjectActionRuntimeFor(controller)?.surfaces, [
		'render-queue-enqueue', 'image-sequence-import', 'ofx-add',
	]);
	assert.ok(framescaperNativeOpenFxAuthoringRuntimeForV28(controller));
});

test('selected F31 bootstrap owns native watch imports', async () => {
	const source = await readFile(new URL(
		'src/framescaper/ui/FramescaperAudioEditorBootstrapV31.tsx', ROOT,
	), 'utf8');
	assert.match(source, /createFramescaperNativeWatchImportClientV31/u);
	assert.doesNotMatch(source, /FramescaperAudioEditorBootstrapV28/u);
});

function projectWithTranscript() {
	const source = createAudioSource({
		id: 'dialogue-audio', name: 'Dialogue', mimeType: 'audio/wav',
		storageKey: 'owned:dialogue-audio', contentSha256: SOURCE_SHA256,
		frameCount: 96_000, sampleRate: 48_000, channelCount: 2,
	});
	return createFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v31-parity', title: 'Transcript parity',
		now: '2026-08-25T00:00:00.000Z', sources: [source],
		assistanceAssets: [{
			id: 'transcript-01', kind: 'transcript-v1', sourceId: source.id,
			sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 96_000,
			sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
			modelArtifactSha256s: [MODEL_SHA256], body: {
				storageKey: `assistance-transcript-sha256:${BODY_SHA256}`,
				mimeType: 'application/vnd.soundscaper.assistance-transcript+json',
				byteLength: 1_024, sha256: BODY_SHA256,
			},
		}],
	} as never);
}

function installOptionalNativeBridge(context: TestContext): void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	const nativeServices = Object.freeze({
		snapshot: async () => ({
			snapshotVersion: 1, runtimeAvailable: false, nativeMediaEnabled: false,
			queue: [], roots: [], watchRules: [],
		}),
		control: async () => { throw new Error('queue unavailable'); },
		reorder: async () => [], remove: async () => false,
		capabilities: async () => { throw new Error('native capability remains closed'); },
		selectImageSequence: async () => null,
		readImageSequenceFile: async () => new Uint8Array(),
		releaseImageSequence: async () => true,
		imageSequenceImport: async () => ({}),
		writeImageSequenceImportChunk: async () => ({}),
		readImageSequenceImportBody: async () => new Uint8Array(),
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
