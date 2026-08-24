/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectSoundscaperDesktopProjectLibraryV11Renderer,
	type SoundscaperDesktopProjectLibraryV11Renderer,
	type SoundscaperDesktopProjectLibraryV11ShadowStore,
} from './desktop-project-library-v11-renderer.ts';
import {
	createSoundscaperDesktopProjectStoreV11Adapter,
} from './desktop-project-library-v11-store-adapter.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV29,
	type SoundscaperAudioTrackFreezePlaybackServiceV29,
} from './editor-audio-track-freeze-playback-v29.ts';
import { createSoundscaperPlaybackProjectServiceV29 } from './editor-project-playback-v29.ts';
import {
	createSoundscaperProjectRuntimeV29Selection,
	type SoundscaperProjectRuntimeV29Selection,
} from './editor-project-runtime-v29-selection.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface SoundscaperEditorProjectEnvironmentV29Options {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface SoundscaperEditorProjectEnvironmentV29 {
	readonly runtime: Readonly<SoundscaperProjectRuntimeV29Selection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryV11Renderer | null;
	readonly playback: SoundscaperAudioTrackFreezePlaybackServiceV29;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the isolated exact-V29 Soundscaper browser authority. */
export async function createSoundscaperEditorProjectEnvironmentV29(
	optionsValue: SoundscaperEditorProjectEnvironmentV29Options | unknown = {},
): Promise<Readonly<SoundscaperEditorProjectEnvironmentV29>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createSoundscaperProjectRuntimeV29Selection();
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		if (!store.getStatus?.()?.persistent) {
			throw new Error('Durable storage is required; memory V29 project storage is unsupported.');
		}
		const desktopProjectLibrary = await connectSoundscaperDesktopProjectLibraryV11Renderer(
			runtime.runtimeProfile,
			{ store: store as unknown as SoundscaperDesktopProjectLibraryV11ShadowStore },
		);
		const controllerStore = desktopProjectLibrary
			? createSoundscaperDesktopProjectStoreV11Adapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary },
			)
			: createSoundscaperDesktopProjectStoreV11Adapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary: null },
			);
		const playback = createSoundscaperAudioTrackFreezePlaybackServiceV29(
			createSoundscaperPlaybackProjectServiceV29(),
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
				'Soundscaper V29 environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertSoundscaperEditorProjectEnvironmentV29(
	value: unknown,
): Readonly<SoundscaperEditorProjectEnvironmentV29> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Soundscaper V29 environment is required.');
	}
	return value as Readonly<SoundscaperEditorProjectEnvironmentV29>;
}

function snapshotOptions(value: unknown): SoundscaperEditorProjectEnvironmentV29Options {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper V29 environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper V29 environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Soundscaper V29 environment options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Soundscaper V29 environment option storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
