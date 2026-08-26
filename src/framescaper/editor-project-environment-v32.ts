/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import { createFramescaperPlaybackProjectServiceV32 } from './editor-project-playback-v32.ts';
import {
	createEditorProjectRuntimeV32Selection,
	type EditorProjectRuntimeV32Selection,
} from './editor-project-runtime-v32-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v32.ts';
import {
	framescaperProjectStoreAuthorityV32,
	type FramescaperProjectStoreAuthorityV32,
} from './editor-project-store-v32.ts';
import {
	createFramescaperVideoProxyCleanupCoordinatorV20,
	type FramescaperVideoProxyCleanupCoordinatorV20,
} from './editor-video-proxy-cleanup-v20.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV32Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV32 {
	readonly runtime: Readonly<EditorProjectRuntimeV32Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly playback: PlaybackProjectService;
	readonly timelineImages: FramescaperProjectStoreAuthorityV32['timelineImages'];
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly videoProxyCleanup: FramescaperVideoProxyCleanupCoordinatorV20;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the exact V32 browser store and its authenticated timeline-image publisher. */
export async function createFramescaperEditorProjectEnvironmentV32(
	optionsValue: FramescaperEditorProjectEnvironmentV32Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV32>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV32Selection(FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V32 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV32(
			FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact V32 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper V32 startup proxy-claim cleanup is indeterminate.');
		}
		const videoProxyCleanup = createFramescaperVideoProxyCleanupCoordinatorV20(store, store);
		await videoProxyCleanup.recover();
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore: store,
			playback: createFramescaperPlaybackProjectServiceV32(
				FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE,
				{ timingStore: store },
			),
			timelineImages: authority.timelineImages,
			claimCleanup,
			videoProxyCleanup,
			initialCleanup,
			createProjectIfAbsent: (project: ProjectDocument) => exactProjectRepository(store)
				.createIfAbsent(project),
			close: () => store.close(),
		});
		PRODUCT_ENVIRONMENTS.add(environment);
		return environment;
	} catch (error) {
		try {
			await store.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Framescaper V32 environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV32(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV32> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V32 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV32>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact V32 create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV32Options {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V32 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper V32 environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V32 storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
