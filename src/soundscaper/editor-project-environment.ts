/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStoreOptions } from '../common/editor/storage/project-store-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	connectSoundscaperDesktopProjectLibraryRenderer,
	type SoundscaperDesktopProjectLibraryRenderer,
	type SoundscaperDesktopProjectLibraryShadowStore,
} from './desktop-project-library-renderer.ts';
import {
	createSoundscaperDesktopProjectStoreAdapter,
} from './desktop-project-library-store-adapter.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackService,
	type SoundscaperAudioTrackFreezePlaybackService,
} from './editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from './editor-project-playback.ts';
import {
	createSoundscaperProjectRuntimeSelection,
	type SoundscaperProjectRuntimeSelection,
} from './editor-project-runtime-selection.ts';

const OPTION_FIELDS = ['storeOptions'] as const;
const PRODUCT_ENVIRONMENTS = new WeakSet<object>();

export interface SoundscaperEditorProjectEnvironmentOptions {
	readonly storeOptions?: AudioEditorProjectStoreOptions;
}

export interface SoundscaperEditorProjectEnvironment {
	readonly runtime: Readonly<SoundscaperProjectRuntimeSelection>;
	readonly store: AudioEditorProjectStore;
	readonly controllerStore: AudioEditorProjectStore;
	readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryRenderer | null;
	readonly playback: SoundscaperAudioTrackFreezePlaybackService;
	readonly createProjectIfAbsent: (project: ProjectDocument) => Promise<ProjectDocument | null>;
	readonly close: () => Promise<void>;
}

/** Open the isolated exact-baseline Soundscaper browser authority. */
export async function createSoundscaperEditorProjectEnvironment(
	optionsValue: SoundscaperEditorProjectEnvironmentOptions | unknown = {},
): Promise<Readonly<SoundscaperEditorProjectEnvironment>> {
	const options = snapshotOptions(optionsValue);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = runtime.createProjectStore(options.storeOptions ?? {}) as AudioEditorProjectStore;
	try {
		await store.ready();
		if (!store.getStatus?.()?.persistent) {
			throw new Error('Durable storage is required; memory baseline project storage is unsupported.');
		}
		const desktopProjectLibrary = await connectSoundscaperDesktopProjectLibraryRenderer(
			runtime.runtimeProfile,
			{ store: store as unknown as SoundscaperDesktopProjectLibraryShadowStore },
		);
		const controllerStore = desktopProjectLibrary
			? createSoundscaperDesktopProjectStoreAdapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary },
			)
			: createSoundscaperDesktopProjectStoreAdapter(
				runtime.runtimeProfile,
				{ localStore: store, desktopProjectLibrary: null },
			);
		const playback = createSoundscaperAudioTrackFreezePlaybackService(
			createSoundscaperPlaybackProjectService(),
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
				'Soundscaper baseline environment startup and store cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
}

export function assertSoundscaperEditorProjectEnvironment(
	value: unknown,
): Readonly<SoundscaperEditorProjectEnvironment> {
	if (!value || typeof value !== 'object' || !PRODUCT_ENVIRONMENTS.has(value)) {
		throw new TypeError('An exact product-created Soundscaper baseline environment is required.');
	}
	return value as Readonly<SoundscaperEditorProjectEnvironment>;
}

function snapshotOptions(value: unknown): SoundscaperEditorProjectEnvironmentOptions {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper baseline environment options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper baseline environment options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !OPTION_FIELDS.includes(
		key as (typeof OPTION_FIELDS)[number],
	))) {
		throw new TypeError('Soundscaper baseline environment options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'storeOptions');
	if (!descriptor) return {};
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Soundscaper baseline environment option storeOptions must be an own data property.');
	}
	return { storeOptions: descriptor.value as AudioEditorProjectStoreOptions };
}
