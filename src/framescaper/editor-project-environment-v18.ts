/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	createFramescaperPlaybackProjectServiceV18,
} from './editor-project-playback-v18.ts';
import {
	createEditorProjectRuntimeV18Selection,
	type EditorProjectRuntimeV18Selection,
} from './editor-project-runtime-v18-selection.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import {
	framescaperProjectStoreAuthorityV18,
} from './editor-project-store-v18.ts';
import {
	FramescaperProjectV18ClaimCleanupRepository,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import {
	collectFramescaperProjectStorageRootsV18,
	type FramescaperProjectRetentionLimitsV18,
	type FramescaperProjectRetentionScopeV18,
} from './editor-project-v18-retention.ts';
import {
	FramescaperScapeArchiveV18,
	type FramescaperScapeArchiveBodyStoreV18,
} from './scape-project-preservation-v18.ts';

const OPTION_FIELDS = ['storeOptions', 'now', 'createGeneration'] as const;
const EMPTY_CLEANUP_SCOPE = Object.freeze({
	sessionProjects: Object.freeze([]),
	histories: Object.freeze([]),
	pendingSaveSnapshots: Object.freeze([]),
});

export interface FramescaperEditorProjectEnvironmentV18Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
	readonly now?: () => number;
	readonly createGeneration?: () => string;
}

export interface FramescaperEditorProjectEnvironmentV18 {
	readonly runtime: Readonly<EditorProjectRuntimeV18Selection>;
	readonly store: AudioEditorProjectStore;
	readonly archive: FramescaperScapeArchiveV18;
	readonly playback: PlaybackProjectService;
	readonly claimCleanup: FramescaperProjectV18ClaimCleanupRepository;
	readonly initialCleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly collectStorageRoots: (
		scope: FramescaperProjectRetentionScopeV18 | unknown,
		limits?: FramescaperProjectRetentionLimitsV18,
	) => readonly string[];
	readonly close: () => Promise<void>;
}

/**
 * Open the first complete product-owned V18 authority. The environment is not
 * exposed until durable cleanup has settled its startup pass, so no project
 * load can race an abandoned proxy-body claim.
 */
export async function createFramescaperEditorProjectEnvironmentV18(
	optionsValue: FramescaperEditorProjectEnvironmentV18Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV18>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV18Selection(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const authority = framescaperProjectStoreAuthorityV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			store,
		);
		if (!authority.opfs) throw new TypeError('The exact V18 OPFS repository is required.');
		const cleanupOptions = {
			port: authority.port,
			opfs: authority.opfs,
			...(options.now ? { now: options.now } : {}),
		};
		const claimCleanup = new FramescaperProjectV18ClaimCleanupRepository(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			cleanupOptions,
		);
		const initialCleanup = await claimCleanup.reconcile(EMPTY_CLEANUP_SCOPE);
		assertSettledCleanup(initialCleanup, 'startup');
		const archive = new FramescaperScapeArchiveV18(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			{
				store: store as unknown as FramescaperScapeArchiveBodyStoreV18,
				port: authority.port,
				opfs: authority.opfs,
				...(options.now ? { now: options.now } : {}),
				...(options.createGeneration ? { createGeneration: options.createGeneration } : {}),
			},
		);
		return Object.freeze({
			runtime,
			store,
			archive,
			playback: createFramescaperPlaybackProjectServiceV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			),
			claimCleanup,
			initialCleanup,
			createProjectIfAbsent: (project: ProjectDocument) => exactProjectRepository(store).createIfAbsent(project),
			collectStorageRoots: (
				scope: FramescaperProjectRetentionScopeV18 | unknown,
				limits: FramescaperProjectRetentionLimitsV18 = {},
			) => collectFramescaperProjectStorageRootsV18(
				FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
				scope,
				limits,
			),
			close: () => store.close(),
		});
	} catch (error) {
		try {
			await store.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Framescaper V18 environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
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
		throw new TypeError('The exact V18 create-only project repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function assertSettledCleanup(
	result: Readonly<FramescaperProjectV18ClaimCleanupResult>,
	phase: string,
): void {
	if (result.status !== 'settled') {
		throw new Error(`Framescaper V18 ${phase} claim cleanup is indeterminate.`);
	}
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV18Options {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V18 environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V18 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Framescaper V18 environment options contain an unsupported authority field.');
	}
	const output: Record<string, unknown> = {};
	for (const key of OPTION_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V18 environment option ${key} must be an own data property.`);
		}
		output[key] = descriptor.value;
	}
	if (output.now !== undefined && typeof output.now !== 'function') {
		throw new TypeError('The Framescaper V18 environment clock must be a function.');
	}
	if (output.createGeneration !== undefined && typeof output.createGeneration !== 'function') {
		throw new TypeError('The Framescaper V18 generation factory must be a function.');
	}
	return output as FramescaperEditorProjectEnvironmentV18Options;
}
