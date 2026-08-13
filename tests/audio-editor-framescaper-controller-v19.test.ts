/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

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
	createFramescaperAudioEditorControllerV19,
} = await import('../src/framescaper/editor-controller-v19.ts');
const {
	createFramescaperEditorProjectEnvironmentV19,
} = await import('../src/framescaper/editor-project-environment-v19.ts');
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');
const { createVideoSourceV10, createVideoTrackV10 } = await import('../src/common/editor/project-v10.ts');
const {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} = await import('../src/common/editor/video-clip-composition.ts');

test('product-owned V19 controller activates a fresh writable geometry project', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV19({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV19(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});

	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 19);
	assert.equal(ready.readOnly, false);
	assert.equal(
		(ready.preferences.workspace as Readonly<{ activeId: string }>).activeId,
		'video-editor',
	);
	controller.actions.project.rename('Framescaper V19');
	assert.equal(controller.project.schemaVersion, 19);
	assert.equal(controller.project.title, 'Framescaper V19');
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 19);
});

test('V19 controller commits video composition through authoritative history with undo', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV19({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV19(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;

	const rate = { num: 30, den: 1 };
	const project = environment.runtime.createProject({
		id: 'controller-v19-composition',
		title: 'Composition',
		now: '2026-08-13T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), sampleFrameCount: 48_000,
			sourceFrameCount: 300, frameRate: rate, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: 'track', name: 'Video', clipIds: ['clip'], locked: false,
		})],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
	await environment.createProjectIfAbsent(project);
	await controller.actions.project.open(project);
	const composition = {
		...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION),
		opacity: 0.5,
		transform: {
			...structuredClone(DEFAULT_VIDEO_CLIP_COMPOSITION.transform),
			rotationDegrees: 15,
		},
	};
	controller.actions.edit.commit({
		type: 'video-composition/set',
		clipId: 'clip',
		expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		composition,
	});
	assert.deepEqual(controller.project.clips[0].videoComposition, composition);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project.clips[0].videoComposition, DEFAULT_VIDEO_CLIP_COMPOSITION);
});

test('V19 controller refuses cloned environments and caller-owned authority options', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV19({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.throws(
		() => createFramescaperAudioEditorControllerV19({ ...environment }),
		/exact.*environment/iu,
	);
	for (const field of ['store', 'projectRuntime', 'sessionController', 'acquireProjectLock']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		assert.throws(
			() => createFramescaperAudioEditorControllerV19(environment, options),
			/unsupported|authority|presentation/iu,
		);
		assert.equal(reads, 0);
	}
});
