/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import type {
	FramescaperDesktopProjectLibraryV20Renderer,
} from './desktop-project-library-v20-renderer-contract.ts';
import { createFramescaperPlaybackProjectServiceV31 } from './editor-project-playback-v31.ts';
import {
	createEditorProjectRuntimeV31Selection,
	type EditorProjectRuntimeV31Selection,
} from './editor-project-runtime-v31-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectStoreAuthorityV31 } from './editor-project-store-v31.ts';
import {
	createFramescaperVideoProxyCleanupCoordinatorV20,
	type FramescaperVideoProxyCleanupCoordinatorV20,
} from './editor-video-proxy-cleanup-v20.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV31Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV31 {
	readonly runtime: Readonly<EditorProjectRuntimeV31Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV20Renderer | null;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly videoProxyCleanup: FramescaperVideoProxyCleanupCoordinatorV20;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the prepared exact-F31 browser store without selecting the product route. */
export async function createFramescaperEditorProjectEnvironmentV31(
	optionsValue: FramescaperEditorProjectEnvironmentV31Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV31>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory F31 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV31(
			FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact F31 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper F31 startup proxy-claim cleanup is indeterminate.');
		}
		const controllerStore = store;
		const videoProxyCleanup = createFramescaperVideoProxyCleanupCoordinatorV20(
			store,
			controllerStore,
		);
		await videoProxyCleanup.recover();
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore,
			desktopProjectLibrary: null,
			claimCleanup,
			videoProxyCleanup,
			initialCleanup,
			playback: createFramescaperPlaybackProjectServiceV31(
				FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
				{ timingStore: store },
			),
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
				'Framescaper F31 environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV31(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV31> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper F31 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV31>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact F31 create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV31Options {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper F31 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper F31 environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper F31 storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
