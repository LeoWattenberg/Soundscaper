/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	createFramescaperDesktopProjectLibraryV10Paths,
} from '../desktop/project-library-v10-contract.ts';
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID,
	createSoundscaperDesktopProjectLibraryV10Handshake,
	createSoundscaperDesktopProjectLibraryV10Paths,
	validateSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts';
import {
	assertSoundscaperDesktopProjectLibraryV10DatabaseIdentity,
	initializeSoundscaperDesktopProjectLibraryV10Database,
} from '../desktop/soundscaper-project-library-v10-database.ts';
import {
	createSoundscaperDesktopProjectLibraryV10TransferBodies,
	validateSoundscaperDesktopProjectLibraryV10TransferBundle,
} from '../desktop/soundscaper-project-library-v10-transfer-contract.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import {
	snapshotSoundscaperDesktopV10Project,
	soundscaperDesktopV10BodiesForProject,
} from '../src/soundscaper/desktop-project-library-v10-renderer-contract.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile-v23.ts';
import {
	editorProjectRuntimeProfileDefinition,
} from '../src/common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../src/common/editor/project-runtime-profile-prerequisite.ts';
import {
	editorProjectStorageProfileNames,
} from '../src/common/editor/storage/project-storage-profile.ts';

const DIGEST = 'a7'.repeat(32);

// Main declares this identity and the renderer refuses any handshake that does
// not match its own runtime profile, so the two drifting apart is not a
// mismatched field somewhere — it is a packaged product that never mounts an
// editor at all. Deriving the expectation from the mounted profile's
// prerequisite is what makes the next revision flip fail here rather than in the
// nightly packaged lease matrix.
test('Soundscaper V10 hands the renderer the identity its mounted revision declares', () => {
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(
		editorProjectRuntimeProfileDefinition(SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE).prerequisite,
	);
	const storage = editorProjectStorageProfileNames(prerequisite.storageProfile);
	const handshake = createSoundscaperDesktopProjectLibraryV10Handshake();
	assert.deepEqual(handshake, {
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: prerequisite.owner,
		projectSchemaVersion: prerequisite.desktopProjectSchemaVersion,
		scapeFormatVersions: [...prerequisite.scapeFormatVersions],
		attachedScapeFormatVersion: prerequisite.attachedScapeFormatVersion,
		storageDatabaseName: storage.databaseName,
		desktopLibrarySchemaVersion: prerequisite.desktopLibrarySchemaVersion,
		desktopDatabaseUserVersion: prerequisite.desktopDatabaseUserVersion,
		desktopLibraryScope: [...prerequisite.desktopLibraryScope],
	});
	assert.deepEqual(validateSoundscaperDesktopProjectLibraryV10Handshake(handshake), handshake);
	assert.throws(
		() => validateSoundscaperDesktopProjectLibraryV10Handshake(
			createFramescaperDesktopProjectLibraryV10Handshake(),
		),
		/identity|unsupported|Soundscaper/iu,
	);
	const appData = join(tmpdir(), 'soundscaper-v10-contract');
	assert.notEqual(
		createSoundscaperDesktopProjectLibraryV10Paths(appData).libraryRoot,
		createFramescaperDesktopProjectLibraryV10Paths(appData).libraryRoot,
	);
});

test('Soundscaper V10 SQLite identity is user_version 12 and refuses foreign application IDs', () => {
	const database = new DatabaseSync(':memory:');
	initializeSoundscaperDesktopProjectLibraryV10Database(database);
	assertSoundscaperDesktopProjectLibraryV10DatabaseIdentity(database);
	assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 12);
	assert.equal(database.prepare('PRAGMA application_id').get()?.application_id,
		SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_APPLICATION_ID);
	database.close();

	const foreign = new DatabaseSync(':memory:');
	foreign.exec('PRAGMA application_id = 1179861840');
	assert.throws(() => initializeSoundscaperDesktopProjectLibraryV10Database(foreign), /another application/iu);
	foreign.close();
});

test('Soundscaper V10 derives one exact body for every track-owned freeze and validates the full bundle', () => {
	const project = frozenProject();
	const document = JSON.stringify(project);
	const projectSha256 = sha256(document);
	const bodies = createSoundscaperDesktopProjectLibraryV10TransferBodies(project, projectSha256);
	const rendererSnapshot = snapshotSoundscaperDesktopV10Project(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		project,
	);
	assert.equal(rendererSnapshot.sha256, projectSha256);
	assert.deepEqual(
		soundscaperDesktopV10BodiesForProject(
			SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE, project, rendererSnapshot.sha256,
		).bodies,
		bodies,
	);
	assert.deepEqual(bodies, [{
		kind: 'audio-freeze',
		encoding: 'audio-f32le-chunks-v1',
		bindingId: bodies[0]?.bindingId,
		sourceId: 'freeze-source',
		storageKey: 'derived:freeze-source',
		mimeType: 'application/vnd.soundscaper.audio-f32le-chunks',
		byteLength: 12,
		sha256: DIGEST,
	}]);
	assert.match(bodies[0]?.bindingId ?? '', /^f[a-f0-9]{64}$/u);
	const bundle = validateSoundscaperDesktopProjectLibraryV10TransferBundle({
		metadataRevision: 4,
		project: {
			id: 'soundscaper_entry_01', projectId: project.id, name: project.title,
			metadataFile: `soundscaper_entry_01/0-${projectSha256}.json`,
			preferredProduct: 'soundscaper', updatedAtMs: Date.parse(String(project.updatedAt)),
			projectSchemaVersion: 23, projectRevision: 0,
			byteLength: new TextEncoder().encode(document).byteLength, sha256: projectSha256,
		},
		document,
		bodies,
	}, project.id);
	assert.deepEqual(bundle.bodies, bodies);
	assert.throws(() => validateSoundscaperDesktopProjectLibraryV10TransferBundle({
		...bundle, bodies: [],
	}, project.id), /freeze body|incomplete|document/iu);
});

function frozenProject() {
	const source = createAudioSourceV10({
		id: 'live-source', storageKey: 'pcm:live-source', frameCount: 2, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derived = createAudioSourceV10({
		id: 'freeze-source', storageKey: 'derived:freeze-source', contentSha256: DIGEST,
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'live-clip', sourceId: source.id, title: 'Live', timelineStartFrame: 0,
		durationFrames: 2, sourceStartFrame: 0, sourceDurationFrames: 2,
	});
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: [clip.id], audioFreeze: {
			schemaVersion: 1, derivedSourceId: derived.id,
			inputDigestSha256: '11'.repeat(32), rackDigestSha256: '22'.repeat(32),
			automationDigestSha256: '33'.repeat(32), freshnessDigestSha256: '44'.repeat(32),
			renderStartFrame: 0, renderFrameCount: 2, capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProjectV23({
		id: 'soundscaper-v23-desktop', title: 'Soundscaper V23 desktop',
		now: '2026-08-14T12:00:00.000Z', sources: [source, derived], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }], primarySequenceId: 'main-sequence',
	});
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
