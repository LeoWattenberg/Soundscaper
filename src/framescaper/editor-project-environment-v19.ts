/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperPlaybackProjectServiceV19,
} from './editor-project-playback-v19.ts';
import {
	createEditorProjectRuntimeV19Selection,
	type EditorProjectRuntimeV19Selection,
} from './editor-project-runtime-v19-selection.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { framescaperProjectStoreAuthorityV19 } from './editor-project-store-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV19Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV19 {
	readonly runtime: Readonly<EditorProjectRuntimeV19Selection>;
	readonly store: AudioEditorProjectStore;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/**
 * Open the exact-V19 browser authority, including attachment-claim cleanup over
 * the V19 document's authenticated V18 preservation foundation.
 */
export async function createFramescaperEditorProjectEnvironmentV19(
	optionsValue: FramescaperEditorProjectEnvironmentV19Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV19>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV19Selection(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V19 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV19(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact V19 OPFS repository is required.');
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
			{ port: authority.port, opfs: authority.opfs },
		);
		const initialCleanup = await claimCleanup.reconcile({
			sessionProjects: [], histories: [], pendingSaveSnapshots: [],
		});
		if (initialCleanup.status !== 'settled') {
			throw new Error('Framescaper V19 startup claim cleanup is indeterminate.');
		}
		const environment = Object.freeze({
			runtime,
			store,
			claimCleanup,
			initialCleanup,
			playback: createFramescaperPlaybackProjectServiceV19(
				FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
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
				'Framescaper V19 environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV19(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV19> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V19 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV19>;
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
		throw new TypeError('The exact V19 create-only project repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV19Options {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V19 environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V19 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Framescaper V19 environment options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V19 environment option storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
