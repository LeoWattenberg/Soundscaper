/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectFramescaperDesktopProjectLibraryRenderer,
	type FramescaperDesktopProjectLibraryRenderer,
} from './desktop-project-library-renderer.ts';
import { createFramescaperDesktopProjectStoreAdapter } from
	'./desktop-project-library-store-adapter.ts';
import {
	FramescaperProjectSequenceClaimCleanupRepository,
	type FramescaperProjectSequenceClaimCleanupResult,
} from './editor-project-sequence-claim-cleanup-repository.ts';
import { createFramescaperPlaybackProjectService } from './editor-project-playback.ts';
import {
	createEditorProjectRuntimeSelection,
	type EditorProjectRuntimeSelection,
} from './editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import {
	framescaperProjectStoreAuthority,
	type FramescaperProjectStoreAuthority,
} from './editor-project-store.ts';
import {
	createFramescaperVideoProxyCleanupCoordinatorRetime,
	type FramescaperVideoProxyCleanupCoordinatorRetime,
} from './editor-video-proxy-cleanup-retime.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentOptions {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironment {
	readonly runtime: Readonly<EditorProjectRuntimeSelection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryRenderer | null;
	readonly playback: PlaybackProjectService;
	readonly timelineImages: FramescaperProjectStoreAuthority['timelineImages'];
	readonly claimCleanup: FramescaperProjectSequenceClaimCleanupRepository;
	readonly videoProxyCleanup: FramescaperVideoProxyCleanupCoordinatorRetime;
	readonly initialCleanup: Readonly<FramescaperProjectSequenceClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the fresh Framescaper v1 browser authority. Desktop composition is attached separately. */
export async function createFramescaperEditorProjectEnvironment(
	optionsValue: FramescaperEditorProjectEnvironmentOptions | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironment>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory Framescaper project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthority(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact Framescaper OPFS repository is required.');
		const claimCleanup = new FramescaperProjectSequenceClaimCleanupRepository(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper startup proxy-claim cleanup is indeterminate.');
		}
		const desktopProjectLibrary = await connectFramescaperDesktopProjectLibraryRenderer(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			store,
		);
		const controllerStore = createFramescaperDesktopProjectStoreAdapter(
			FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
			{ localStore: store, desktopProjectLibrary },
		) as AudioEditorProjectStore;
		const videoProxyCleanup = createFramescaperVideoProxyCleanupCoordinatorRetime(
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
			playback: createFramescaperPlaybackProjectService(
				FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
				{ timingStore: store },
			),
			timelineImages: authority.timelineImages,
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
				'Framescaper environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironment(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironment> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironment>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact Framescaper create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentOptions {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
