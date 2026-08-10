/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopSharedProjectLocalCleanupError,
	DesktopSharedProjectRepository,
	type DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { DesktopSharedProjectSourceAvailability } from '../src/common/editor/storage/desktop-shared-project-source-availability.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import {
	ProjectRepository,
	type ProjectDocument,
	type ProjectRepositoryPort,
} from '../src/common/editor/storage/project-repository.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';

const NOW = '2026-07-29T12:00:00.000Z';

interface CurrentProject extends ProjectDocument {
	readonly schemaVersion: 9;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
}

test('desktop shared saves publish the local compacted snapshot before canonical remote commit', async () => {
	const memory = getMemoryDatabase(uniqueName('shared-save'));
	const local = new ProjectRepository({ memory, database: async () => null }, 5);
	const reachableSource = createAudioSourceV9({
		id: 'source-reachable',
		name: 'Reachable source',
		frameCount: 48,
		channelCount: 1,
	});
	const unreachableSource = createAudioSourceV9({
		id: 'source-unreachable',
		name: 'Unreachable source',
		frameCount: 48,
		channelCount: 1,
	});
	const clip = createAudioClipV9({
		id: 'clip-reachable',
		sourceId: reachableSource.id,
		durationFrames: 48,
	});
	const project = createCurrentAudioEditorProject({
		id: 'shared-save-project',
		title: 'Shared save',
		revision: 4,
		now: NOW,
		sources: [reachableSource, unreachableSource],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'track-1', clipIds: [clip.id] })],
		opaqueExtensions: { transport: new Uint8Array([0, 127, 255]) },
	}) as unknown as CurrentProject;
	memory.sources.set(reachableSource.id, {
		id: reachableSource.id,
		pendingProjectUntil: '2026-07-30T12:00:00.000Z',
	});
	memory.mediaAssets.set(reachableSource.id, {
		id: reachableSource.id,
		pendingProjectUntil: '2026-07-30T12:00:00.000Z',
	});
	let committedDocument = '';
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async ({ document }) => {
				assert.equal(record(memory.sources.get(reachableSource.id)).pendingProjectUntil, undefined);
				assert.equal(record(memory.mediaAssets.get(reachableSource.id)).pendingProjectUntil, undefined);
				committedDocument = document;
				return { status: 'committed', document };
			},
		}),
	});

	const saved = await repository.save(project);
	const committed = parseScapeProjectDocument(committedDocument) as CurrentProject;

	assert.deepEqual(saved, committed);
	assert.deepEqual(saved.sources.map(({ id }) => id), ['source-reachable']);
	assert.deepEqual(
		(committed.opaqueExtensions as Record<string, unknown>).transport,
		new Uint8Array([0, 127, 255]),
	);
	const localSnapshot = await local.load(project.id) as CurrentProject | null;
	assert.equal(localSnapshot?.sources.length, 1);
});

test('desktop shared save retains its local revision and retries an identical remote commit', async () => {
	const local = memoryRepository('shared-retry');
	const project = sourceFreeProject('retry-project', 7);
	const attempts: string[] = [];
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async ({ document }) => {
				attempts.push(document);
				if (attempts.length === 1) throw new Error('remote unavailable');
				return { status: 'committed', document };
			},
		}),
	});

	await assert.rejects(repository.save(project), /remote unavailable/u);
	assert.deepEqual(await local.load(project.id), project);
	assert.deepEqual((await local.listRevisions(project.id)).map(({ revision }) => revision), [7]);

	assert.deepEqual(await repository.save(project), project);
	assert.equal(attempts.length, 2);
	assert.equal(attempts[0], attempts[1]);
});

test('desktop shared save fully validates before touching either repository boundary', async () => {
	const calls: string[] = [];
	const shadow = recordingShadow(calls);
	const repository = new DesktopSharedProjectRepository({
		shadow,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async ({ document }) => {
				calls.push(`commit:${document}`);
				return { status: 'committed', document };
			},
		}),
	});
	const malformed = { ...sourceFreeProject('invalid-save', 1) } as Record<string, unknown>;
	delete malformed.featureRequirements;

	await assert.rejects(repository.save(malformed as ProjectDocument), /feature.*requirements/iu);
	assert.deepEqual(calls, []);
	const unsupported = { ...sourceFreeProject('unsupported-save', 1), unsupported: 1n };
	await assert.rejects(repository.save(unsupported), /BigInt|serializ/iu);
	assert.deepEqual(calls, []);
	const unpublishableTitle = { ...sourceFreeProject('invalid-title', 1), title: ` ${'x'.repeat(255)}` };
	await assert.rejects(repository.save(unpublishableTitle), /title/iu);
	assert.deepEqual(calls, []);

	const valid = sourceFreeProject('invalid-compaction', 2);
	const invalidSnapshot = { ...valid } as Record<string, unknown>;
	delete invalidSnapshot.featureRequirements;
	const compactionCalls: string[] = [];
	const invalidCompaction = new DesktopSharedProjectRepository({
		shadow: recordingShadow(compactionCalls, { saveResult: invalidSnapshot as ProjectDocument }),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async ({ document }) => {
				compactionCalls.push(`commit:${document}`);
				return { status: 'committed', document };
			},
		}),
	});
	await assert.rejects(invalidCompaction.save(valid), /feature.*requirements/iu);
	assert.deepEqual(compactionCalls, ['local-save']);
});

test('desktop shared latest load is remote-authoritative, validated, and shadowed locally', async () => {
	const local = memoryRepository('shared-load');
	const stale = sourceFreeProject('load-project', 1, 'Stale local');
	const latest = sourceFreeProject('load-project', 2, 'Remote latest');
	await local.save(stale);
	let reads = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			readSharedProject: async (projectId) => {
				reads += 1;
				assert.equal(projectId, latest.id);
				return serializeScapeProjectDocument(latest);
			},
		}),
	});

	assert.deepEqual(await repository.load(latest.id), latest);
	assert.deepEqual(await local.load(latest.id), latest);
	assert.deepEqual(await repository.load(latest.id, { revision: 1 }), stale);
	assert.deepEqual(await repository.listRevisions(latest.id), [
		{ revision: 2, project: latest },
		{ revision: 1, project: stale },
	]);
	assert.equal(reads, 1);

	const remotelyAbsent = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({ readSharedProject: async () => null }),
	});
	assert.equal(await remotelyAbsent.load(stale.id), null, 'a stale local latest is never a fallback');
});

test('desktop shared latest load rejects noncanonical, invalid, mismatched, and aborted documents', async () => {
	const project = sourceFreeProject('validated-load', 3);
	const canonical = serializeScapeProjectDocument(project);
	const responses: Array<string | null> = [
		` ${canonical}`,
		serializeScapeProjectDocument({ ...project, schemaVersion: 8 }),
		serializeScapeProjectDocument({ ...project, id: 'different-project' }),
		canonical,
	];
	const shadowCalls: string[] = [];
	const repository = new DesktopSharedProjectRepository({
		shadow: recordingShadow(shadowCalls),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({ readSharedProject: async () => responses.shift() ?? null }),
	});

	await assert.rejects(repository.load(project.id), /canonical/iu);
	await assert.rejects(repository.load(project.id), /schema version/iu);
	await assert.rejects(repository.load(project.id), /identity/iu);
	assert.deepEqual(shadowCalls, []);

	const controller = new AbortController();
	const reason = new Error('cancel shared read');
	controller.abort(reason);
	await assert.rejects(repository.load(project.id, { signal: controller.signal }), (error) => error === reason);
	assert.deepEqual(shadowCalls, []);
});

test('desktop shared latest load leaves prior local history untouched when recipient PCM is missing', async () => {
	const local = memoryRepository('shared-missing-pcm');
	const source = createAudioSourceV9({
		id: 'remote-audio',
		storageKey: 'recipient-pcm-key',
		name: 'Remote audio',
		frameCount: 48,
		channelCount: 1,
		chunkFrames: 48,
	});
	const clip = createAudioClipV9({
		id: 'remote-clip',
		sourceId: source.id,
		durationFrames: 48,
	});
	const track = createAudioTrackV9({ id: 'remote-track', clipIds: [clip.id] });
	const stale = createCurrentAudioEditorProject({
		id: 'missing-pcm-project',
		title: 'Prior local revision',
		revision: 1,
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	}) as unknown as CurrentProject;
	const latest = createCurrentAudioEditorProject({
		id: stale.id,
		title: 'Remote latest',
		revision: 2,
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	}) as unknown as CurrentProject;
	await local.save(stale);
	const sourceAvailability: DesktopSharedProjectSourceAvailability = {
		async getSourceMetadata(sourceId: string) {
			assert.equal(sourceId, source.storageKey);
			return {
				id: source.storageKey,
				storage: 'indexeddb',
				sourceToken: 'missing-source-token',
				chunkCount: 1,
				frameCount: source.frameCount,
				channelCount: source.channelCount,
				sampleRate: source.sampleRate,
				chunkFrames: source.chunkFrames,
				committedAt: NOW,
			};
		},
		readSourceChunks(sourceId: string) {
			assert.equal(sourceId, source.storageKey);
			return emptyAsyncIterable();
		},
		async getMediaAssetMetadata() {
			throw new Error('Audio admission must not inspect video media metadata.');
		},
		async loadMediaAsset() {
			throw new Error('Audio admission must not load video media.');
		},
	};
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability,
		onLocalCleanupError: () => {},
		bridge: bridge({ readSharedProject: async () => serializeScapeProjectDocument(latest) }),
	});

	await assert.rejects(repository.load(latest.id), /audio|frame|PCM|source/iu);
	assert.deepEqual(await local.load(stale.id), stale);
	assert.deepEqual(
		(await local.listRevisions(stale.id)).map(({ revision }) => revision),
		[1],
	);
});

test('concurrent shared latest loads cannot let a slow older admission replace a newer revision', async () => {
	const local = memoryRepository('shared-concurrent-load');
	const source = createAudioSourceV9({
		id: 'ordered-audio', storageKey: 'ordered-pcm', frameCount: 1, channelCount: 1, chunkFrames: 1,
	});
	const clip = createAudioClipV9({ id: 'ordered-clip', sourceId: source.id, durationFrames: 1 });
	const track = createAudioTrackV9({ id: 'ordered-track', clipIds: [clip.id] });
	const revision = (value: number): CurrentProject => createCurrentAudioEditorProject({
		id: 'ordered-project', title: `Revision ${value}`, revision: value, now: NOW,
		sources: [source], clips: [clip], tracks: [track],
	}) as unknown as CurrentProject;
	await local.save(revision(0));
	const documents = [revision(1), revision(2)].map((project) => serializeScapeProjectDocument(project));
	const firstBodyStarted = deferred<void>();
	const releaseFirstBody = deferred<void>();
	let bodyReads = 0;
	let remoteReads = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: {
			async getSourceMetadata() {
				return {
					id: source.storageKey, storage: 'indexeddb-chunks', sourceToken: 'ordered-token',
					frameCount: 1, channelCount: 1, sampleRate: source.sampleRate,
					chunkFrames: 1, chunkCount: 1, committedAt: NOW,
				};
			},
			async *readSourceChunks(_sourceId) {
				bodyReads += 1;
				if (bodyReads === 1) {
					firstBodyStarted.resolve();
					await releaseFirstBody.promise;
				}
				yield { index: 0, frames: 1, channels: [Float32Array.of(0.5)] };
			},
			async getMediaAssetMetadata() { throw new Error('unexpected video metadata read'); },
			async loadMediaAsset() { throw new Error('unexpected video body read'); },
		},
		onLocalCleanupError: () => {},
		bridge: bridge({
			readSharedProject: async () => documents[remoteReads++] ?? documents[1] as string,
		}),
	});

	const older = repository.load(sourceProjectId(documents[0] as string));
	await firstBodyStarted.promise;
	const newer = repository.load(sourceProjectId(documents[1] as string));
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	const readsWhileBlocked = remoteReads;
	releaseFirstBody.resolve();
	await Promise.all([older, newer]);

	assert.equal(readsWhileBlocked, 1, 'the second authoritative read waits for the first load');
	assert.equal((await local.load('ordered-project'))?.revision, 2);
});

test('desktop shared list returns only authoritative pathless summaries without document reads', async () => {
	const local = memoryRepository('shared-list');
	await local.save(sourceFreeProject('local-only', 9));
	let reads = 0;
	const repository = new DesktopSharedProjectRepository({
		shadow: local,
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			listSharedProjects: async () => [
				{ id: 'older', title: 'Older', revision: 2, updatedAt: '2026-07-28T12:00:00.000Z' },
				{ id: 'newer', title: 'Newer', revision: 5, updatedAt: '2026-07-29T12:00:00.000Z' },
			],
			readSharedProject: async () => {
				reads += 1;
				throw new Error('list must not read project documents');
			},
		}),
	});

	assert.deepEqual(await repository.list(), [
		{ id: 'newer', title: 'Newer', revision: 5, updatedAt: '2026-07-29T12:00:00.000Z' },
		{ id: 'older', title: 'Older', revision: 2, updatedAt: '2026-07-28T12:00:00.000Z' },
	]);
	assert.equal(reads, 0);
});

test('desktop shared transport is bounded and requires an exact commit acknowledgement', async () => {
	const project = sourceFreeProject('bounded-project', 2);
	const canonical = serializeScapeProjectDocument(project);
	let commits = 0;
	const tooSmall = new DesktopSharedProjectRepository({
		shadow: memoryRepository('shared-bound-save'),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async ({ document }) => {
				commits += 1;
				return { status: 'committed', document };
			},
		}),
		maximumDocumentBytes: canonical.length - 1,
	});

	await assert.rejects(tooSmall.save(project), /byte limit/iu);
	assert.equal(commits, 0);

	const mismatchedAck = new DesktopSharedProjectRepository({
		shadow: memoryRepository('shared-ack'),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			commitSharedProject: async () => ({
				status: 'committed',
				document: serializeScapeProjectDocument({ ...project, title: 'Changed' }),
			}),
		}),
	});
	await assert.rejects(mismatchedAck.save(project), /acknowledgement/iu);

	const boundedRead = new DesktopSharedProjectRepository({
		shadow: recordingShadow([]),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({ readSharedProject: async () => canonical }),
		maximumDocumentBytes: canonical.length - 1,
	});
	await assert.rejects(boundedRead.load(project.id), /byte limit/iu);
});

test('desktop shared delete completes remotely before local cleanup and never resurrects on cleanup failure', async () => {
	const calls: string[] = [];
	const remoteFailure = new Error('remote delete failed');
	const remoteBlocked = new DesktopSharedProjectRepository({
		shadow: recordingShadow(calls),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: () => {},
		bridge: bridge({
			deleteSharedProject: async () => {
				calls.push('remote-delete');
				throw remoteFailure;
			},
		}),
	});

	await assert.rejects(remoteBlocked.delete('delete-project'), (error) => error === remoteFailure);
	assert.deepEqual(calls, ['remote-delete']);

	const cleanupFailure = new Error('local cleanup failed');
	const reported: DesktopSharedProjectLocalCleanupError[] = [];
	const failedCleanup = new DesktopSharedProjectRepository({
		shadow: recordingShadow(calls, { deleteFailure: cleanupFailure }),
		sourceAvailability: throwingSourceAvailability(),
		onLocalCleanupError: (error) => { reported.push(error); },
		bridge: bridge({
			deleteSharedProject: async () => {
				calls.push('remote-delete-complete');
				return false;
			},
		}),
	});
	await failedCleanup.delete('delete-project');
	const cleanup = reported[0];
	assert.ok(cleanup instanceof DesktopSharedProjectLocalCleanupError);
	assert.equal(cleanup.projectId, 'delete-project');
	assert.equal(cleanup.remoteDeleted, true);
	assert.equal(cleanup.cause, cleanupFailure);
	assert.deepEqual(calls, ['remote-delete', 'remote-delete-complete', 'local-delete']);
});

function sourceFreeProject(id: string, revision: number, title = 'Source-free project'): CurrentProject {
	return createCurrentAudioEditorProject({ id, title, revision, now: NOW }) as unknown as CurrentProject;
}

function memoryRepository(scope: string): ProjectRepository {
	return new ProjectRepository({
		memory: getMemoryDatabase(uniqueName(scope)),
		database: async () => null,
	}, 5);
}

function uniqueName(scope: string): string {
	return `${scope}-${Date.now()}-${Math.random()}`;
}

function bridge(overrides: Partial<DesktopSharedProjectBridge> = {}): DesktopSharedProjectBridge {
	return {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
		...overrides,
	};
}

function throwingSourceAvailability(): DesktopSharedProjectSourceAvailability {
	const unexpected = (operation: string): never => {
		throw new Error(`Repository path unexpectedly called ${operation}.`);
	};
	return {
		getSourceMetadata: async () => unexpected('getSourceMetadata'),
		readSourceChunks: () => unexpected('readSourceChunks'),
		getMediaAssetMetadata: async () => unexpected('getMediaAssetMetadata'),
		loadMediaAsset: async () => unexpected('loadMediaAsset'),
	};
}

function emptyAsyncIterable(): AsyncIterable<never> {
	return {
		[Symbol.asyncIterator]() {
			return {
				next: async () => ({ done: true, value: undefined }),
			};
		},
	};
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function sourceProjectId(document: string): string {
	return String((parseScapeProjectDocument(document) as ProjectDocument).id);
}

function recordingShadow(
	calls: string[],
	options: Readonly<{ deleteFailure?: unknown; saveResult?: ProjectDocument }> = {},
): ProjectRepositoryPort {
	return {
		async save(project) {
			calls.push('local-save');
			return structuredClone(options.saveResult ?? project);
		},
		async load() {
			calls.push('local-load');
			return null;
		},
		async list() {
			calls.push('local-list');
			return [];
		},
		async listRevisions() {
			calls.push('local-revisions');
			return [];
		},
		async delete() {
			calls.push('local-delete');
			if (options.deleteFailure) throw options.deleteFailure;
		},
	};
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') throw new TypeError('Expected a record');
	return value as Record<string, unknown>;
}
