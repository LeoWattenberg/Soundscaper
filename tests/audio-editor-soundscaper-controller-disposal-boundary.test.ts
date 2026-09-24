/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

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

const { createSoundscaperAudioEditorController } = await import('../src/soundscaper/editor-controller.ts');
const { createSoundscaperEditorProjectEnvironment } = await import(
	'../src/soundscaper/editor-project-environment.ts'
);

test('Soundscaper closes edit authority before awaiting product disposal', async () => {
	const environment = await createEnvironment();
	const controller = createSoundscaperAudioEditorController(environment);
	try {
		await controller.ready;
		let nested: Promise<void> | undefined;
		const unsubscribe = controller.subscribe(() => {
			if (controller.getSnapshot().phase === 'disposing') nested = controller.dispose();
		});
		const pending = controller.dispose();
		assert.equal(nested, pending);
		unsubscribe();
		assert.equal(controller.getSnapshot().phase, 'disposing');
		assert.throws(() => controller.actions.project.create(), { code: 'DISPOSED' });
		assert.throws(() => controller.actions.audioAutomation.setMode('read'), { code: 'DISPOSED' });
		assert.throws(() => controller.actions.audioFreeze.freeze('track'), { code: 'DISPOSED' });
		await pending;
	} finally {
		await controller.dispose().catch(() => undefined);
		await environment.close();
	}
});

test('explicit early disposal fencing also closes product actions', async () => {
	const environment = await createEnvironment();
	const controller = createSoundscaperAudioEditorController(environment);
	try {
		await controller.ready;
		controller.beginDisposal();
		assert.equal(controller.getSnapshot().phase, 'disposing');
		assert.throws(() => controller.actions.audioAutomation.setMode('read'), { code: 'DISPOSED' });
		assert.throws(() => controller.actions.audioFreeze.freeze('track'), { code: 'DISPOSED' });
	} finally {
		await controller.dispose().catch(() => undefined);
		await environment.close();
	}
});

function createEnvironment() {
	return createSoundscaperEditorProjectEnvironment({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB(),
			preferOpfs: false,
			storageManager: {
				estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
				persisted: async () => true,
				persist: async () => true,
			} as unknown as StorageManager,
		},
	});
}
