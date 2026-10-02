/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitProjectPublication, projectPublicationWarningOptions } from '../src/common/editor/storage/project-publication-options.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const project = createCurrentAudioEditorProject({ id: 'large-project', title: 'Project' });

test('desktop publication forwards only validated warning fields', () => {
	const confirmation = async () => true;
	const assertCurrent = () => undefined;
	assert.deepEqual(projectPublicationWarningOptions({ confirmFileSizeWarning: confirmation, assertCurrent,
		signal: null, protectedLinkedVideoSourceIds: ['source'] }), { confirmFileSizeWarning: confirmation, assertCurrent, signal: null });
	assert.throws(() => projectPublicationWarningOptions({ signal: {} }), /AbortSignal/);
});

function store(backend = 'memory', quota = Number.MAX_SAFE_INTEGER) {
	return { backend, maximumProjectDocumentBytes: 1,
		ready: async () => undefined, estimateStorage: async () => ({ quota, usage: 0 }) };
}

test('project publication admits a user-approved document while automatic saves reuse only its byte bound', async () => {
	const storage = store();
	let prompts = 0;
	const options = { confirmFileSizeWarning: async () => { prompts += 1; return true; } };
	await admitProjectPublication(storage, project, options);
	await admitProjectPublication(storage, project);
	assert.equal(prompts, 1);
	await admitProjectPublication(storage, project, options);
	assert.equal(prompts, 2, 'a later explicit operation makes its own decision');
	await assert.rejects(admitProjectPublication(storage, { ...project, title: 'Project with a larger title' }),
		(error: unknown) => (error as { code?: string }).code === 'FILE_SIZE_WARNING');
	await assert.rejects(admitProjectPublication(storage, { ...project, id: 'different-project' }),
		(error: unknown) => (error as { code?: string }).code === 'FILE_SIZE_WARNING');
});

test('project size cancellation and stale approval prevent publication admission', async () => {
	const storage = store();
	let capacityChecks = 0;
	await assert.rejects(admitProjectPublication(storage, project, { confirmFileSizeWarning: async () => false,
		admitProjectPublication: () => { capacityChecks += 1; } }), { name: 'AbortError' });
	assert.equal(capacityChecks, 0);
	const abort = new AbortController();
	await assert.rejects(admitProjectPublication(storage, project, { signal: abort.signal,
		confirmFileSizeWarning: async () => { abort.abort(); return true; } }), { name: 'AbortError' });
	await assert.rejects(admitProjectPublication(storage, project), /confirmation is required/);
});

test('approved project document sizes remain subject to actual publication storage capacity', async () => {
	await assert.rejects(admitProjectPublication(store('indexeddb', 1), project,
		{ confirmFileSizeWarning: async () => true }), (error: unknown) => (
		(error as { code?: string }).code === 'QUOTA_EXCEEDED'));
});
