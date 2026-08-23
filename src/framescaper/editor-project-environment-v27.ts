/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectFramescaperDesktopProjectLibraryV18Renderer,
	type FramescaperDesktopProjectLibraryV18Renderer,
} from './desktop-project-library-v18-renderer.ts';
import { createFramescaperDesktopProjectStoreV18Adapter } from './desktop-project-library-v18-store-adapter.ts';
import { createFramescaperPlaybackProjectServiceV27 } from './editor-project-playback-v27.ts';
import {
	createEditorProjectRuntimeV27Selection,
	type EditorProjectRuntimeV27Selection,
} from './editor-project-runtime-v27-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectStoreAuthorityV27 } from './editor-project-store-v27.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV27Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV27 {
	readonly runtime: Readonly<EditorProjectRuntimeV27Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV18Renderer | null;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the exact V27 browser store. Desktop V18 composition is injected at its owned seam. */
export async function createFramescaperEditorProjectEnvironmentV27(
	optionsValue: FramescaperEditorProjectEnvironmentV27Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV27>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV27Selection(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V27 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE, store);
		if (!authority.opfs) throw new TypeError('The exact V27 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper V27 startup proxy-claim cleanup is indeterminate.');
		}
		const desktopProjectLibrary = await connectFramescaperDesktopProjectLibraryV18Renderer(
			FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
			store,
		);
		const controllerStore = createFramescaperDesktopProjectStoreV18Adapter(
			FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
			{ localStore: store, desktopProjectLibrary },
		) as AudioEditorProjectStore;
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore,
			desktopProjectLibrary,
			claimCleanup,
			initialCleanup,
			playback: createFramescaperPlaybackProjectServiceV27(
				FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
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
				'Framescaper V27 environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV27(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV27> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V27 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV27>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact V27 create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV27Options {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V27 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper V27 environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V27 storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
