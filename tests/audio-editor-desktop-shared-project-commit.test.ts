/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { DesktopSharedProjectConflictError } from '../src/common/editor/storage/desktop-shared-project-commit.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import { DesktopSharedProjectRepository } from '../src/common/editor/storage/desktop-shared-project-repository.ts';

const NOW = '2026-08-09T12:00:00.000Z';

test('desktop shared save sends its last authoritative revision and surfaces conflicts', async () => {
	const authoritative = project('conflict-project', 2);
	const candidate = project('conflict-project', 7);
	const shadow = memoryShadow();
	let observedExpectedRevision: number | null | undefined;
	const repository = new DesktopSharedProjectRepository({
		shadow,
		sourceAvailability: unavailableSources(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => serializeScapeProjectDocument(authoritative),
			commitSharedProject: async (request) => {
				observedExpectedRevision = request.expectedRevision;
				return { status: 'conflict' as const, currentRevision: 3 };
			},
			deleteSharedProject: async () => true,
		},
	});

	await repository.load(authoritative.id);
	await assert.rejects(repository.save(candidate), (error) => (
		error instanceof DesktopSharedProjectConflictError && error.currentRevision === 3
	));
	assert.equal(observedExpectedRevision, 2);
	assert.equal((await shadow.load())?.revision, 7);
});

test('desktop shared create records the authoritative base for its next save', async () => {
	const created = project('created-project', 3);
	const advanced = project('created-project', 9);
	const expectedRevisions: Array<number | null> = [];
	let remote: string | null = null;
	const shadow = memoryShadow();
	const repository = new DesktopSharedProjectRepository({
		shadow,
		sourceAvailability: unavailableSources(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => remote,
			commitSharedProject: async (request) => {
				expectedRevisions.push(request.expectedRevision);
				remote = request.document;
				return { status: 'committed' as const, document: request.document };
			},
			deleteSharedProject: async () => true,
		},
	});

	assert.deepEqual(await repository.createIfAbsent(created), created);
	assert.deepEqual(await repository.save(advanced), advanced);
	assert.deepEqual(expectedRevisions, [null, 3]);
});

test('a catalog summary does not authorize overwriting a document that was never loaded', async () => {
	const candidate = project('summary-only-project', 8);
	let expectedRevision: number | null | undefined;
	const repository = new DesktopSharedProjectRepository({
		shadow: memoryShadow(),
		sourceAvailability: unavailableSources(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [{
				id: candidate.id, title: 'summary-only-project', revision: 7, updatedAt: NOW,
			}],
			readSharedProject: async () => null,
			commitSharedProject: async (request) => {
				expectedRevision = request.expectedRevision;
				return { status: 'conflict' as const, currentRevision: 7 };
			},
			deleteSharedProject: async () => true,
		},
	});

	await repository.list();
	await assert.rejects(repository.save(candidate), DesktopSharedProjectConflictError);
	assert.equal(expectedRevision, null);
});

test('desktop shared compare-and-swap leaves its shadow unchanged after a remote race', async () => {
	const expected = project('raced-project', 4);
	const target = project('raced-project', 5);
	const competing = createCurrentAudioEditorProject({
		id: expected.id,
		title: 'Competing revision',
		revision: 5,
		now: NOW,
	}) as unknown as ProjectDocument;
	const shadow = memoryShadow();
	let remote = serializeScapeProjectDocument(expected);
	const commitStarted = deferred<void>();
	const releaseCommit = deferred<void>();
	let maintenanceCalls = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow,
		sourceAvailability: unavailableSources(),
		onLocalCleanupError: () => {},
		bridge: {
			listSharedProjects: async () => [],
			readSharedProject: async () => remote,
			async commitSharedProject(request) {
				commitStarted.resolve();
				await releaseCommit.promise;
				const current = JSON.parse(remote) as ProjectDocument;
				if (request.expectedRevision !== current.revision) {
					return { status: 'conflict' as const, currentRevision: Number(current.revision) };
				}
				remote = request.document;
				return { status: 'committed' as const, document: request.document };
			},
			deleteSharedProject: async () => true,
		},
	});

	await repository.load(expected.id);
	const publishing = repository.saveIfCurrent(expected, target, async () => { maintenanceCalls += 1; });
	await commitStarted.promise;
	remote = serializeScapeProjectDocument(competing);
	releaseCommit.resolve();

	assert.equal(await publishing, null);
	assert.deepEqual(await shadow.load(), expected);
	assert.equal(maintenanceCalls, 0);
});

function project(id: string, revision: number): ProjectDocument {
	return createCurrentAudioEditorProject({ id, title: id, revision, now: NOW }) as unknown as ProjectDocument;
}

function memoryShadow() {
	let local: ProjectDocument | null = null;
	return {
		async createIfAbsent(candidate: ProjectDocument) {
			if (local) return null;
			local = candidate;
			return candidate;
		},
		async save(candidate: ProjectDocument) { local = candidate; return candidate; },
		async saveIfCurrent(expected: ProjectDocument, candidate: ProjectDocument) {
			if (!local || serializeScapeProjectDocument(local) !== serializeScapeProjectDocument(expected)) return null;
			local = candidate;
			return candidate;
		},
		async load() { return local; },
		async list() { return local ? [local] : []; },
		async listRevisions() { return []; },
		async delete() { local = null; },
		async deleteIfCurrent(candidate: ProjectDocument) {
			if (local !== candidate) return false;
			local = null;
			return true;
		},
	} satisfies ProjectRepositoryPort & {
		createIfAbsent(candidate: ProjectDocument): Promise<ProjectDocument | null>;
		deleteIfCurrent(candidate: ProjectDocument): Promise<boolean>;
	};
}

function unavailableSources() {
	const unexpected = (): never => { throw new Error('Source-free commit read source storage'); };
	return {
		getSourceMetadata: unexpected,
		readSourceChunks: unexpected,
		getMediaAssetMetadata: unexpected,
		loadMediaAsset: unexpected,
	};
}

function deferred<Value>() {
	let resolve = (_value: Value | PromiseLike<Value>): void => undefined;
	const promise = new Promise<Value>((done) => { resolve = done; });
	return { promise, resolve };
}
