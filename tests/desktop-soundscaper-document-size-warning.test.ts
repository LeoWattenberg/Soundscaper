/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SoundscaperDesktopDocumentSizeAdmission, soundscaperDocumentPublicationGuard } from '../desktop/soundscaper-project-library-document-size-warning.ts';
import { emptySoundscaperDesktopLibraryMetadata, validateSoundscaperDesktopLibraryMetadata } from '../desktop/soundscaper-project-library-metadata.ts';
import { DatabaseSync } from 'node:sqlite';
import { initializeSoundscaperDesktopProjectLibraryDatabase } from '../desktop/soundscaper-project-library-database.ts';
import { SoundscaperDesktopProjectLibraryCatalog } from '../desktop/soundscaper-project-library-catalog.ts';
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import { planSoundscaperDesktopProjectLibraryPublication } from '../desktop/soundscaper-project-library-publication-contract.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const threshold = 256 * 1024 * 1024;
const project = { projectId: 'project', name: 'Project', byteLength: threshold + 1 };

test('native document approval is scoped to one project and its admitted byte bound', async () => {
	let prompts = 0;
	const admission = new SoundscaperDesktopDocumentSizeAdmission(async (warning) => {
		assert.equal(warning.thresholdBytes, threshold); prompts += 1; return true;
	});
	await admission.admit(project, [], () => {});
	await admission.admit(project, [], () => {});
	assert.equal(prompts, 1);
	await admission.admit({ ...project, byteLength: project.byteLength + 1 }, [], () => {});
	await admission.admit({ ...project, projectId: 'another' }, [], () => {});
	assert.equal(prompts, 3);
});

test('native document cancellation and stale authority never admit a larger document', async () => {
	const canceled = new SoundscaperDesktopDocumentSizeAdmission(async () => false);
	await assert.rejects(canceled.admit(project, [], () => {}), { name: 'AbortError' });
	let current = true, prompts = 0;
	const stale = new SoundscaperDesktopDocumentSizeAdmission(async () => { prompts += 1; current = false; return true; });
	const assertCurrent = () => { if (!current) throw new Error('Writer authority changed'); };
	await assert.rejects(stale.admit(project, [], assertCurrent), /authority changed/);
	current = true;
	await assert.rejects(stale.admit(project, [], assertCurrent), /authority changed/);
	assert.equal(prompts, 2);
});

test('persisted admitted documents reuse their bound while larger native writes still require approval', async () => {
	const admission = new SoundscaperDesktopDocumentSizeAdmission();
	await admission.admit(project, [project], () => {});
	await assert.rejects(admission.admit({ ...project, byteLength: project.byteLength + 1 }, [project], () => {}),
		{ code: 'FILE_SIZE_WARNING' });
});

test('desktop metadata preserves approved large document descriptors and rejects unsafe byte lengths', () => {
	const id = 'a'.repeat(48), sha256 = 'b'.repeat(64);
	const row = { ...project, id, metadataFile: `${id}/0-${sha256}.json`, preferredProduct: 'soundscaper',
		updatedAtMs: 0, schemaFamily: 'soundscaper', schemaVersion: 1, projectRevision: 0, sha256 };
	assert.equal(validateSoundscaperDesktopLibraryMetadata({ ...emptySoundscaperDesktopLibraryMetadata(), projects: [row] })
		.projects[0]?.byteLength, project.byteLength);
	assert.throws(() => validateSoundscaperDesktopLibraryMetadata({ ...emptySoundscaperDesktopLibraryMetadata(),
		projects: [{ ...row, byteLength: Number.MAX_SAFE_INTEGER + 1 }] }), /safe integer/);
});

test('native approval revalidates the live publication lease before any stage or journal is written', async (context) => {
	const database = new DatabaseSync(':memory:'); context.after(() => { database.close(); });
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	let now = 0;
	const catalog = SoundscaperDesktopProjectLibraryCatalog.create({ database, now: () => now,
		owner: { product: 'soundscaper', processId: 1, instanceId: 'warning-owner' }, randomId: () => '1'.repeat(48) });
	catalog.acceptHandshake(createSoundscaperDesktopProjectLibraryHandshake());
	const lease = catalog.acquireLease({ ttlMs: 1_000 });
	const plan = planSoundscaperDesktopProjectLibraryPublication({ lease, expectedMetadataRevision: 0,
		expectedProject: null, project: createSoundscaperProject({ id: 'project', title: 'Project' }), bodies: [] },
		emptySoundscaperDesktopLibraryMetadata(), '2'.repeat(48), now, []);
	const admission = new SoundscaperDesktopDocumentSizeAdmission(async () => { now = lease.expiresAtMs; return true; });
	await assert.rejects(admission.admit({ ...plan.bundle.project, byteLength: threshold + 1 }, [],
		soundscaperDocumentPublicationGuard(database, plan, () => now)), /lease/);
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM publication_journal').get()?.count, 0);
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_revisions').get()?.count, 0);
});
