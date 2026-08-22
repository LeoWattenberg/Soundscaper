/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createFramescaperDesktopProjectLibraryV10Handshake } from '../desktop/project-library-v10-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV12Handshake,
	createFramescaperDesktopProjectLibraryV12Paths,
} from '../desktop/project-library-v12-contract.ts';
import { FramescaperDesktopProjectLibraryV12Main } from '../desktop/project-library-v12-main.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';

const NOW = '2026-08-22T12:00:00.000Z';

test('Framescaper desktop V12 persists exact V20 and refuses historical handshakes/projects', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v12-main-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const owner = { product: 'framescaper' as const, processId: 2020, instanceId: 'framescaper-v12-main' };
	const handshake = createFramescaperDesktopProjectLibraryV12Handshake();
	const first = await FramescaperDesktopProjectLibraryV12Main.start({ appDataPath, owner, handshake });
	context.after(() => first.close());
	assert.deepEqual(first.localHandshake, handshake);
	assert.throws(() => first.openSession(createFramescaperDesktopProjectLibraryV10Handshake()), /V12 handshake/iu);
	const session = first.openSession(handshake);
	const project = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v12-roundtrip', title: 'Framescaper V12 roundtrip', revision: 0, now: NOW,
	});
	const admission = await session.beginPublication({
		publicationId: 'ab'.repeat(24),
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: [],
	});
	assert.deepEqual(admission, {
		publicationId: 'ab'.repeat(24), maximumChunkBytes: 4 * 1024 * 1024, bodyCount: 0,
	});
	const bundle = await session.finishPublication({ publicationId: admission.publicationId }) as {
		metadataRevision: number;
		project: { projectSchemaVersion: number; projectId: string; projectRevision: number; sha256: string };
		document: string;
		bodies: readonly unknown[];
	};
	assert.equal(bundle.project.projectSchemaVersion, 20);
	assert.equal(bundle.project.projectId, project.id);
	assert.equal(bundle.metadataRevision, 1);
	assert.deepEqual(JSON.parse(bundle.document), project);
	const oldProject = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'framescaper-v18-refusal', title: 'Re-import me', revision: 0, now: NOW,
	});
	await assert.rejects(() => session.beginPublication({
		publicationId: 'cd'.repeat(24), expectedMetadataRevision: 1,
		expectedProject: null, project: oldProject, bodies: [],
	}), /schema version: 18/iu);
	await session.close();
	await first.close();

	const paths = createFramescaperDesktopProjectLibraryV12Paths(appDataPath);
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	assert.equal(Number(database.prepare('PRAGMA user_version').get()?.user_version), 14);
	assert.equal(Number(database.prepare('SELECT schema_version FROM library_identity').get()?.schema_version), 12);
	database.close();

	const second = await FramescaperDesktopProjectLibraryV12Main.start({
		appDataPath,
		owner: { ...owner, processId: 2021, instanceId: 'framescaper-v12-reopen' },
		handshake,
	});
	context.after(() => second.close());
	const reopened = second.openSession(handshake);
	const readback = await reopened.readProjectBundle(project.id);
	assert.deepEqual(readback, bundle);
	assert.deepEqual(await reopened.listProjects(), {
		metadataRevision: 1,
		projects: [{ id: project.id, title: project.title, revision: 0, updatedAt: NOW }],
	});
	const duplicate = await reopened.duplicateProject({
		sourceProjectId: project.id,
		copyProjectId: 'framescaper-v12-roundtrip-copy',
		title: 'Framescaper V12 roundtrip copy',
		timestamp: '2026-08-23T12:00:00.000Z',
		expectedMetadataRevision: 1,
		expectedSource: {
			projectRevision: bundle.project.projectRevision,
			projectSha256: bundle.project.sha256,
		},
	}) as { project: { projectId: string; projectSchemaVersion: number }; metadataRevision: number };
	assert.equal(duplicate.metadataRevision, 2);
	assert.equal(duplicate.project.projectId, 'framescaper-v12-roundtrip-copy');
	assert.equal(duplicate.project.projectSchemaVersion, 20);
	await reopened.close();
	await second.close();
});
