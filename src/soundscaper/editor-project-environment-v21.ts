/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectSoundscaperDesktopProjectLibraryV10Renderer,
	type SoundscaperDesktopProjectLibraryV10Renderer,
	type SoundscaperDesktopProjectLibraryV10ShadowStore,
} from './desktop-project-library-v10-renderer.ts';
import {
	createSoundscaperDesktopProjectStoreV10Adapter,
} from './desktop-project-library-v10-store-adapter.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV21,
	type SoundscaperAudioTrackFreezePlaybackServiceV21,
} from './editor-audio-track-freeze-playback-v21.ts';
import { createSoundscaperPlaybackProjectServiceV21 } from './editor-project-playback-v21.ts';
import {
	createSoundscaperProjectRuntimeV21Selection,
	type SoundscaperProjectRuntimeV21Selection,
} from './editor-project-runtime-v21-selection.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface SoundscaperEditorProjectEnvironmentV21Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface SoundscaperEditorProjectEnvironmentV21 {
	readonly runtime: Readonly<SoundscaperProjectRuntimeV21Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryV10Renderer | null;
	readonly playback: SoundscaperAudioTrackFreezePlaybackServiceV21;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the isolated exact-V21 Soundscaper browser authority. */
export async function createSoundscaperEditorProjectEnvironmentV21(
	optionsValue: SoundscaperEditorProjectEnvironmentV21Options | unknown = {},
): Promise<Readonly<SoundscaperEditorProjectEnvironmentV21>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createSoundscaperProjectRuntimeV21Selection();
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		if (!store.getStatus?.()?.persistent) {
			throw new Error('Durable storage is required; memory V21 project storage is unsupported.');
		}
		const desktopProjectLibrary = await connectSoundscaperDesktopProjectLibraryV10Renderer(
			runtime.runtimeProfile,
			{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
		);
		const controllerStore = desktopProjectLibrary
			? createSoundscaperDesktopProjectStoreV10Adapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary },
			)
			: createSoundscaperDesktopProjectStoreV10Adapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary: null },
			);
		const playback = createSoundscaperAudioTrackFreezePlaybackServiceV21(
			createSoundscaperPlaybackProjectServiceV21(),
			store,
		);
		const environment = Object.freeze({
			runtime,
			store,
			controllerStore,
			desktopProjectLibrary,
			playback,
			createProjectIfAbsent: (project: ProjectDocument) => controllerStore.createProjectIfAbsent(project),
			close: async () => {
				playback.dispose();
				await store.close();
			},
		});
		PRODUCT_ENVIRONMENTS.add(environment);
		return environment;
	} catch (error) {
		try {
			await store.close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Soundscaper V21 environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertSoundscaperEditorProjectEnvironmentV21(
	value: unknown,
): Readonly<SoundscaperEditorProjectEnvironmentV21> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Soundscaper V21 environment is required.');
	}
	return value as Readonly<SoundscaperEditorProjectEnvironmentV21>;
}

function snapshotOptions(value: unknown): SoundscaperEditorProjectEnvironmentV21Options {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V21 environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper V21 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Soundscaper V21 environment options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Soundscaper V21 environment option storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
