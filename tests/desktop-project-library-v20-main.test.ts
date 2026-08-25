/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	createFramescaperDesktopProjectLibraryV19Handshake,
	createFramescaperDesktopProjectLibraryV19Paths,
} from '../desktop/project-library-v19-contract.ts';
import { FramescaperDesktopProjectLibraryV19Main } from '../desktop/project-library-v19-main.ts';
import {
	createFramescaperDesktopProjectLibraryV20Handshake,
	createFramescaperDesktopProjectLibraryV20Paths,
} from '../desktop/project-library-v20-contract.ts';
import { FramescaperDesktopProjectLibraryV20Main } from '../desktop/project-library-v20-main.ts';
import { framescaperDesktopExactMediaPath } from '../desktop/project-library-exact-generation-storage.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import { reimportFramescaperProjectV31 } from '../src/framescaper/editor-project-v31.ts';

const NOW = '2026-08-25T12:00:00.000Z';

test('V20 reimports settled V19 documents, preserves bodies, and retires its source', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'framescaper-v20-import-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const source = await startV19(appDataPath, 1901, 'v19-source');
	const sourceSession = source.openSession(source.localHandshake);
	const bodyBytes = Uint8Array.of(1, 3, 5, 7, 9, 11);
	const bodySha256 = createHash('sha256').update(bodyBytes).digest('hex');
	const body = Object.freeze({
		kind: 'video-original' as const, encoding: 'framescaper-video-original-v1',
		sourceId: 'legacy-body', storageKey: 'legacy-body', mimeType: 'video/quicktime',
		byteLength: bodyBytes.byteLength, sha256: bodySha256,
	});
	const project = createFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, {
		id: 'v19-lineage-project', title: 'V19 lineage', revision: 0, now: NOW,
		sources: [createVideoSource({
			id: body.sourceId, name: 'Legacy.mov', storageKey: body.storageKey,
			mimeType: body.mimeType, contentSha256: bodySha256,
			sampleFrameCount: 4_000, sampleRate: 48_000, sourceFrameCount: 2,
			frameRate: { num: 24, den: 1 }, width: 1920, height: 1080,
		})],
	});
	const publicationId = 'c2'.repeat(24);
	await sourceSession.beginPublication({
		publicationId, expectedMetadataRevision: 0, expectedProject: null,
		project, bodies: [body],
	});
	await sourceSession.writePublicationChunk({
		publicationId, bodyIndex: 0, offset: 0, bytes: bodyBytes,
	});
	await sourceSession.finishPublication({ publicationId });
	await sourceSession.close();
	await source.close();

	const sourcePaths = createFramescaperDesktopProjectLibraryV19Paths(appDataPath);
	const sourceBodyPath = framescaperDesktopExactMediaPath(sourcePaths, body);
	const sourceDatabaseBytes = await readFile(sourcePaths.databasePath);
	const sourceDatabaseMtime = (await stat(sourcePaths.databasePath)).mtimeMs;
	const sourceBodyMtime = (await stat(sourceBodyPath)).mtimeMs;
	const migrated = await startV20(appDataPath, 2001, 'v20-import');
	const migratedSession = migrated.openSession(migrated.localHandshake);
	const bundle = await migratedSession.readProjectBundle(String(project.id)) as {
		document: string; bodies: readonly unknown[];
	};
	assert.deepEqual(JSON.parse(bundle.document),
		reimportFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, project));
	assert.deepEqual(await migrated.readNativeBody(bundle.bodies[0]), bodyBytes);
	await migratedSession.close();
	await migrated.close();
	assert.deepEqual(await readFile(sourcePaths.databasePath), sourceDatabaseBytes);
	assert.equal((await stat(sourcePaths.databasePath)).mtimeMs, sourceDatabaseMtime);
	assert.equal((await stat(sourceBodyPath)).mtimeMs, sourceBodyMtime);

	const destination = new DatabaseSync(
		createFramescaperDesktopProjectLibraryV20Paths(appDataPath).databasePath,
		{ readOnly: true },
	);
	const progress = destination.prepare(`
		SELECT state, source_project_count AS count, next_project_index AS cursor
		FROM v19_import WHERE singleton = 1
	`).get();
	assert.deepEqual({ ...progress }, { state: 'complete', count: 1, cursor: 1 });
	destination.close();

	const retired = new DatabaseSync(sourcePaths.databasePath);
	retired.prepare(`
		UPDATE library_lease SET active = 1, lease_id = ?, expires_at_ms = ? WHERE singleton = 1
	`).run('ff'.repeat(24), 4_102_444_800_000);
	retired.prepare("UPDATE projects SET title = 'Edited in retired V19'").run();
	retired.close();
	const reopened = await startV20(appDataPath, 2002, 'v20-reopened');
	const reopenedSession = reopened.openSession(reopened.localHandshake);
	const retained = await reopenedSession.readProjectBundle(String(project.id)) as { document: string };
	assert.equal((JSON.parse(retained.document) as { title: string }).title, project.title);
	await reopenedSession.close();
	await reopened.close();
});

function startV19(appDataPath: string, processId: number, instanceId: string) {
	return FramescaperDesktopProjectLibraryV19Main.start({
		appDataPath, owner: { product: 'framescaper', processId, instanceId },
		handshake: createFramescaperDesktopProjectLibraryV19Handshake(),
		onLeaseLost: () => undefined, qualification: null,
	});
}

function startV20(appDataPath: string, processId: number, instanceId: string) {
	return FramescaperDesktopProjectLibraryV20Main.start({
		appDataPath, owner: { product: 'framescaper', processId, instanceId },
		handshake: createFramescaperDesktopProjectLibraryV20Handshake(),
		onLeaseLost: () => undefined, qualification: null,
	});
}
