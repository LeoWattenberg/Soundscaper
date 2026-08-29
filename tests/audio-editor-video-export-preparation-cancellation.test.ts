/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorExportService,
	type ExportServiceRuntime,
} from '../src/common/editor/controller/export-service.ts';

test('cancelling video export during live-state preparation prevents late project access', async () => {
	const preparation = deferred();
	const started = deferred();
	let projectReads = 0;
	let taskStarts = 0;
	const state = {
		exportGeneration: 0,
		exportAbort: null,
		disposed: false,
	};
	const service = createEditorExportService({
		state,
		fileService: { isDesktop: false },
		prepareProjectForExport: async (purpose: string) => {
			assert.equal(purpose, 'video-export');
			started.resolve();
			await preparation.promise;
		},
		getProject: () => {
			projectReads += 1;
			throw new Error('A cancelled video export read the project late.');
		},
		lifetime: {
			startTask: () => {
				taskStarts += 1;
				throw new Error('A cancelled video export started a task late.');
			},
		},
		publishDocumentSnapshot: () => undefined,
		toggleExport: () => undefined,
	} as ExportServiceRuntime);

	const pending = service.handleExportAction('export', { format: 'video-mp4' });
	await started.promise;
	await service.handleExportAction('cancel');
	preparation.resolve();

	assert.equal(await pending, null);
	assert.equal(projectReads, 0);
	assert.equal(taskStarts, 0);
	assert.equal(state.exportAbort, null);
});

function deferred() {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}
