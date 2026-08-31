/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths,
} from '../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { framescaperDesktopExactMediaPath } from
	'../desktop/project-library-exact-generation-storage.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';

const PUBLICATION_ID = 'bc'.repeat(24);

test('a failed publication reclaims newly materialized unreferenced body files', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-body-reclamation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	let advanceMetadataAtMaterialization = false;
	let raceDatabase: DatabaseSync | null = null;
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 982, instanceId: 'body-reclamation' },
		handshake, onLeaseLost: () => undefined,
		testControl: {
			leaseTtlMs: 5_000, renewIntervalMs: 1_000,
			checkpoint: (phase: string) => {
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
	const bytes = new TextEncoder().encode('newly materialized video body');
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const storageKey = `media-sha256:${sha256}`;
	const source = createVideoSource({
		id: 'body-source', name: 'body.mp4', storageKey, mimeType: 'video/mp4',
		contentSha256: sha256, sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 640, height: 360, videoCodec: 'h264',
	});
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'body-reclamation-project', title: 'Body reclamation',
		now: '2026-08-31T13:00:00.000Z', sources: [source],
	});
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
		sourceId: storageKey, storageKey, mimeType: 'video/mp4',
		byteLength: bytes.byteLength, sha256,
	});
	const admission = await session.beginPublication({
		publicationId: PUBLICATION_ID, expectedMetadataRevision: 0,
		expectedProject: null, project, bodies: [body],
	}) as Readonly<{ requiredBodyIndexes: readonly number[] }>;
	assert.deepEqual(admission.requiredBodyIndexes, [0]);
	await session.writePublicationChunk({
		publicationId: PUBLICATION_ID, bodyIndex: 0, offset: 0, bytes,
	});
	advanceMetadataAtMaterialization = true;
	await assert.rejects(session.finishPublication({ publicationId: PUBLICATION_ID }),
		/metadata changed before publication/u);

	const bodyPath = framescaperDesktopExactMediaPath(
		createFramescaperDesktopProjectLibraryPaths(root), body,
	);
	await assert.rejects(stat(bodyPath), (error: unknown) =>
		(error as NodeJS.ErrnoException).code === 'ENOENT');
});

test('startup recovery reclaims body files recorded by an interrupted publication', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-body-recovery-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const initialized = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 983, instanceId: 'body-schema' },
		handshake, onLeaseLost: () => undefined, testControl: null,
	});
	await initialized.close();
	const paths = createFramescaperDesktopProjectLibraryPaths(root);
	const sha256 = createHash('sha256').update('interrupted body').digest('hex');
	const storageKey = `media-sha256:${sha256}`;
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
		sourceId: storageKey, storageKey, mimeType: 'video/mp4', byteLength: 16, sha256,
	});
	const bodyPath = framescaperDesktopExactMediaPath(paths, body);
	const documentFile = `${'d'.repeat(48)}/0-${'e'.repeat(64)}.json`;
	const documentPath = join(paths.projectsRoot, documentFile);
	await Promise.all([mkdir(dirname(bodyPath), { recursive: true }), mkdir(dirname(documentPath), { recursive: true })]);
	await Promise.all([writeFile(bodyPath, 'interrupted body'), writeFile(documentPath, '{}')]);
	const database = new DatabaseSync(paths.databasePath);
	database.exec('BEGIN IMMEDIATE');
	database.prepare(`
		INSERT INTO publication_journal (
			publication_id, state, project_id, project_revision, project_sha256,
			document_file, expected_metadata_revision, result_json,
			lease_id, fencing_token, created_at_ms, updated_at_ms
		) VALUES (?, 'materialized', ?, 0, ?, ?, 0, NULL, ?, 1, 1, 1)
	`).run('de'.repeat(24), 'interrupted-project', 'e'.repeat(64), documentFile, 'stale-lease');
	database.prepare(`
		INSERT INTO publication_body_journal (publication_id, body_file, body_kind, storage_key)
		VALUES (?, ?, ?, ?)
	`).run('de'.repeat(24), relative(paths.managedMediaRoot, bodyPath), body.kind, body.storageKey);
	database.exec('COMMIT');
	database.close();

	const recovered = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 984, instanceId: 'body-recovery' },
		handshake, onLeaseLost: () => undefined, testControl: null,
	});
	context.after(() => recovered.close());
	assert.equal(recovered.snapshot().writer.recovery.outcome, 'discarded');
	for (const path of [bodyPath, documentPath]) {
		await assert.rejects(stat(path), (error: unknown) =>
			(error as NodeJS.ErrnoException).code === 'ENOENT');
	}
});
