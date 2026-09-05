/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDeferredEditorExportService,
	type DeferredEditorExportModule,
} from '../src/common/editor/controller/deferred-export-service.ts';

type ExportFacade = ReturnType<typeof createDeferredEditorExportService>;

function deferredExportService(available = true) {
	let loads = 0;
	const calls: unknown[][] = [];
	const runtime = {
		options: {}, sourceBuffers: new Map(), taskProgress: null,
		createCacheAwareRenderEngine: () => ({}), prepareCommittedTimePitchCaches: () => undefined,
		throwIfAborted: () => undefined, updateExportProgress: () => undefined,
	} as unknown as Parameters<typeof createDeferredEditorExportService>[0];
	const facade: ExportFacade = createDeferredEditorExportService(runtime, async () => {
		loads += 1;
		return {
			createEditorExportService: () => ({
				handleExportAction: async (...args: unknown[]) => { calls.push(['handle', ...args]); return 'handled'; },
				persistentAudioDeliveryAvailable: () => available,
				whenPersistentAudioDeliveryAvailable: async () => { calls.push(['when']); },
			}),
		} as unknown as DeferredEditorExportModule;
	});
	return { facade, calls, loads: () => loads };
}

test('persistent delivery availability answers synchronously without loading the export slice', () => {
	const { facade, loads } = deferredExportService();
	const answer: boolean = facade.persistentAudioDeliveryAvailable();
	assert.equal(answer, true);
	assert.equal(loads(), 0);
});

test('waiting for an idle exporter does not pull the delivery slice into the boot path', async () => {
	const { facade, calls, loads } = deferredExportService();
	await facade.whenPersistentAudioDeliveryAvailable();
	assert.equal(loads(), 0);
	assert.deepEqual(calls, []);
});

test('a requested but unsettled export slice reports delivery busy', async () => {
	const { facade, loads } = deferredExportService(false);
	const pending = facade.handleExportAction('start');
	assert.equal(facade.persistentAudioDeliveryAvailable(), false);
	assert.equal(await pending, 'handled');
	assert.equal(facade.persistentAudioDeliveryAvailable(), false);
	assert.equal(loads(), 1);
});

test('a loaded export service answers availability and waiting itself', async () => {
	const { facade, calls } = deferredExportService(true);
	await facade.handleExportAction('start');
	assert.equal(facade.persistentAudioDeliveryAvailable(), true);
	await facade.whenPersistentAudioDeliveryAvailable();
	assert.deepEqual(calls, [['handle', 'start'], ['when']]);
});
