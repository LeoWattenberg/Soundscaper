/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectFramescaperDesktopProjectLibraryV17Renderer,
	type FramescaperDesktopProjectLibraryV17Renderer,
} from './desktop-project-library-v17-renderer.ts';
import {
	createFramescaperDesktopProjectStoreV17Adapter,
} from './desktop-project-library-v17-store-adapter.ts';
import {
	createFramescaperPlaybackProjectServiceV20,
} from './editor-project-playback-v20.ts';
import {
	createEditorProjectRuntimeV20Selection,
	type EditorProjectRuntimeV20Selection,
} from './editor-project-runtime-v20-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { framescaperProjectStoreAuthorityV20 } from './editor-project-store-v20.ts';
import {
	createFramescaperVideoProxyCleanupCoordinatorV20,
	type FramescaperVideoProxyCleanupCoordinatorV20,
} from './editor-video-proxy-cleanup-v20.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV20Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV20 {
	readonly runtime: Readonly<EditorProjectRuntimeV20Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV17Renderer | null;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly videoProxyCleanup: FramescaperVideoProxyCleanupCoordinatorV20;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/**
 * Open the selected exact-V20 browser authority, including inherited capture
 * attachment cleanup over its authenticated V18 preservation foundation.
 */
export async function createFramescaperEditorProjectEnvironmentV20(
	optionsValue: FramescaperEditorProjectEnvironmentV20Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV20>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV20Selection(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V20 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV20(
			FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact V20 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper V20 startup claim cleanup is indeterminate.');
		}
		const desktopProjectLibrary = await connectFramescaperDesktopProjectLibraryV17Renderer(
			FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
			store,
		);
		const controllerStore = createFramescaperDesktopProjectStoreV17Adapter(
			FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
			{ localStore: store, desktopProjectLibrary },
		) as AudioEditorProjectStore;
		const videoProxyCleanup = createFramescaperVideoProxyCleanupCoordinatorV20(
			store,
			controllerStore,
		);
		await videoProxyCleanup.recover();
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore,
			desktopProjectLibrary,
			claimCleanup,
			videoProxyCleanup,
			initialCleanup,
			playback: createFramescaperPlaybackProjectServiceV20(
				FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
				{ timingStore: store },
			),
			createProjectIfAbsent: controllerStore === store
				? (project: ProjectDocument) => exactProjectRepository(store).createIfAbsent(project)
				: (project: ProjectDocument) => (
					controllerStore as unknown as Readonly<{
						createProjectIfAbsent(value: unknown): Promise<ProjectDocument | null>;
					}>
				).createProjectIfAbsent(project),
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
				'Framescaper V20 environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV20(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV20> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V20 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV20>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = (store as unknown as {
		readonly projectRepository?: Readonly<{
			createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
		}>;
	}).projectRepository;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact V20 create-only project repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV20Options {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V20 environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V20 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Framescaper V20 environment options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V20 environment option storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
