/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	bindSoundscaperPersistentDeliveryRuntime,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-runtime-binding.ts';

test('the closed common export seam binds one immutable Soundscaper delivery runtime', () => {
	let received: unknown = null;
	const runtime = {
		exportService: {
			derivePersistentAudioDeliveryPlan: async () => ({ settings: {}, exportPlan: {} }),
			executePersistentAudioDeliveryPlan: async () => ({}),
			persistentAudioDeliveryAvailable: () => true,
			whenPersistentAudioDeliveryAvailable: async () => undefined,
		},
		getProject: () => null,
		getSaveState: () => 'saved',
		captureProjectGeneration: () => Object.freeze({ generation: 1, projectId: 'project' }),
		assertProjectGeneration: () => undefined,
		deliveryReport: () => null,
		cancelExport: () => undefined,
		publishDocumentSnapshot: () => undefined,
	};
	bindSoundscaperPersistentDeliveryRuntime({
		bindSoundscaperPersistentDeliveryRuntime: (value: unknown) => { received = value; },
	}, runtime);
	assert.ok(received && Object.isFrozen(received));
	assert.throws(() => bindSoundscaperPersistentDeliveryRuntime(Object.defineProperty({},
		'bindSoundscaperPersistentDeliveryRuntime', { enumerable: true, get: () => () => undefined }), runtime),
	/own function/iu);
});

test('production wiring selects persistence only inside the Soundscaper product owner', async () => {
	const [common, soundscaper, framescaper] = await Promise.all([
		readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/soundscaper/editor-controller.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/framescaper/editor-controller.ts', import.meta.url), 'utf8'),
	]);
	assert.match(common, /bindSoundscaperPersistentDeliveryRuntime\(options,/u);
	assert.match(common, /cancelExport: cancelPersistentAudioDelivery/u);
	assert.doesNotMatch(common, /cancelExport:\s*\(\)\s*=>\s*handleExportAction\('cancel'\)/u);
	assert.match(soundscaper, /createSoundscaperPersistentDeliveryControllerComposition/u);
	assert.match(soundscaper, /persistentDelivery/u);
	assert.doesNotMatch(framescaper, /PersistentDelivery|persistentDelivery/u);
});
