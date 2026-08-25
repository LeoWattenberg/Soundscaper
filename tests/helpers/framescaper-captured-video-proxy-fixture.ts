/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import type { FramescaperCapturedVideoProxyRequest } from '../../src/common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import { request as databaseRequest, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../src/common/editor/storage/media-content-digest.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from '../../src/common/editor/storage/media-asset-staging-schema.ts';
import { MediaPublicationReconciliationError } from '../../src/common/editor/storage/media-asset-owned-publication.ts';
import { VIDEO_PROXY_CLAIM_KIND } from '../../src/common/editor/storage/video-proxy-claim-repository.ts';
import { VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND } from '../../src/common/editor/storage/video-proxy-cleanup-tombstone.ts';
import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import {
	createFramescaperCapturedVideoProxySchedulerV18,
	createFramescaperCapturedVideoProxySchedulerV19,
	createFramescaperCapturedVideoProxySchedulerV20,
	createFramescaperCapturedVideoProxySchedulerV27,
	type FramescaperCapturedVideoProxyScheduler,
} from '../../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV31,
} from '../../src/framescaper/editor-captured-video-proxy-scheduler-v31.ts';
import {
	createFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from '../../src/framescaper/editor-project-environment-v18.ts';
import {
	createFramescaperEditorProjectEnvironmentV19,
	type FramescaperEditorProjectEnvironmentV19,
} from '../../src/framescaper/editor-project-environment-v19.ts';
import {
	createFramescaperEditorProjectEnvironmentV20,
	type FramescaperEditorProjectEnvironmentV20,
} from '../../src/framescaper/editor-project-environment-v20.ts';
import {
	createFramescaperEditorProjectEnvironmentV27,
	type FramescaperEditorProjectEnvironmentV27,
} from '../../src/framescaper/editor-project-environment-v27.ts';
import {
	createFramescaperEditorProjectEnvironmentV31,
	type FramescaperEditorProjectEnvironmentV31,
} from '../../src/framescaper/editor-project-environment-v31.ts';
import { framescaperProjectStoreAuthorityV18 } from '../../src/framescaper/editor-project-store-v18.ts';
import { framescaperProjectStoreAuthorityV19 } from '../../src/framescaper/editor-project-store-v19.ts';
import { framescaperProjectStoreAuthorityV20 } from '../../src/framescaper/editor-project-store-v20.ts';
import { framescaperProjectStoreAuthorityV27 } from '../../src/framescaper/editor-project-store-v27.ts';
import { framescaperProjectStoreAuthorityV31 } from '../../src/framescaper/editor-project-store-v31.ts';
import {
	FramescaperDesktopV10MainFixture,
	installFramescaperDesktopV10Bridge,
} from './framescaper-desktop-v10-store-fixture.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import {
	ORIGINAL_SOURCE_ID,
	createVideoProxyFixture,
	type deferred,
} from './video-proxy-relationship-fixtures.ts';

export type CapturedProxyEnvironment = Readonly<FramescaperEditorProjectEnvironmentV18>
	| Readonly<FramescaperEditorProjectEnvironmentV19>
	| Readonly<FramescaperEditorProjectEnvironmentV20>
	| Readonly<FramescaperEditorProjectEnvironmentV27>
	| Readonly<FramescaperEditorProjectEnvironmentV31>;

export interface CapturedProxyFixture {
	readonly environment: CapturedProxyEnvironment;
	readonly controllerStore: AudioEditorProjectStore;
	readonly session: ReturnType<CapturedProxyEnvironment['runtime']['createSessionController']>;
	readonly relationship: ReturnType<typeof createVideoProxyFixture>;
	readonly originalSha256: string;
	readonly origin: Record<string, unknown>;
	readonly active: Record<string, unknown>;
	readonly schedule: FramescaperCapturedVideoProxyScheduler;
}

export async function createCapturedProxyFixture(
	context: TestContext,
	schemaVersion: 18 | 19 | 20 | 27 | 31,
	secondVideo = false,
	generatorGate?: ReturnType<typeof deferred<void>>,
	desktopMain?: FramescaperDesktopV10MainFixture,
	indexedDB: IDBFactory = createInstrumentedIndexedDB() as unknown as IDBFactory,
): Promise<CapturedProxyFixture> {
	if (desktopMain) installFramescaperDesktopV10Bridge(context, desktopMain.api);
	const options = {
		storeOptions: {
			indexedDB,
			preferOpfs: false,
			storageManager: persistentStorage(),
		},
	};
	const environment: CapturedProxyEnvironment = schemaVersion === 18
		? await createFramescaperEditorProjectEnvironmentV18(options)
		: schemaVersion === 19
			? await createFramescaperEditorProjectEnvironmentV19(options)
			: schemaVersion === 20
				? await createFramescaperEditorProjectEnvironmentV20(options)
				: schemaVersion === 27
					? await createFramescaperEditorProjectEnvironmentV27(options)
					: await createFramescaperEditorProjectEnvironmentV31(options);
	context.after(() => environment.close());
	const relationship = createVideoProxyFixture({ ...(generatorGate ? { generatorGate } : {}) });
	const originalSha256 = await digestMediaContent(relationship.original);
	relationship.setFingerprint({ sha256: originalSha256 });
	const raw = structuredClone(relationship.project());
	raw.id = `captured-proxy-v${String(schemaVersion)}-${secondVideo ? 'two' : generatorGate ? 'race' : 'one'}`;
	const sources = (raw.sources as Record<string, unknown>[]).filter((source) => (
		source.kind === 'video' && source.id === ORIGINAL_SOURCE_ID
	));
	sources[0]!.contentSha256 = originalSha256;
	const projectBin = raw.projectBin as { clips: Record<string, unknown>[] };
	projectBin.clips = projectBin.clips.filter(({ sourceId }) => sourceId === ORIGINAL_SOURCE_ID);
	if (secondVideo) {
		sources.push({
			...structuredClone(sources[0]!),
			id: 'second-video',
			name: 'Second captured video',
			storageKey: 'second-video-storage',
			contentSha256: originalSha256,
			proxyAttachment: null,
		});
		projectBin.clips.push({
			...structuredClone(projectBin.clips[0]!),
			id: 'second-video-bin-clip',
			binItemId: 'second-video-bin-item',
			sourceId: 'second-video',
			title: 'Second captured video',
		});
	}
	const origin = environment.runtime.createProject({
		...raw,
		sources,
		takeGroups: [],
	} as never) as unknown as Record<string, unknown>;
	const active = environment.runtime.createProject({
		id: `active-project-v${String(schemaVersion)}-${secondVideo ? 'two' : generatorGate ? 'race' : 'one'}`,
		title: 'Active project',
	} as never) as unknown as Record<string, unknown>;
	const createdOrigin = await environment.createProjectIfAbsent(origin as never);
	assert.deepEqual(createdOrigin, origin);
	await environment.createProjectIfAbsent(active as never);
	await environment.store.writeMediaAsset(
		'original-source-storage',
		relationship.original,
		{ mimeType: relationship.original.type },
	);
	if (secondVideo) {
		await environment.store.writeMediaAsset(
			'second-video-storage',
			relationship.original,
			{ mimeType: relationship.original.type },
		);
	}
	const session = environment.runtime.createSessionController();
	const controllerStore = schemaVersion === 18 || schemaVersion === 31
		? (environment as Readonly<
			FramescaperEditorProjectEnvironmentV18 | FramescaperEditorProjectEnvironmentV31
		>).controllerStore
		: environment.store;
	session.openProject(origin as never);
	session.openProject(active as never);
	assert.deepEqual(
		session.getSnapshot().tabs.find(
			({ projectId }: { projectId: string }) => projectId === origin.id,
		)?.history.present,
		await controllerStore.loadProject(String(origin.id)),
	);
	const schedule = schemaVersion === 18
		? createFramescaperCapturedVideoProxySchedulerV18(environment, session, {
			runtime: null,
			candidateObserver: relationship.candidateObserver,
		})
		: schemaVersion === 19
			? createFramescaperCapturedVideoProxySchedulerV19(environment, session, {
				runtime: null,
				candidateObserver: relationship.candidateObserver,
			})
			: schemaVersion === 20
				? createFramescaperCapturedVideoProxySchedulerV20(environment, session, {
					runtime: null,
					candidateObserver: relationship.candidateObserver,
				})
				: schemaVersion === 27
					? createFramescaperCapturedVideoProxySchedulerV27(environment, session, {
						runtime: null,
						candidateObserver: relationship.candidateObserver,
					})
					: createFramescaperCapturedVideoProxySchedulerV31(
						environment as Readonly<FramescaperEditorProjectEnvironmentV31>, session, {
						runtime: null,
						candidateObserver: relationship.candidateObserver,
						},
					);
	return {
		environment,
		controllerStore,
		session,
		relationship,
		originalSha256,
		origin,
		active,
		schedule,
	};
}

export function capturedProxyRequest(
	project: Record<string, unknown>,
	sourceId: string,
	digest: string,
): FramescaperCapturedVideoProxyRequest {
	return Object.freeze({
		projectId: String(project.id),
		sessionId: 'captured-session',
		sourceId,
		expectedProjectRevision: Number(project.revision),
		expectedContentSha256: digest,
	});
}

export interface CapturedProxyAttachment extends Record<string, unknown> {
	readonly storageKey: string;
	readonly originalSha256: string;
	readonly timingAsset: Readonly<{ readonly storageKey: string }>;
}

export function capturedVideoSource(project: unknown, sourceId: string): Record<string, unknown> & {
	proxyAttachment: CapturedProxyAttachment | null;
} {
	const sources = (project as { sources: readonly Record<string, unknown>[] }).sources;
	const source = sources.find((candidate) => candidate.id === sourceId);
	assert.ok(source && source.kind === 'video');
	return source as Record<string, unknown> & { proxyAttachment: CapturedProxyAttachment | null };
}

export function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}

export function nextCapturedProxyOrdinaryRevision(
	environment: CapturedProxyEnvironment,
	project: Record<string, unknown>,
	title: string,
): Record<string, unknown> {
	const draft = structuredClone(project);
	draft.title = title;
	draft.revision = Number(draft.revision) + 1;
	draft.updatedAt = new Date(new Date(String(draft.updatedAt)).getTime() + 1).toISOString();
	return (Number(draft.schemaVersion) === 18
		? (environment as FramescaperEditorProjectEnvironmentV18).runtime.cloneProject(draft)
		: Number(draft.schemaVersion) === 19
			? (environment as FramescaperEditorProjectEnvironmentV19).runtime.cloneProject(draft)
			: Number(draft.schemaVersion) === 20
				? (environment as FramescaperEditorProjectEnvironmentV20).runtime.cloneProject(draft)
				: Number(draft.schemaVersion) === 27
					? (environment as FramescaperEditorProjectEnvironmentV27).runtime.cloneProject(draft)
					: (environment as FramescaperEditorProjectEnvironmentV31).runtime.cloneProject(draft)) as unknown as Record<string, unknown>;
}

export async function capturedProxyStorageInventory(environment: CapturedProxyEnvironment): Promise<Readonly<{
	readonly bodyKeys: readonly string[];
	readonly claimKeys: readonly string[];
	readonly tombstoneKeys: readonly string[];
}>> {
	const authority = framescaperCaptureStoreAuthority(environment);
	const database = await authority.port.database();
	assert.ok(database);
	const [bodies, staging] = await transact(
		database,
		['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME],
		'readonly',
		async ({ mediaAssets, mediaAssetStaging }) => Promise.all([
			databaseRequest(mediaAssets.getAll()),
			databaseRequest(mediaAssetStaging.getAll()),
		]),
	);
	const records = (values: unknown[]) => values.filter(
		(value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'),
	);
	return Object.freeze({
		bodyKeys: Object.freeze(records(bodies).filter(({ kind }) => (
			kind === 'video-proxy' || kind === 'video-timing'
		)).map(({ sourceId }) => String(sourceId)).sort()),
		claimKeys: Object.freeze(records(staging).filter(({ kind }) => kind === VIDEO_PROXY_CLAIM_KIND)
			.map(({ key }) => String(key)).sort()),
		tombstoneKeys: Object.freeze(records(staging).filter(({ kind }) => kind === VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND)
			.map(({ key }) => String(key)).sort()),
	});
}

function framescaperCaptureStoreAuthority(environment: CapturedProxyEnvironment) {
	try { return framescaperProjectStoreAuthorityV18(environment.runtime.profile, environment.store); }
	catch {
		try { return framescaperProjectStoreAuthorityV19(environment.runtime.profile, environment.store); }
		catch {
			try { return framescaperProjectStoreAuthorityV20(environment.runtime.profile, environment.store); }
			catch {
				try { return framescaperProjectStoreAuthorityV27(environment.runtime.profile, environment.store); }
				catch { return framescaperProjectStoreAuthorityV31(environment.runtime.profile, environment.store); }
			}
		}
	}
}

export async function writeCapturedProxyOrdinaryBody(
	fixture: CapturedProxyFixture,
	sourceId: string,
	body: Blob,
	metadata: Readonly<Record<string, unknown>>,
): Promise<void> {
	const sha256 = await digestMediaContent(body);
	const writer = await fixture.environment.store.beginMediaAssetWrite(sourceId, metadata, {
		expectedBytes: body.size,
		expectedSha256: sha256,
	});
	await writer.write(new Uint8Array(await body.arrayBuffer()));
	await writer.commit();
}

export function failCapturedProxyFirstBodyPublicationReread(
	context: TestContext,
	fixture: CapturedProxyFixture,
): void {
	const store = fixture.environment.store;
	const original = store.beginMediaAssetWrite;
	Object.defineProperty(store, 'beginMediaAssetWrite', {
		configurable: true,
		value: async (sourceId: string, ...args: unknown[]) => {
			const writer = await Reflect.apply(original, store, [sourceId, ...args]) as Awaited<ReturnType<typeof original>>;
			if (!sourceId.startsWith('video-proxy-sha256:')) return writer;
			return new Proxy(writer, {
				get(target, property) {
					if (property === 'commitVideoProxyClaim') return async (...commitArgs: unknown[]) => {
						await Reflect.apply(target.commitVideoProxyClaim, target, commitArgs);
						throw new MediaPublicationReconciliationError(
							new Error('planned exception after atomic proxy claim publication'),
							new Error('planned first proxy claim reread failure'),
						);
					};
					const value = Reflect.get(target, property, target) as unknown;
					return typeof value === 'function' ? value.bind(target) : value;
				},
			});
		},
	});
	context.after(() => { delete (store as unknown as Record<string, unknown>).beginMediaAssetWrite; });
}
