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

const { createFramescaperAudioEditorControllerV30 } = await import(
	'../src/framescaper/editor-controller-v30.ts'
);
const { createFramescaperEditorProjectEnvironmentV30 } = await import(
	'../src/framescaper/editor-project-environment-v30.ts'
);
const { framescaperCandidateAuthoringActionRuntimeFor } = await import(
	'../src/common/editor/ui/framescaper-candidate-authoring-actions.ts'
);
const { productVideoVisualPreviewRuntimeFor } = await import(
	'../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts'
);
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');

test('selected V30 composes inherited menu authoring with image authoring and preview', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV30({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV30(environment, { locale: 'en' });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 30);
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring?.surfaces.includes('video-title'));
	assert.ok(authoring?.surfaces.includes('video-still'));
	assert.equal(authoring?.surfaces.filter((surface) => surface === 'video-still').length, 1);
	assert.ok(productVideoVisualPreviewRuntimeFor(controller));
	controller.actions.project.rename('Framescaper V30');
	assert.equal(controller.project.title, 'Framescaper V30');
});

test('selected V30 rejects cloned environments and caller-owned controller authority', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV30({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.throws(() => createFramescaperAudioEditorControllerV30({ ...environment }), /exact.*environment/iu);
	let reads = 0;
	const options = Object.defineProperty({}, 'store', {
		enumerable: true,
		get() { reads += 1; throw new Error('authority getter'); },
	});
	assert.throws(
		() => createFramescaperAudioEditorControllerV30(environment, options),
		/unsupported|authority|presentation/iu,
	);
	assert.equal(reads, 0);
});
