/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts'
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts'
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js'
import {
	createSoundscaperProjectFeatureCompatibilityServiceV30,
} from './editor-project-feature-compatibility-v30.ts'
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV30,
} from './editor-project-feature-requirements-v30.ts'
import {
	cloneSoundscaperProjectV30,
	loadSoundscaperProjectV30,
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	type SoundscaperProjectV30,
} from './editor-project-v30.ts'
import {
	adaptSoundscaperScapeNativePluginStateStoreV30,
	createSoundscaperNativePluginStateScapeExtensionV30,
	type SoundscaperScapeNativePluginStateStoreV30,
} from './editor-native-plugin-state-scape-v30.ts'

export interface SoundscaperScapeNativeStoreV30 extends SoundscaperScapeNativePluginStateStoreV30 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
}

/** Bind portable archive I/O to exact V30 validation, compatibility, and fallback integrity. */
export function createSoundscaperScapeNativeRuntimeV30() {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV30()
	const projectAssetExtension = createSoundscaperNativePluginStateScapeExtensionV30()
	const migrateProject = (value: unknown) => loadSoundscaperProjectV30(value)
	const currentProjectSchemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV30 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV30,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const adaptedStore = adaptSoundscaperScapeNativePluginStateStoreV30(store)
			const result = await importScapeProject(input, adaptedStore, {
				...options,
				migrateProject,
				currentProjectSchemaVersion,
				rebindProjectSourceIdentities: rebindSoundscaperProjectFreezeSourceIdentitiesV30,
				projectAssetExtension,
			})
			if (result.readOnly) return result
			return Object.freeze({
				...result,
				project: cloneSoundscaperProjectV30(result.project),
			})
		},
		exportScapeProject: (
			project: SoundscaperProjectV30 | unknown,
			store: SoundscaperScapeNativeStoreV30,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(
			cloneSoundscaperProjectV30(project),
			adaptSoundscaperScapeNativePluginStateStoreV30(store),
			{
				...options,
				currentProjectSchemaVersion,
				projectAssetExtension,
			},
		),
		copyScapeArchive: copyFutureScapeArchive,
	})
}
