/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readdir, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createDesktopProjectLibraryPaths,
	validateDesktopLibraryMetadata,
} from '../desktop/project-library-contract.ts';
import {
	createDesktopLibraryAudioMediaBinding,
	DesktopLibraryManagedMediaStore,
	type DesktopLibraryMediaCatalogPort,
} from '../desktop/project-library-media.ts';
import { DesktopLibraryProjectStore } from '../desktop/project-library-projects.ts';
import { SharedDesktopProjectLibrary } from '../desktop/project-library.ts';
import {
	TestDesktopLibraryManagedMediaInventoryPort,
} from './helpers/desktop-project-library-media-inventory-port.ts';

const OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 101,
	instanceId: 'space-exhaustion-owner',
});
const ENTRY_ID = 'library-entry-1';
const TYPED_REFUSAL = /ran out of space; the staged file was discarded/u;

test('a project-document stage write that runs out of space refuses with a typed terminal error', async (context) => {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'scape-library-space-'));
	context.after(() => rm(appDataRoot, { recursive: true, force: true }));
	const paths = createDesktopProjectLibraryPaths(appDataRoot);
	const library = await SharedDesktopProjectLibrary.open(paths, { now: () => 10_000 });
	context.after(() => library.close());
	const exhaustion = { active: false };
	const projects = new DesktopLibraryProjectStore(library, {
		stageOpenImpl: failingStageOpen(exhaustion, 'ENOSPC'),
	});
	const lease = await library.acquireLease({ owner: OWNER, ttlMs: 5_000 });
	const commit = (revision: number, updatedAtMs: number) => projects.commitProject({
		lease,
		entryId: ENTRY_ID,
		name: 'Shared project',
		project: currentProject(revision),
		preferredProduct: 'soundscaper',
		updatedAtMs,
	});
	const first = await commit(1, 10_001);

	exhaustion.active = true;
	await assert.rejects(commit(2, 10_002), (error: unknown) => {
		assert.match((error as Error).message, TYPED_REFUSAL);
		assert.equal(((error as Error).cause as NodeJS.ErrnoException).code, 'ENOSPC');
		return true;
	});

	assert.deepEqual(await projects.readProject(ENTRY_ID), first, 'the previous commit stays readable');
	assert.equal(library.readMetadata().revision, 1, 'the failed publication never reached the catalog');
	const entryFiles = await readdir(join(paths.projectsRoot, ENTRY_ID));
	assert.deepEqual(entryFiles.filter((name) => name.endsWith('.stage')), [], 'the staged file is discarded');

	exhaustion.active = false;
	const retried = await commit(2, 10_003);
	assert.equal(retried.catalog.projectRevision, 2, 'a later retry publishes normally');
	assert.deepEqual(await projects.readProject(ENTRY_ID), retried);
});

test('a managed-media stage write that runs out of space refuses with a typed terminal error', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-media-space-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const state = {
		metadata: validateDesktopLibraryMetadata({ schemaVersion: 2, revision: 0, projects: [], media: [] }),
	};
	const catalog: DesktopLibraryMediaCatalogPort = {
		readMetadata: () => state.metadata,
		publishMetadata: async (candidate) => {
			state.metadata = validateDesktopLibraryMetadata(candidate);
			return state.metadata;
		},
	};
	const exhaustion = { active: true };
	const store = new DesktopLibraryManagedMediaStore({
		managedMediaRoot: root,
		catalog,
		inventory: new TestDesktopLibraryManagedMediaInventoryPort(root),
		randomId: () => 'a'.repeat(32),
		stageOpenImpl: failingStageOpen(exhaustion, 'EDQUOT'),
	});
	const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6);
	const publish = () => store.publishAudio({
		projectId: 'managed-audio-project',
		projectRevision: 3,
		projectSha256: 'a'.repeat(64),
		storageKey: 'managed-audio-storage',
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		chunks: chunks(bytes),
	});

	await assert.rejects(publish(), (error: unknown) => {
		assert.match((error as Error).message, TYPED_REFUSAL);
		assert.equal(((error as Error).cause as NodeJS.ErrnoException).code, 'EDQUOT');
		return true;
	});

	assert.equal(state.metadata.revision, 0, 'no catalog row is published');
	assert.deepEqual(state.metadata.media, []);
	assert.deepEqual(await listFiles(root), [], 'the staged body is discarded');

	exhaustion.active = false;
	const published = await publish();
	assert.deepEqual(state.metadata.media, [published], 'a later retry publishes normally');
	const binding = createDesktopLibraryAudioMediaBinding(
		'managed-audio-project', 'managed-audio-storage', 3, 'a'.repeat(64),
	);
	assert.equal(published.relativeFile, binding.relativeFile);
});

/** Real exclusive stage opens whose data writes fail with the given code while active. */
function failingStageOpen(exhaustion: Readonly<{ active: boolean }>, code: string): typeof open {
	return (async (path: string, flags: string, mode: number) => {
		const handle = await open(path, flags as never, mode);
		if (!exhaustion.active) return handle;
		const failure = Object.assign(new Error(`Injected ${code} during a staged write`), { code });
		return {
			write: async () => { throw failure; },
			writeFile: async () => { throw failure; },
			sync: () => handle.sync(),
			close: () => handle.close(),
		} as unknown as FileHandle;
	}) as unknown as typeof open;
}

function currentProject(revision: number) {
	const project = createAudioEditorProjectV10({
		id: 'project / identity',
		title: 'Shared project',
		revision,
		now: '2026-07-29T10:00:00.000Z',
	});
	return { ...project, desktopState: new Uint8Array([1, 3, 5, revision]) };
}

async function listFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else files.push(path);
		}
	};
	await visit(root);
	return files;
}

async function* chunks(...values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
	for (const value of values) yield value;
}
