/* SPDX-License-Identifier: AGPL-3.0-only */

import { deferredArchiveRuntime } from '../common/editor/controller/deferred-archive-runtime.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../common/editor/project-schema-identity.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	adaptSoundscaperScapeNativePluginStateStore,
	type SoundscaperScapeNativePluginStateStore,
} from './editor-native-plugin-state-scape.ts';
import { createSoundscaperProjectFeatureCompatibilityService } from
	'./editor-project-feature-compatibility.ts';
import { rebindSoundscaperProjectSourceIdentities } from './editor-project-feature-requirements.ts';
import {
	cloneSoundscaperProject,
	loadSoundscaperProject,
	type SoundscaperProject,
} from './editor-project.ts';
import { createSoundscaperScapeProjectAssetExtension } from './editor-scape-assets.ts';

export interface SoundscaperScapeNativeStore extends SoundscaperScapeNativePluginStateStore {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Bind portable archive I/O to the family-qualified Soundscaper baseline. */
export function createSoundscaperScapeNativeRuntime() {
	const { copyFutureScapeArchive, exportScapeProject, importScapeProject, inspectScapeProject } =
		deferredArchiveRuntime;
	const compatibility = createSoundscaperProjectFeatureCompatibilityService();
	const projectAssetExtension = createSoundscaperScapeProjectAssetExtension();
	const loadProject = (value: unknown) => loadSoundscaperProject(value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStore | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			loadProject,
			currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const adaptedStore = adaptSoundscaperScapeNativePluginStateStore(store);
			const result = await importScapeProject(input, adaptedStore, {
				...options,
				loadProject,
				currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
				currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
				rebindProjectSourceIdentities: rebindSoundscaperProjectSourceIdentities,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneSoundscaperProject(result.project) });
		},
		exportScapeProject: (
			project: SoundscaperProject | unknown,
			store: SoundscaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(
			cloneSoundscaperProject(project),
			adaptSoundscaperScapeNativePluginStateStore(store),
			{
				...options,
				currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
				currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
				projectAssetExtension,
			},
		),
		copyScapeArchive: (
			input: ScapeProjectInput,
			write: (bytes: Uint8Array) => void | PromiseLike<void>,
			options: Readonly<Record<string, unknown>> = {},
		) => copyFutureScapeArchive(input, write, {
			...options,
			currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		}),
	});
}
