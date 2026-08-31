/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths,
} from
	'../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

const SOURCE_ID = 'duplicate-cleanup-source';
const SOURCE_PUBLICATION_ID = 'ab'.repeat(24);

interface SourceBundle {
	readonly metadataRevision: number;
	readonly project: Readonly<{ projectRevision: number; sha256: string }>;
}

test('a duplicate metadata race aborts its lifecycle publication before the next duplicate',
	async (context) => {
		const root = await mkdtemp(join(tmpdir(), 'framescaper-duplicate-cleanup-'));
		context.after(() => rm(root, { recursive: true, force: true }));
		const handshake = createFramescaperDesktopProjectLibraryHandshake();
		let advanceMetadataAtMaterialization = false;
		let failAtCommittedCheckpoint = false;
		let raceDatabase: DatabaseSync | null = null;
		const main = await FramescaperDesktopProjectLibraryMain.start({
			appDataPath: root,
			owner: { product: 'framescaper', processId: 981, instanceId: 'duplicate-cleanup' },
			handshake, onLeaseLost: () => undefined,
			testControl: {
				leaseTtlMs: 5_000, renewIntervalMs: 1_000,
				checkpoint: (phase: string) => {
					if (phase === 'committed' && failAtCommittedCheckpoint) {
						failAtCommittedCheckpoint = false;
						throw new Error('injected committed checkpoint failure');
					}
					if (phase !== 'materialized' || !advanceMetadataAtMaterialization) return;
					advanceMetadataAtMaterialization = false;
					assert.ok(raceDatabase);
					raceDatabase.prepare(`
						UPDATE library_identity SET metadata_revision = metadata_revision + 1
						WHERE singleton = 1
					`).run();
				},
			},
		});
		context.after(() => main.close());
		raceDatabase = new DatabaseSync(
			createFramescaperDesktopProjectLibraryPaths(root).databasePath, { timeout: 50 },
		);
		context.after(() => raceDatabase?.close());
		const session = main.openSession(handshake);
		context.after(() => session.close());
		const source = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
			id: SOURCE_ID, title: 'Duplicate source', now: '2026-08-31T12:00:00.000Z',
		});
		await session.beginPublication({
			publicationId: SOURCE_PUBLICATION_ID,
			expectedMetadataRevision: 0, expectedProject: null, project: source, bodies: [],
		});
		await session.finishPublication({ publicationId: SOURCE_PUBLICATION_ID });
		const sourceBundle = await session.readProjectBundle(SOURCE_ID) as SourceBundle;
		const request = (bundle: SourceBundle, copyProjectId: string,
			title: string, timestamp: string) => ({
			sourceProjectId: SOURCE_ID, copyProjectId, title, timestamp,
			expectedMetadataRevision: bundle.metadataRevision,
			expectedSource: {
				projectRevision: bundle.project.projectRevision,
				projectSha256: bundle.project.sha256,
			},
		});

		advanceMetadataAtMaterialization = true;
		await assert.rejects(session.duplicateProject(request(sourceBundle,
			'duplicate-cleanup-failed', 'Failed copy', '2026-08-31T12:01:00.000Z',
		)), /metadata changed before publication/u);
		const refreshedBundle = await session.readProjectBundle(SOURCE_ID) as SourceBundle;
		const result = await session.duplicateProject(request(refreshedBundle,
			'duplicate-cleanup-retry', 'Retry copy', '2026-08-31T12:02:00.000Z',
		)) as Readonly<{ project: Readonly<{ projectId: string }> }>;

		assert.equal(result.project.projectId, 'duplicate-cleanup-retry');
		assert.ok(await session.readProjectBundle('duplicate-cleanup-retry'));

		await context.test('a committed checkpoint failure releases the writer latch', async () => {
			const committedBundle = await session.readProjectBundle(SOURCE_ID) as SourceBundle;
			failAtCommittedCheckpoint = true;
			await assert.rejects(session.duplicateProject(request(committedBundle,
				'duplicate-cleanup-committed', 'Committed copy', '2026-08-31T12:03:00.000Z',
			)), /injected committed checkpoint failure/u);
			const committedJournal = raceDatabase?.prepare(`
				SELECT state FROM publication_journal WHERE project_id = ?
			`).get('duplicate-cleanup-committed') as Readonly<{ state?: unknown }> | undefined;
			assert.equal(committedJournal, undefined);

			const afterCommittedBundle = await session.readProjectBundle(SOURCE_ID) as SourceBundle;
			const afterCommitted = await session.duplicateProject(request(afterCommittedBundle,
				'duplicate-cleanup-after-committed', 'After committed copy', '2026-08-31T12:04:00.000Z',
			)) as Readonly<{ project: Readonly<{ projectId: string }> }>;
			assert.equal(afterCommitted.project.projectId, 'duplicate-cleanup-after-committed');
		});
	});
