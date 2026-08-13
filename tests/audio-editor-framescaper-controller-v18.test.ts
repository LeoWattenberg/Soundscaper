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
	createFramescaperAudioEditorControllerV18,
} = await import('../src/framescaper/editor-controller-v18.ts');
const {
	createFramescaperEditorProjectEnvironmentV18,
} = await import('../src/framescaper/editor-project-environment-v18.ts');
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');

test('product-owned controller activates a fresh writable V18 project', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV18(environment, {
		locale: 'en',
	});
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready');
	assert.equal(ready.project.schemaVersion, 18);
	assert.equal(ready.readOnly, false);
	assert.equal(ready.preferences.workspace.activeId, 'video-editor');
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 18);
	controller.actions.project.rename('Framescaper V18');
	assert.equal(controller.project.schemaVersion, 18);
	assert.equal(controller.project.title, 'Framescaper V18');
});

test('product controller refuses cloned environments and authority options before effects', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.throws(
		() => createFramescaperAudioEditorControllerV18({ ...environment }),
		/exact.*environment/iu,
	);
	for (const field of ['store', 'projectRuntime', 'sessionController', 'acquireProjectLock']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		assert.throws(
			() => createFramescaperAudioEditorControllerV18(environment, options),
			/unsupported|authority|presentation/iu,
		);
		assert.equal(reads, 0);
	}
});
