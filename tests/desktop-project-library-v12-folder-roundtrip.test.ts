/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	DESKTOP_LIBRARY_SCHEMA_VERSION,
	createDesktopProjectLibraryPaths,
} from '../desktop/project-library-contract.ts';
import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';

const NOW = '2026-08-09T20:00:00.000Z';

test('fresh desktop library V8 saves and reopens current folder hierarchy byte-exactly', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'scape-v13-folder-desktop-'));
	context.after(() => rm(appDataPath, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataPath);
	const project = createCurrentAudioEditorProject({
		id: 'desktop-folder-project',
		title: 'Desktop folder project',
		revision: 1,
		now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'track-a', name: 'Track A', locked: true }),
			createAudioTrackV10({ id: 'track-b', name: 'Track B' }),
		],
		trackFolders: [
			{ id: 'folder-a', name: 'Folder A', collapsed: true, height: 72 },
			{ id: 'folder-b', name: 'Folder B', hidden: true, solo: true },
		],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'folder-a', parentFolderId: null },
				{ kind: 'track', id: 'track-a', parentFolderId: 'folder-a' },
				{ kind: 'folder', id: 'folder-b', parentFolderId: 'folder-a' },
				{ kind: 'track', id: 'track-b', parentFolderId: 'folder-b' },
			],
		}],
	});
	const document = serializeScapeProjectDocument(project);
	const firstHost = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 101, instanceId: 'desktop-v12-folder-writer' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => firstHost.close());
	const firstService = new DesktopSharedProjectLibraryService(firstHost, {
		createEntryId: () => 'desktop-folder-entry',
		now: () => Date.parse(NOW),
	});
	assert.deepEqual(await firstService.commitSharedProject({ document, expectedRevision: null }), {
		status: 'committed',
		document,
	});
	assert.equal(DESKTOP_LIBRARY_SCHEMA_VERSION, 8);
	assert.equal(DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION, 16);
	assert.equal(firstHost.readCatalog().schemaVersion, DESKTOP_LIBRARY_SCHEMA_VERSION);
	assert.equal(
		firstHost.readCatalog().projects[0]?.projectSchemaVersion,
		DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	);
	const database = new DatabaseSync(paths.databasePath, { readOnly: true });
	assert.equal(Number(database.prepare('PRAGMA user_version').get()?.user_version), 10);
	database.close();
	await firstHost.close();

	const secondHost = await DesktopProjectLibraryHost.start({
		appDataPath,
		owner: { product: 'framescaper', processId: 202, instanceId: 'desktop-v12-folder-reader' },
		leaseTtlMs: 5_000,
		renewIntervalMs: 1_000,
	});
	context.after(() => secondHost.close());
	const secondService = new DesktopSharedProjectLibraryService(secondHost);
	const reopenedDocument = await secondService.readSharedProject(project.id);
	assert.equal(reopenedDocument, document);
	const reopened = parseScapeProjectDocument(reopenedDocument ?? '') as typeof project;
	assert.deepEqual(reopened.tracks.map(({ locked }) => locked), [true, false]);
	assert.deepEqual(reopened.trackFolders, project.trackFolders);
	assert.deepEqual(reopened.sequences[0]?.trackNodes, project.sequences[0]?.trackNodes);
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).groups.length, 1, 'only the top-level audio-bearing folder owns a bus');
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).groups[0]?.id, 'folder-a');
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).groups[0]?.name, 'Folder A');
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).groups[0]?.mute, false);
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).groups[0]?.solo, false);
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).routes['track-a']?.groupId, 'folder-a');
	assert.equal((reopened.mixer as { groups: { id: string; name: string; mute: boolean; solo: boolean }[]; routes: Record<string, { groupId: string | null }> }).routes['track-b']?.groupId, 'folder-a');
});
