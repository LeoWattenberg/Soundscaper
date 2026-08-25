/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PlaybackProjectService } from '../common/editor/controller/playback-project-service.ts';
import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import { createFramescaperPlaybackProjectServiceV30 } from './editor-project-playback-v30.ts';
import {
	createEditorProjectRuntimeV30Selection,
	type EditorProjectRuntimeV30Selection,
} from './editor-project-runtime-v30-selection.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import {
	framescaperProjectStoreAuthorityV30,
	type FramescaperProjectStoreAuthorityV30,
} from './editor-project-store-v30.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface FramescaperEditorProjectEnvironmentV30Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface FramescaperEditorProjectEnvironmentV30 {
	readonly runtime: Readonly<EditorProjectRuntimeV30Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly playback: PlaybackProjectService;
	readonly timelineImages: FramescaperProjectStoreAuthorityV30['timelineImages'];
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the exact V30 browser store and its authenticated timeline-image publisher. */
export async function createFramescaperEditorProjectEnvironmentV30(
	optionsValue: FramescaperEditorProjectEnvironmentV30Options | unknown = {},
): Promise<Readonly<FramescaperEditorProjectEnvironmentV30>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createEditorProjectRuntimeV30Selection(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE);
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		const storageStatus = store.getStatus?.();
		if (!storageStatus?.persistent) {
			throw new Error('Durable storage is required; memory V30 project storage is unsupported.');
		}
		const authority = framescaperProjectStoreAuthorityV30(
			FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
			store,
		);
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore: store,
			playback: createFramescaperPlaybackProjectServiceV30(
				FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
				{ timingStore: store },
			),
			timelineImages: authority.timelineImages,
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
				'Framescaper V30 environment startup and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertFramescaperEditorProjectEnvironmentV30(
	value: unknown,
): Readonly<FramescaperEditorProjectEnvironmentV30> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Framescaper V30 environment is required.');
	}
	return value as Readonly<FramescaperEditorProjectEnvironmentV30>;
}

function exactProjectRepository(store: AudioEditorProjectStore): Readonly<{
	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null>;
}> {
	const repository = store.projectRepository as Readonly<{
		createIfAbsent?: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	}>;
	if (typeof repository?.createIfAbsent !== 'function') {
		throw new TypeError('The exact V30 create-only repository is required.');
	}
	return { createIfAbsent: (project) => repository.createIfAbsent!(project) };
}

function snapshotOptions(value: unknown): FramescaperEditorProjectEnvironmentV30Options {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Framescaper V30 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) throw new TypeError('Framescaper V30 environment options contain an unsupported authority field.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Framescaper V30 storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
