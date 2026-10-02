/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSaveService } from '../src/common/editor/controller/document/project-save-service.ts';
import { admitProjectPublication } from '../src/common/editor/storage/project-publication-options.ts';

function fixture(confirm: () => Promise<boolean>) {
	let project = { id: 'project', schemaVersion: 9, revision: 1, title: 'Large project' };
	let timer: (() => void) | undefined;
	let writes = 0;
	const store = { backend: 'memory', maximumProjectDocumentBytes: 1,
		ready: async () => undefined, estimateStorage: async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }) };
	const service = createProjectSaveService({
		getProject: () => project, hasHistory: () => true, isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }), confirmFileSizeWarning: confirm,
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot, options) => { await admitProjectPublication(store, snapshot, options); writes += 1; },
		persistActiveProjectId: async () => undefined, isCurrentProject: (id) => project.id === id,
		hasSessionTab: () => true, markProjectSaved: () => undefined, publish: () => undefined,
		garbageCollect: async () => undefined, refreshStorageUsage: async () => undefined,
		handleError: () => undefined, scheduleTimer: (callback) => { timer = callback; return 1; }, clearTimer: () => undefined,
	});
	return { service, writes: () => writes,
		runAutosave: () => { service.scheduleAutosave(); timer?.(); return service.drain(); },
		switchProject: () => { project = { ...project, id: 'different-project' }; } };
}

test('manual save can show a size warning while autosave and terminal flush never open one', async () => {
	let prompts = 0;
	const original = fixture(async () => { prompts += 1; return true; });
	await assert.rejects(original.runAutosave(), /confirmation is required/);
	assert.equal(prompts, 0); assert.equal(original.writes(), 0);
	await original.service.flushProject({ allowFileSizeWarning: true });
	assert.equal(prompts, 1); assert.equal(original.writes(), 1);
	await original.runAutosave();
	assert.equal(prompts, 1); assert.equal(original.writes(), 2);
	const closing = fixture(async () => { prompts += 1; return true; });
	await assert.rejects(closing.service.terminalFlush(), /confirmation is required/);
	assert.equal(prompts, 1); assert.equal(closing.writes(), 0);
});

test('manual save warning approval is discarded after project ownership changes', async () => {
	let approve!: (value: boolean) => void;
	const pending = new Promise<boolean>((resolve) => { approve = resolve; });
	const original = fixture(() => pending);
	const saving = original.service.flushProject({ allowFileSizeWarning: true });
	assert.ok(saving);
	await new Promise<void>((resolve) => setImmediate(resolve));
	original.switchProject(); approve(true);
	await assert.rejects(saving, { name: 'AbortError' });
	assert.equal(original.writes(), 0);
});
