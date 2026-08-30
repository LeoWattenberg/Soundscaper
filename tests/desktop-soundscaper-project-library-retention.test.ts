/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createSoundscaperDesktopProjectLibraryPaths,
} from '../desktop/soundscaper-project-library-contract.ts';
import {
	initializeSoundscaperDesktopProjectLibraryDatabase,
} from '../desktop/soundscaper-project-library-database.ts';
import {
	freezeRelativeFileForSoundscaperDesktopLibraryBinding,
} from '../desktop/soundscaper-project-library-media-binding.ts';
import {
	reclaimSoundscaperDesktopProjectLibraryStorage,
	selectSoundscaperDesktopProjectLibraryCurrentMedia,
} from '../desktop/soundscaper-project-library-retention.ts';
import {
	validateSoundscaperDesktopLibraryMetadata,
	type SoundscaperDesktopLibraryMedia,
	type SoundscaperDesktopLibraryProject,
} from '../desktop/soundscaper-project-library-metadata.ts';

test('Soundscaper reclamation retains journal snapshots then removes unreferenced revisions and PCM', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-retention-'));
	const paths = createSoundscaperDesktopProjectLibraryPaths(appDataPath);
	const database = new DatabaseSync(':memory:');
	context.after(async () => {
		database.close();
		await rm(appDataPath, { recursive: true, force: true });
	});
	initializeSoundscaperDesktopProjectLibraryDatabase(database);
	await Promise.all([
		mkdir(paths.projectsRoot, { recursive: true }),
		mkdir(paths.managedMediaRoot, { recursive: true }),
	]);
	const currentProject = projectRow('current01', 'current-project', '1'.repeat(64));
	const staleProject = projectRow('stale000', 'stale-project', '2'.repeat(64));
	const currentMedia = mediaRow('a', '3');
	const staleMedia = mediaRow('b', '4');
	insertRevision(database, currentProject, currentMedia);
	insertRevision(database, staleProject, staleMedia);
	await Promise.all([
		writeManagedFile(paths.projectsRoot, currentProject.metadataFile),
		writeManagedFile(paths.projectsRoot, staleProject.metadataFile),
		writeManagedFile(paths.managedMediaRoot, currentMedia.relativeFile),
		writeManagedFile(paths.managedMediaRoot, staleMedia.relativeFile),
	]);
	const previous = metadata(1, [currentProject, staleProject], [currentMedia, staleMedia]);
	const current = metadata(2, [currentProject], [currentMedia]);
	installMetadata(database, current);
	insertCompletedJournal(database, previous, current, staleProject, staleMedia);

	assert.deepEqual(
		selectSoundscaperDesktopProjectLibraryCurrentMedia(database, current),
		[currentMedia],
	);
	assert.deepEqual(
		selectSoundscaperDesktopProjectLibraryCurrentMedia(database, current, currentProject.projectId),
		[],
	);
	assert.deepEqual(await reclaimSoundscaperDesktopProjectLibraryStorage(database, paths), {
		projectFiles: 0,
		mediaFiles: 0,
	});
	await access(join(paths.projectsRoot, staleProject.metadataFile));
	await access(join(paths.managedMediaRoot, staleMedia.relativeFile));

	database.exec('DELETE FROM publication_journal');
	assert.deepEqual(await reclaimSoundscaperDesktopProjectLibraryStorage(database, paths), {
		projectFiles: 1,
		mediaFiles: 1,
	});
	assert.equal(database.prepare(
		'SELECT count(*) AS count FROM project_revisions WHERE project_id = ?',
	).get(staleProject.projectId)?.count, 0);
	assert.equal(database.prepare(
		'SELECT count(*) AS count FROM managed_bodies WHERE body_id = ?',
	).get(staleMedia.id)?.count, 0);
	await assert.rejects(access(join(paths.projectsRoot, staleProject.metadataFile)), { code: 'ENOENT' });
	await assert.rejects(access(join(paths.managedMediaRoot, staleMedia.relativeFile)), { code: 'ENOENT' });
	await access(join(paths.projectsRoot, currentProject.metadataFile));
	await access(join(paths.managedMediaRoot, currentMedia.relativeFile));
});

function projectRow(
	id: string,
	projectId: string,
	sha256: string,
): Readonly<SoundscaperDesktopLibraryProject> {
	return {
		id,
		projectId,
		name: projectId,
		metadataFile: `${id}/0-${sha256}.json`,
		preferredProduct: 'soundscaper',
		updatedAtMs: 0,
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		projectRevision: 0,
		byteLength: 2,
		sha256,
	};
}

function mediaRow(idDigit: string, digestDigit: string): Readonly<SoundscaperDesktopLibraryMedia> {
	const id = `f${idDigit.repeat(64)}`;
	return {
		id,
		relativeFile: freezeRelativeFileForSoundscaperDesktopLibraryBinding(id),
		category: 'audio-freeze',
		byteLength: 4,
		sha256: digestDigit.repeat(64),
	};
}

function metadata(
	revision: number,
	projects: readonly Readonly<SoundscaperDesktopLibraryProject>[],
	media: readonly Readonly<SoundscaperDesktopLibraryMedia>[],
) {
	return validateSoundscaperDesktopLibraryMetadata({ schemaVersion: 1, revision, projects, media });
}

function insertRevision(
	database: DatabaseSync,
	project: Readonly<SoundscaperDesktopLibraryProject>,
	media: Readonly<SoundscaperDesktopLibraryMedia>,
): void {
	database.prepare(`
		INSERT INTO project_revisions (
			project_id, project_revision, project_sha256, entry_id, relative_file,
			byte_length, document_json, published_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, '{}', 0)
	`).run(
		project.projectId, project.projectRevision, project.sha256, project.id,
		project.metadataFile, project.byteLength,
	);
	database.prepare(`
		INSERT INTO managed_bodies (
			body_id, kind, encoding, binding_id, source_id, storage_key, relative_file,
			mime_type, byte_length, sha256, descriptor_json, state, published_at_ms
		) VALUES (?, 'audio-freeze', 'audio-f32le-chunks-v1', ?, ?, ?, ?,
			'application/vnd.soundscaper.audio-f32le-chunks', ?, ?, '{}', 'published', 0)
	`).run(media.id, media.id, `${project.projectId}-source`, `${project.projectId}-storage`,
		media.relativeFile, media.byteLength, media.sha256);
	database.prepare(`
		INSERT INTO project_revision_bodies
		(project_id, project_revision, ordinal, body_id) VALUES (?, ?, 0, ?)
	`).run(project.projectId, project.projectRevision, media.id);
}

function installMetadata(database: DatabaseSync, value: ReturnType<typeof metadata>): void {
	const json = JSON.stringify(value);
	database.prepare(`
		UPDATE library_metadata SET revision = ?, json = ?, digest = ?, published_at_ms = 0
		WHERE singleton = 1
	`).run(value.revision, json, createHash('sha256').update(json).digest('hex'));
}

function insertCompletedJournal(
	database: DatabaseSync,
	previous: ReturnType<typeof metadata>,
	next: ReturnType<typeof metadata>,
	project: Readonly<SoundscaperDesktopLibraryProject>,
	media: Readonly<SoundscaperDesktopLibraryMedia>,
): void {
	const previousJson = JSON.stringify(previous);
	const nextJson = JSON.stringify(next);
	database.prepare(`
		INSERT INTO publication_journal (
			transaction_id, state, expected_metadata_revision,
			previous_metadata_json, previous_metadata_digest,
			next_metadata_json, next_metadata_digest,
			project_id, project_revision, project_sha256, entry_id,
			project_relative_file, project_byte_length, project_json,
			bodies_json, stages_json, lease_id, fencing_token,
			created_at_ms, completed_at_ms
		) VALUES (?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, '[]', ?, 1, 0, 0)
	`).run(
		'c'.repeat(48), previous.revision,
		previousJson, createHash('sha256').update(previousJson).digest('hex'),
		nextJson, createHash('sha256').update(nextJson).digest('hex'),
		project.projectId, project.projectRevision, project.sha256, project.id,
		project.metadataFile, project.byteLength,
		JSON.stringify([{
			bodyId: media.id,
			mediaRelativeFile: media.relativeFile,
			descriptor: {
				kind: 'audio-freeze',
				encoding: 'audio-f32le-chunks-v1',
				bindingId: media.id,
				sourceId: `${project.projectId}-source`,
				storageKey: `${project.projectId}-storage`,
				mimeType: 'application/vnd.soundscaper.audio-f32le-chunks',
				byteLength: media.byteLength,
				sha256: media.sha256,
			},
		}]),
		'a'.repeat(48),
	);
}

async function writeManagedFile(root: string, relativeFile: string): Promise<void> {
	const path = join(root, ...relativeFile.split('/'));
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, new Uint8Array([1]));
}
