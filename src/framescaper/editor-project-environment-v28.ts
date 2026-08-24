/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectFramescaperDesktopProjectLibraryV19Renderer,
	type FramescaperDesktopProjectLibraryV19Renderer,
} from './desktop-project-library-v19-renderer.ts';
import { createFramescaperDesktopProjectStoreV19Adapter } from './desktop-project-library-v19-store-adapter.ts';
import { createFramescaperPlaybackProjectServiceV28 } from './editor-project-playback-v28.ts';
import {
	createEditorProjectRuntimeV28Selection,
	type EditorProjectRuntimeV28Selection,
} from './editor-project-runtime-v28-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectStoreAuthorityV28 } from './editor-project-store-v28.ts';
import {
	createFramescaperVideoProxyCleanupCoordinatorV20,
	type FramescaperVideoProxyCleanupCoordinatorV20,
} from './editor-video-proxy-cleanup-v20.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV28Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV28 {
	readonly runtime: Readonly<EditorProjectRuntimeV28Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV19Renderer | null;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly videoProxyCleanup: FramescaperVideoProxyCleanupCoordinatorV20;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the exact V28 browser store. Desktop V19 composition is injected at its owned seam. */
export async function createFramescaperEditorProjectEnvironmentV28(
	optionsValue: FramescaperEditorProjectEnvironmentV28Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV28>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV28Selection(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V28 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, store);
		if (!authority.opfs) throw new TypeError('The exact V28 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper V28 startup proxy-claim cleanup is indeterminate.');
		}
		const desktopProjectLibrary = await connectFramescaperDesktopProjectLibraryV19Renderer(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			store,
		);
		const controllerStore = createFramescaperDesktopProjectStoreV19Adapter(
			FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
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
			playback: createFramescaperPlaybackProjectServiceV28(
				FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
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
				'Framescaper V28 environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV28(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV28> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V28 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV28>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact V28 create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV28Options {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V28 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper V28 environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V28 storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
