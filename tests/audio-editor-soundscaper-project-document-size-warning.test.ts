/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	admitSoundscaperDesktopPublication,
	rendererPublicationRequest,
} from '../src/soundscaper/desktop-project-library-publication-warning.ts';
import { admitSoundscaperDesktopStorePublication } from '../src/soundscaper/desktop-project-library-store-publication.ts';
import { validateSoundscaperDesktopBundle } from '../src/soundscaper/desktop-project-library-renderer-contract.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/soundscaper/editor-project-runtime-profile.ts';

const project = createSoundscaperProject({ id: 'document-warning', title: 'Project' });
const threshold = 256 * 1024 ** 2;

test('desktop document approval admits exact bytes above the former cap', async () => {
	const request = rendererPublicationRequest(PROFILE, { project });
	let prompts = 0;
	await admitSoundscaperDesktopPublication({ ...request, documentByteLength: threshold + 1,
		confirmFileSizeWarning: async (warning) => {
			prompts += 1;
			assert.deepEqual(warning, { label: 'Project document', byteLength: threshold + 1, thresholdBytes: threshold });
			return true;
		} });
	assert.equal(prompts, 1);
	await assert.rejects(admitSoundscaperDesktopPublication({ ...request, documentByteLength: threshold + 1 }),
		(error: unknown) => (error as { code?: string }).code === 'FILE_SIZE_WARNING');
});

test('desktop document cancellation and stale approval prevent publication admission', async () => {
	const request = rendererPublicationRequest(PROFILE, { project });
	await assert.rejects(admitSoundscaperDesktopPublication({ ...request, documentByteLength: threshold + 1,
		confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	let current = true;
	await assert.rejects(admitSoundscaperDesktopPublication({ ...request, documentByteLength: threshold + 1,
		assertCurrent: () => { if (!current) throw new Error('Stale project'); },
		confirmFileSizeWarning: async () => { current = false; return true; } }), /Stale project/);
});

test('desktop publication requests keep warning options closed and snapshot caller data', () => {
	const signal = new AbortController().signal;
	const confirmFileSizeWarning = async () => true;
	const request = rendererPublicationRequest(PROFILE, { project, signal, confirmFileSizeWarning });
	assert.equal(request.signal, signal);
	assert.equal(request.confirmFileSizeWarning, confirmFileSizeWarning);
	assert.equal(request.documentByteLength, new TextEncoder().encode(request.document).byteLength);
	assert.throws(() => rendererPublicationRequest(PROFILE, { project, approved: true }), /unsupported/);
	assert.throws(() => rendererPublicationRequest(PROFILE, { project, confirmFileSizeWarning: true }), /function/);
	assert.throws(() => rendererPublicationRequest(PROFILE, { project, assertCurrent: true }), /function/);
});

test('store publication approval is scoped to the exact measured project and retains cancellation', async () => {
	const store = { backend: 'memory', maximumProjectDocumentBytes: 1,
		ready: async () => undefined, estimateStorage: async () => ({}) };
	let prompts = 0;
	const options = await admitSoundscaperDesktopStorePublication(store, PROFILE, project,
		{ confirmFileSizeWarning: async () => { prompts += 1; return true; } });
	const request = rendererPublicationRequest(PROFILE, { project, ...options });
	assert.equal(await options.confirmFileSizeWarning?.({ label: 'Project document',
		byteLength: request.documentByteLength, thresholdBytes: threshold }), true);
	assert.equal(await options.confirmFileSizeWarning?.({ label: 'Project document',
		byteLength: request.documentByteLength + 1, thresholdBytes: threshold }), false);
	assert.equal(await options.confirmFileSizeWarning?.({ label: 'Another file',
		byteLength: request.documentByteLength, thresholdBytes: threshold }), false);
	assert.equal(prompts, 1);
	assert.throws(() => rendererPublicationRequest(PROFILE, { project: { ...project, title: 'Projecx' }, ...options }),
		/exact store publication approval/, 'an equal-length changed document cannot reuse this operation approval');
	const automatic = await admitSoundscaperDesktopStorePublication(store, PROFILE, project);
	assert.equal(await automatic.confirmFileSizeWarning?.({ label: 'Project document',
		byteLength: request.documentByteLength, thresholdBytes: threshold }), true);
	await assert.rejects(admitSoundscaperDesktopStorePublication(store, PROFILE,
		{ ...project, title: 'A larger document' }), /confirmation is required/);
	const abort = new AbortController();
	const canceled = await admitSoundscaperDesktopStorePublication(store, PROFILE, project, { signal: abort.signal });
	abort.abort();
	await assert.rejects(admitSoundscaperDesktopPublication({ ...request, ...canceled, signal: canceled.signal ?? undefined }), { name: 'AbortError' });
});

test('approved large desktop document metadata still requires exact bytes and digest', () => {
	const digest = 'a'.repeat(64);
	assert.throws(() => validateSoundscaperDesktopBundle(PROFILE, {
		metadataRevision: 1,
		project: { id: 'documentwarning', projectId: project.id, name: project.title,
			metadataFile: `documentwarning/0-${digest}.json`, preferredProduct: 'soundscaper',
			updatedAtMs: 0, schemaFamily: 'soundscaper', schemaVersion: 1, projectRevision: 0,
			byteLength: threshold + 1, sha256: digest },
		document: '{}', bodies: [],
	}, String(project.id)), /changed bytes or digest/);
});
