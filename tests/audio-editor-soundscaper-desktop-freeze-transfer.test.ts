/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { StorageRecord } from '../src/common/editor/storage/media-records.ts';
import type { AudioSourceWriter } from '../src/common/editor/storage/source-write-repository.ts';
import {
	acquireSoundscaperDesktopFreezeBodies,
	streamSoundscaperDesktopFreezeBody,
	type SoundscaperDesktopFreezeStore,
} from '../src/soundscaper/desktop-project-library-freeze-media.ts';
import type {
	SoundscaperDesktopBody,
	SoundscaperDesktopBundleSnapshot,
	SoundscaperDesktopRendererBridge,
} from '../src/soundscaper/desktop-project-library-renderer-contract.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { SoundscaperDesktopDeleteIntents } from '../src/soundscaper/desktop-project-library-delete-intents.ts';
import {
	snapshotSoundscaperDesktopProject,
	validateSoundscaperDesktopBundle,
} from '../src/soundscaper/desktop-project-library-renderer-contract.ts';
import {
	SoundscaperDesktopProjectLibraryIndeterminateError,
	SoundscaperDesktopRendererCatalog,
} from '../src/soundscaper/desktop-project-library-renderer-catalog.ts';
import { SoundscaperDesktopWitnessLedger } from '../src/soundscaper/desktop-project-library-renderer-lifecycle.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile.ts';

const SOURCE_ID = 'frozen-track-source';
const STORAGE_KEY = 'derived:frozen-track-source';
const SAMPLES = new Float32Array([0.25, -0.5]);
const PCM = canonicalPcm(SAMPLES);
const DIGEST = createHash('sha256').update(PCM).digest('hex');

test('desktop freeze publication streams the exact canonical PCM bytes and final offset', async () => {
	const { project, body } = freezeFixture();
	const delivered: Array<{ offset: number; bytes: Uint8Array; final: boolean }> = [];
	await streamSoundscaperDesktopFreezeBody(project, body, {
		async *readSourceChunks(sourceId) {
			assert.equal(sourceId, STORAGE_KEY);
			yield [SAMPLES];
		},
	}, async (offset, bytes, final) => {
		delivered.push({ offset, bytes: bytes.slice(), final });
	});
	assert.deepEqual(delivered.map(({ offset, final }) => ({ offset, final })), [
		{ offset: 0, final: false },
		{ offset: 4, final: true },
	]);
	assert.deepEqual(Buffer.concat(delivered.map(({ bytes }) => bytes)), Buffer.from(PCM));
});

test('desktop freeze publication rejects changed local PCM after the exact body was planned', async () => {
	const { project, body } = freezeFixture();
	await assert.rejects(streamSoundscaperDesktopFreezeBody(project, body, {
		async *readSourceChunks() { yield [new Float32Array([0.25, 0.5])]; },
	}, () => undefined), /changed before desktop publication/u);
	await assert.rejects(streamSoundscaperDesktopFreezeBody(project, body, {
		async *readSourceChunks() { yield [new Float32Array([0.25])]; },
	}, () => undefined), /noncanonical PCM chunk geometry/u);
});

test('desktop freeze receipt acquires an absent source create-only and rolls back its exact record', async () => {
	const fixture = freezeFixture();
	const writes: readonly Float32Array[][] = [];
	const commits: Array<Readonly<{ ifAbsent?: boolean }>> = [];
	const discarded: StorageRecord[] = [];
	const record: StorageRecord = { id: STORAGE_KEY, sourceToken: 'owned-token' };
	const store = freezeStore({
		beginSourceWrite: async (sourceId, metadata) => {
			assert.equal(sourceId, STORAGE_KEY);
			assert.equal(metadata?.sampleRate, 48_000);
			return writer({
				write: async (channels) => { (writes as Float32Array[][]).push(channels as Float32Array[]); },
				commit: async (_metadata, options) => {
					commits.push({ ifAbsent: options?.ifAbsent });
					return record;
				},
			});
		},
		discardSourceIfCurrent: async (value) => { discarded.push(value); return true; },
	});
	const requested: unknown[] = [];
	const bridge: Pick<SoundscaperDesktopRendererBridge, 'readBodyChunk'> = {
		readBodyChunk: async (request) => {
			requested.push(request);
			return PCM.slice();
		},
	};
	const acquired = await acquireSoundscaperDesktopFreezeBodies(fixture.snapshot, bridge, store);
	assert.equal(acquired.acquiredBodyCount, 1);
	assert.equal(requested.length, 1);
	assert.deepEqual(writes.map(([channel]) => [...channel!]), [[...SAMPLES]]);
	assert.deepEqual(commits, [{ ifAbsent: true }]);
	await acquired.rollback();
	await acquired.rollback();
	assert.deepEqual(discarded, [record]);
});

test('desktop freeze receipt verifies an existing local body before trusting it', async () => {
	const fixture = freezeFixture();
	let remoteReads = 0;
	const bridge: Pick<SoundscaperDesktopRendererBridge, 'readBodyChunk'> = {
		readBodyChunk: async () => { remoteReads += 1; return PCM.slice(); },
	};
	const store = freezeStore({
		getSourceMetadata: async () => ({
			id: STORAGE_KEY, frameCount: 2, channelCount: 1,
			chunkFrames: 2, sampleRate: 48_000,
		}),
		beginSourceWrite: async () => { throw new Error('existing source must not be replaced'); },
	});
	const acquired = await acquireSoundscaperDesktopFreezeBodies(fixture.snapshot, bridge, store);
	assert.equal(acquired.acquiredBodyCount, 0);
	assert.equal(remoteReads, 0);
	acquired.commit();
	await acquired.rollback();
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture.snapshot, bridge,
		freezeStore({
			getSourceMetadata: async () => ({
				id: STORAGE_KEY, frameCount: 2, channelCount: 1,
				chunkFrames: 2, sampleRate: 44_100,
			}),
		}),
	), /conflicts with its desktop body/u);
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture.snapshot, bridge,
		freezeStore({
			getSourceMetadata: async () => ({
				id: STORAGE_KEY, frameCount: 2, channelCount: 1,
				chunkFrames: 2, sampleRate: 48_000,
			}),
			readSourceChunks: async function* () { yield [new Float32Array([0.25, 0.5])]; },
		}),
	), /changed canonical PCM bytes/u);
	assert.equal(remoteReads, 0);
});

test('desktop freeze transfer aborts a short remote body without publishing the source', async () => {
	const fixture = freezeFixture();
	let aborted = 0;
	let committed = 0;
	const store = freezeStore({
		beginSourceWrite: async () => writer({
			commit: async () => { committed += 1; return { id: STORAGE_KEY }; },
			abort: async () => { aborted += 1; },
		}),
	});
	await assert.rejects(acquireSoundscaperDesktopFreezeBodies(fixture.snapshot, {
		readBodyChunk: async () => PCM.subarray(0, PCM.byteLength - 1),
	}, store), /exact length/u);
	assert.equal(aborted, 1);
	assert.equal(committed, 0);
});

test('desktop catalog delete keeps its intent until the exact shadow is gone', async () => {
	const project = createSoundscaperProject({
		id: 'catalog-project', title: 'Catalog project', now: '2026-09-24T00:00:00.000Z',
	});
	const snapshot = catalogBundle(project, 4);
	const ledger = new SoundscaperDesktopWitnessLedger(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE);
	ledger.rememberCurrent(snapshot);
	const pending = new Map<string, unknown>();
	const intents = new SoundscaperDesktopDeleteIntents({
		putIfAbsent(key, value) {
			if (pending.has(key)) return false;
			pending.set(key, value);
			return true;
		},
		deleteIfCurrent(key, value) {
			if (pending.get(key) !== value) return false;
			pending.delete(key);
			return true;
		},
		listByPrefix(prefix) {
			return [...pending].filter(([key]) => key.startsWith(prefix))
				.map(([key, value]) => ({ key, value }));
		},
	});
	let shadow: SoundscaperProject | null = project;
	const catalog = new SoundscaperDesktopRendererCatalog({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		store: {
			loadProject: () => shadow,
			projectRepository: {
				deleteExact: (value) => {
					assert.deepEqual(value, project);
					shadow = null;
					return true;
				},
			},
		},
		bridge: {
			listProjects: async () => ({ metadataRevision: 4, projects: [catalogSummary(project)] }),
			deleteProject: async (request: unknown) => {
				assert.deepEqual(request, {
					projectId: String(project.id),
					expectedMetadataRevision: 4,
					expectedProject: {
						projectRevision: Number(project.revision),
						projectSha256: snapshot.bundle.project.sha256,
					},
				});
				return { projectId: String(project.id), metadataRevision: 5, deleted: true };
			},
		} as unknown as SoundscaperDesktopRendererBridge,
		ledger,
		intents,
		reconcile: async (value) => value.project,
	});
	assert.deepEqual(await catalog.listProjects(), [catalogSummary(project)]);
	assert.equal(await catalog.cleanupDeletedProject(String(project.id)), false);
	await catalog.deleteProject(String(project.id));
	assert.equal(shadow, null);
	assert.equal(pending.size, 1);
	assert.equal(await catalog.settleDeletedProject(String(project.id)), true);
	assert.equal(pending.size, 0);
	assert.equal(await catalog.settleDeletedProject(String(project.id)), false);
});

test('desktop publication recovery distinguishes committed, unchanged, and divergent outcomes', async () => {
	const project = createSoundscaperProject({
		id: 'recovered-project', title: 'Recovered project', now: '2026-09-24T00:00:00.000Z',
	});
	const committed = catalogBundle(project, 8);
	let result: unknown = committed.bundle;
	let catalogRevision = 7;
	const ledger = new SoundscaperDesktopWitnessLedger(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE);
	const catalog = new SoundscaperDesktopRendererCatalog({
		profile: SOUNDSCAPER_PROJECT_RUNTIME_PROFILE,
		store: {
			loadProject: () => null,
			projectRepository: { deleteExact: () => false },
		},
		bridge: {
			readProjectBundle: async () => result,
			listProjects: async () => ({ metadataRevision: catalogRevision, projects: [] }),
		} as unknown as SoundscaperDesktopRendererBridge,
		ledger,
		intents: {} as SoundscaperDesktopDeleteIntents,
		reconcile: async (value) => value.project,
	});
	const request = { project, expectedMetadataRevision: 7, expectedProject: null };
	assert.deepEqual((await catalog.recoverPublication(request, new Error('ack lost')))?.project, project);
	result = null;
	assert.equal(await catalog.recoverPublication(request, new Error('publish refused')), null);
	catalogRevision = 8;
	await assert.rejects(catalog.recoverPublication(request, new Error('ack lost')),
		SoundscaperDesktopProjectLibraryIndeterminateError);
});

function freezeFixture(): Readonly<{
	project: SoundscaperProject;
	body: SoundscaperDesktopBody;
	snapshot: SoundscaperDesktopBundleSnapshot;
}> {
	const project = {
		sources: [{
			id: SOURCE_ID, kind: 'audio', name: 'Frozen track', storageKey: STORAGE_KEY,
			mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
			frameCount: 2, chunkFrames: 2, contentSha256: DIGEST,
		}],
	} as unknown as SoundscaperProject;
	const body: SoundscaperDesktopBody = {
		kind: 'audio-freeze', encoding: 'audio-f32le-chunks-v1',
		bindingId: `f${'ab'.repeat(32)}`, sourceId: SOURCE_ID, storageKey: STORAGE_KEY,
		mimeType: 'application/vnd.soundscaper.audio-f32le-chunks',
		byteLength: PCM.byteLength, sha256: DIGEST,
	};
	const snapshot = {
		project,
		bundle: {
			metadataRevision: 3,
			project: { projectId: 'freeze-project', projectRevision: 1, sha256: 'cd'.repeat(32) },
			bodies: [body],
		},
	} as unknown as SoundscaperDesktopBundleSnapshot;
	return { project, body, snapshot };
}

function catalogBundle(project: SoundscaperProject, metadataRevision: number): SoundscaperDesktopBundleSnapshot {
	const snapshot = snapshotSoundscaperDesktopProject(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, project);
	const entryId = 'entry0001';
	return validateSoundscaperDesktopBundle(SOUNDSCAPER_PROJECT_RUNTIME_PROFILE, {
		metadataRevision,
		project: {
			id: entryId, projectId: String(project.id), name: String(project.title),
			metadataFile: `${entryId}/${String(project.revision)}-${snapshot.sha256}.json`,
			preferredProduct: 'soundscaper', updatedAtMs: Date.parse(String(project.updatedAt)),
			schemaFamily: project.schemaFamily, schemaVersion: project.schemaVersion,
			projectRevision: Number(project.revision), byteLength: snapshot.byteLength,
			sha256: snapshot.sha256,
		},
		document: snapshot.document,
		bodies: [],
	}, String(project.id));
}

function catalogSummary(project: SoundscaperProject) {
	return {
		schemaFamily: project.schemaFamily, schemaVersion: project.schemaVersion,
		id: String(project.id), title: String(project.title),
		revision: Number(project.revision), updatedAt: String(project.updatedAt),
	};
}

function canonicalPcm(samples: Float32Array): Uint8Array {
	const bytes = new Uint8Array(4 + samples.byteLength);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, samples.length, true);
	for (let index = 0; index < samples.length; index += 1) {
		view.setFloat32(4 + index * 4, samples[index]!, true);
	}
	return bytes;
}

function writer(overrides: Partial<AudioSourceWriter> = {}): AudioSourceWriter {
	return {
		framesWritten: 0,
		write: async () => undefined,
		commit: async () => ({ id: STORAGE_KEY }),
		abort: async () => undefined,
		...overrides,
	};
}

function freezeStore(overrides: Partial<SoundscaperDesktopFreezeStore> = {}): SoundscaperDesktopFreezeStore {
	return {
		getSourceMetadata: async () => null,
		readSourceChunks: async function* () { yield [SAMPLES]; },
		beginSourceWrite: async () => writer(),
		discardSourceIfCurrent: async () => true,
		...overrides,
	};
}
