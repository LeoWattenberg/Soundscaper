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
	createFramescaperAudioEditorControllerV20,
} = await import('../src/framescaper/editor-controller-v20.ts');
const {
	createFramescaperEditorProjectEnvironmentV20,
} = await import('../src/framescaper/editor-project-environment-v20.ts');
const {
	framescaperNativeProjectActionRuntimeFor,
} = await import('../src/common/editor/ui/framescaper-native-project-actions.ts');
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');

test('selected V20 controller activates one fresh writable exact project authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV20({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV20(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});

	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 20);
	assert.equal(ready.readOnly, false);
	assert.equal(
		(ready.preferences.workspace as Readonly<{ activeId: string }>).activeId,
		'video-editor',
	);
	controller.actions.project.rename('Framescaper V20');
	assert.equal(controller.project.schemaVersion, 20);
	assert.equal(controller.project.title, 'Framescaper V20');
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 20);
	assert.deepEqual(
		framescaperNativeProjectActionRuntimeFor(controller)?.surfaces,
		['render-queue-enqueue'],
		'selected V20 advertises its queue action without candidate-only mutations',
	);
	assert.equal(typeof (controller as unknown as Readonly<{
		prepareNativeRenderInputsV20?: unknown;
	}>).prepareNativeRenderInputsV20, 'function');
});

test('V20 controller rejects cloned environments and caller-owned authority options', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV20({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.throws(
		() => createFramescaperAudioEditorControllerV20({ ...environment }),
		/exact.*environment/iu,
	);
	for (const field of ['store', 'projectRuntime', 'sessionController', 'acquireProjectLock']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		assert.throws(
			() => createFramescaperAudioEditorControllerV20(environment, options),
			/unsupported|authority|presentation/iu,
		);
		assert.equal(reads, 0);
	}
});
