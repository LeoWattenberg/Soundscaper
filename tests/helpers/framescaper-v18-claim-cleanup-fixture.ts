/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';

import {
	createVideoSource,
	createVideoTrack,
} from '../../src/common/editor/project-media-factory.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import {
	MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_CHUNK_STORE_NAME,
} from '../../src/common/editor/storage/media-asset-chunk-schema.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../../src/common/editor/storage/media-asset-staging-schema.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import type { StorageRepositoryPort } from '../../src/common/editor/storage/repository-port.ts';
import { VideoProxyClaimStagingRepository } from '../../src/common/editor/storage/video-proxy-claim-staging-repository.ts';
import { VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND } from '../../src/common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	type VideoProxyClaimRecord,
	videoProxyClaimKey,
} from '../../src/common/editor/storage/video-proxy-claim-repository.ts';
import {
	FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18,
} from '../../src/framescaper/editor-project-feature-requirements-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
} from '../../src/framescaper/editor-project-v18-claim-cleanup-repository.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../../src/framescaper/editor-project-v18.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
export const PROJECT_ID = 'framescaper-cleanup';
export const SOURCE_ID = 'video-source';
export const ORIGINAL_SHA = '12'.repeat(32);
export const PROXY_SHA = '34'.repeat(32);
export const TIMING_SHA = '56'.repeat(32);
export const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA}`;
export const TIMING_KEY = `video-timing-sha256:${TIMING_SHA}`;
/** 2026-08-12T16:00:00.000Z: between the lapsed and live staging graces below. */
export const NOW = 1_786_550_400_000;
export const LAPSED_GRACE = '2026-08-12T00:00:00.000Z';
export const LIVE_GRACE = '2026-08-14T00:00:00.000Z';

export interface InstrumentedIndexedDB extends IDBFactory {
	onNextGetForStore(storeName: string, observer: () => void): void;
}

export interface ClaimCleanupFixture {
	readonly database: IDBDatabase;
	readonly indexedDB: InstrumentedIndexedDB;
	readonly files: Map<string, Blob>;
	readonly opfsFailures: { remaining: number };
	readonly repository: FramescaperProjectV18ClaimCleanupRepository;
	readonly staging: VideoProxyClaimStagingRepository;
}

export async function createClaimCleanupFixture(
	context: TestContext,
	options: Readonly<{ maximumInventory?: number }> = {},
): Promise<ClaimCleanupFixture> {
	const name = uniqueName('v18-claim-cleanup');
	const indexedDB = createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
	const database = await openDatabase(indexedDB, name);
	context.after(() => database.close());
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(name),
		database: async () => database,
	};
	const files = new Map<string, Blob>();
	const opfsFailures = { remaining: 0 };
	const opfs = new OpfsRepository({
		preferOpfs: true,
		opfsRoot: opfsRoot(files, opfsFailures),
	});
	return {
		database,
		indexedDB,
		files,
		opfsFailures,
		staging: new VideoProxyClaimStagingRepository(port, opfs, { now: () => NOW }),
		repository: new FramescaperProjectV18ClaimCleanupRepository(PROFILE, {
			port,
			opfs,
			now: () => NOW,
			maximumInventory: options.maximumInventory,
		}),
	};
}

export function emptyScope() {
	return {
		sessionProjects: [],
		histories: [],
		pendingSaveSnapshots: [],
	};
}

export function attachedProject(): FramescaperProjectV18 {
	const project = structuredClone(createFramescaperProjectV18(PROFILE, {
		id: PROJECT_ID,
		title: 'Cleanup fixture',
		now: '2026-08-13T10:00:00.000Z',
		sources: [createVideoSource({
			id: SOURCE_ID,
			name: 'Video',
			storageKey: 'owned/video-source',
			mimeType: 'video/mp4',
			contentSha256: ORIGINAL_SHA,
			frameCount: 48_000,
			sampleFrameCount: 48_000,
			sourceFrameCount: 10,
			frameRate: { num: 10, den: 1 },
			width: 1920,
			height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'video-clip', sourceId: SOURCE_ID, title: 'Video',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: true,
		})],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
	})) as unknown as Record<string, unknown>;
	((project.sources as Record<string, unknown>[])[0]!).proxyAttachment = {
		kind: 'video-proxy-attachment', version: 1,
		rule: 'exact-original-generation-proxy-content-and-timing-v1',
		storageKey: PROXY_KEY, mimeType: 'video/mp4', byteLength: 4,
		sha256: PROXY_SHA, originalSha256: ORIGINAL_SHA, originalAuthorityKind: 'owned',
		generatorId: 'ffmpeg', generatorVersion: 1, recipeId: 'editor-proxy', recipeVersion: 1,
		timingBackendId: 'ffprobe', timingRule: 'exact-presentation-boundaries-v1',
		frameCount: 10, boundaryCount: 11,
		timingAsset: {
			encoding: 'soundscaper-video-timing-v1', storageKey: TIMING_KEY,
			sha256: TIMING_SHA, sourceSha256: PROXY_SHA, byteLength: 112,
			frameCount: 10, timescale: 10, finalFrameDurationTicks: '1',
		},
		audioPolicy: 'ignore-proxy-container-audio-v1',
	};
	const manifest = project.featureRequirements as { schemaVersion: 2; requirements: unknown[] };
	project.featureRequirements = {
		schemaVersion: 2,
		requirements: [...manifest.requirements, FRAMESCAPER_VIDEO_PROXY_REQUIREMENT_V18],
	};
	return project as unknown as FramescaperProjectV18;
}

export function bodyRow(
	bodyKind: 'proxy' | 'timing',
	physical: Readonly<Record<string, unknown>> = {
		storage: 'opfs',
		path: bodyKind === 'proxy' ? 'proxy/body.bin' : 'proxy/timing.bin',
	},
	pendingProjectUntil = LAPSED_GRACE,
): Record<string, unknown> {
	const sha256 = bodyKind === 'proxy' ? PROXY_SHA : TIMING_SHA;
	const sourceId = bodyKind === 'proxy' ? PROXY_KEY : TIMING_KEY;
	return {
		sourceId,
		kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
		encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
		...physical,
		mediaContentDigestVersion: 1,
		mediaContentToken: `media-content-${bodyKind}-0000000000000001`,
		sha256,
		size: bodyKind === 'proxy' ? 4 : 112,
		mimeType: bodyKind === 'proxy' ? 'video/mp4' : 'application/vnd.soundscaper.video-timing',
		committedAt: '2026-08-13T00:00:00.000Z',
		pendingProjectUntil,
	};
}

export function claim(
	bodyKind: 'proxy' | 'timing',
	bodyKey: string,
	sha256: string,
	operationId = 'cleanup-operation',
	lease: 'lapsed' | 'live' = 'lapsed',
): VideoProxyClaimRecord {
	const expiresAt = lease === 'live' ? NOW + 10_000 : NOW - 10_000;
	return claimForRow({
		key: '',
		kind: 'video-proxy-claim',
		schemaVersion: 1,
		status: 'verified',
		operationId,
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		baseFingerprint: 'ab'.repeat(32),
		bodyKind,
		bodyKey,
		generation: `generation-${operationId}`,
		createdAt: expiresAt - 40_000,
		updatedAt: expiresAt - 30_000,
		expiresAt,
		rowIdentity: {} as VideoProxyClaimRecord['rowIdentity'],
	}, bodyRow(bodyKind)) as VideoProxyClaimRecord;
}

export function claimForRow(
	claimValue: VideoProxyClaimRecord,
	row: Readonly<Record<string, unknown>>,
): VideoProxyClaimRecord {
	const bodyKind = claimValue.bodyKind;
	const bodyKey = String(row.sourceId);
	return {
		...claimValue,
		key: videoProxyClaimKey(claimValue.operationId, bodyKind, bodyKey),
		bodyKey,
		rowIdentity: {
			sourceId: bodyKey,
			kind: bodyKind === 'proxy' ? 'video-proxy' : 'video-timing',
			encoding: bodyKind === 'proxy' ? 'video-proxy-v1' : 'soundscaper-video-timing-v1',
			storage: row.storage as 'opfs' | typeof MEDIA_ASSET_CHUNK_STORAGE_TYPE,
			path: row.storage === 'opfs' ? String(row.path) : null,
			mediaChunkToken: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? String(row.mediaChunkToken) : null,
			mediaChunkBytes: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? Number(row.mediaChunkBytes) : null,
			mediaChunkCount: row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				? Number(row.mediaChunkCount) : null,
			mediaContentDigestVersion: 1,
			mediaContentToken: String(row.mediaContentToken),
			sha256: String(row.sha256),
			byteLength: Number(row.size),
			mimeType: String(row.mimeType),
		},
	};
}

export function seedProject(database: IDBDatabase, project: FramescaperProjectV18): Promise<void> {
	return transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => {
		projects.put(project);
		revisions.put({
			key: `${project.id}:${String(project.revision).padStart(12, '0')}`,
			projectId: project.id,
			revision: project.revision,
			project,
		});
	});
}

export function seedBodiesAndClaims(
	database: IDBDatabase,
	items: readonly { readonly row?: Record<string, unknown>; readonly claim: VideoProxyClaimRecord }[],
): Promise<void> {
	return transact(
		database,
		['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readwrite',
		({ mediaAssets, mediaAssetStaging }) => {
			for (const item of items) {
				if (item.row) mediaAssets.put(item.row);
				mediaAssetStaging.put(item.claim);
			}
		},
	);
}

export function clearStaging(database: IDBDatabase): Promise<void> {
	return transact(database, MEDIA_ASSET_STAGING_STORE_NAME, 'readwrite', async ({ mediaAssetStaging }) => {
		for (const item of await request(mediaAssetStaging.index('kind').getAll('video-proxy-claim'))) {
			await request(mediaAssetStaging.delete((item as { key: string }).key));
		}
	});
}

export function mediaRow(database: IDBDatabase, bodyKey: string): Promise<unknown> {
	return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(bodyKey)));
}

export function stagingRecord(database: IDBDatabase, key: string): Promise<unknown> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(mediaAssetStaging.get(key)),
	);
}

export function tombstones(database: IDBDatabase): Promise<unknown[]> {
	return transact(
		database,
		MEDIA_ASSET_STAGING_STORE_NAME,
		'readonly',
		({ mediaAssetStaging }) => request(
			mediaAssetStaging.index('kind').getAll(VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND),
		),
	);
}

export function chunkCount(database: IDBDatabase): Promise<number> {
	return transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
		request(stores[MEDIA_ASSET_CHUNK_STORE_NAME].count())
	));
}

export function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function opfsRoot(
	files: Map<string, Blob>,
	failures: { remaining: number },
): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string) {
			const file = files.get(path);
			if (!file) throw new DOMException('missing', 'NotFoundError');
			return { async getFile() { return file; } };
		},
		async removeEntry(path: string) {
			if (failures.remaining > 0) {
				failures.remaining -= 1;
				throw new Error('injected OPFS cleanup failure');
			}
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
