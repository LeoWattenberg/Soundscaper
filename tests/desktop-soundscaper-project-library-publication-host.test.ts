/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SoundscaperDesktopProjectLibraryCatalog } from '../desktop/soundscaper-project-library-catalog.ts';
import { createSoundscaperDesktopProjectLibraryHandshake } from '../desktop/soundscaper-project-library-contract.ts';
import { initializeSoundscaperDesktopProjectLibraryDatabase } from '../desktop/soundscaper-project-library-database.ts';
import { SoundscaperDesktopProjectLibraryPublicationHost } from '../desktop/soundscaper-project-library-publication-host.ts';
import type {
	SoundscaperDesktopProjectLibraryPublicationCheckpoint,
} from '../desktop/soundscaper-project-library-publication-contract.ts';
import type { SoundscaperDesktopProjectLibraryLease } from '../desktop/soundscaper-project-library-persistence-codecs.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('lease loss preserves an aborted publication journal and stages for takeover recovery', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-publication-lease-loss-'));
	const database = new DatabaseSync(':memory:');
	context.after(async () => {
		database.close();
		await rm(appDataPath, { recursive: true, force: true });
	});
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	let nowMs = 0;
	const firstCatalog = catalog(database, 'first-owner', '1'.repeat(48), () => nowMs);
	const takeoverCatalog = catalog(database, 'takeover-owner', '2'.repeat(48), () => nowMs);
	firstCatalog.acceptHandshake(handshake);
	takeoverCatalog.acceptHandshake(handshake);
	const firstLease = firstCatalog.acquireLease({ ttlMs: 1_000 });
	const controller = new AbortController();
	let takeoverLease: SoundscaperDesktopProjectLibraryLease | null = null;
	const ids = ['3'.repeat(48), '4'.repeat(48)];
	const host = SoundscaperDesktopProjectLibraryPublicationHost.create({
		database,
		appDataPath,
		now: () => nowMs,
		randomId: () => {
			const id = ids.shift();
			if (id === undefined) throw new Error('Publication id fixture was exhausted');
			return id;
		},
		checkpoint: (phase: SoundscaperDesktopProjectLibraryPublicationCheckpoint) => {
			if (phase !== 'prepared' || takeoverLease !== null) return;
			nowMs = firstLease.expiresAtMs;
			takeoverLease = takeoverCatalog.acquireLease({ ttlMs: 1_000 });
			controller.abort(new Error('Simulated publication lease loss'));
		},
	});
	host.acceptHandshake(handshake);
	const project = createSoundscaperProject({
		id: 'lease-loss-publication',
		title: 'Lease loss publication',
	});

	await assert.rejects(host.publish({
		lease: firstLease,
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: [],
	}, controller.signal), /simulated publication lease loss/iu);

	assert.notEqual(takeoverLease, null);
	const pending = database.prepare(`
		SELECT state, stages_json AS stagesJson
		FROM publication_journal WHERE state IN ('prepared', 'materialized')
	`).get() as { state: string; stagesJson: string } | undefined;
	assert.equal(pending?.state, 'prepared');
	const [stage] = JSON.parse(pending?.stagesJson ?? '[]') as [{
		stageRelativeFile: string;
		finalRelativeFile: string;
	}];
	const stagePath = join(host.paths.libraryRoot, stage.stageRelativeFile);
	await access(stagePath);

	const recovery = await host.recover({ lease: takeoverLease });

	assert.equal(recovery.outcome, 'committed');
	assert.equal(recovery.projectId, project.id);
	assert.equal(database.prepare(
		"SELECT state FROM publication_journal WHERE state = 'complete'",
	).get()?.state, 'complete');
	await access(join(host.paths.libraryRoot, stage.finalRelativeFile));
	await assert.rejects(access(stagePath), { code: 'ENOENT' });
});

function catalog(
	database: DatabaseSync,
	instanceId: string,
	leaseId: string,
	now: () => number,
): SoundscaperDesktopProjectLibraryCatalog {
	return SoundscaperDesktopProjectLibraryCatalog.create({
		database,
		owner: { product: 'soundscaper', processId: 1, instanceId },
		now,
		randomId: () => leaseId,
	});
}
