/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts'
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts'
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js'
import {
	createSoundscaperProjectFeatureCompatibilityServiceV29,
} from './editor-project-feature-compatibility-v29.ts'
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV29,
} from './editor-project-feature-requirements-v29.ts'
import {
	cloneSoundscaperProjectV29,
	loadSoundscaperProjectV29,
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	type SoundscaperProjectV29,
} from './editor-project-v29.ts'
import {
	adaptSoundscaperScapeNativePluginStateStoreV29,
	createSoundscaperNativePluginStateScapeExtensionV29,
	type SoundscaperScapeNativePluginStateStoreV29,
} from './editor-native-plugin-state-scape-v29.ts'

export interface SoundscaperScapeNativeStoreV29 extends SoundscaperScapeNativePluginStateStoreV29 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
}

/** Bind portable archive I/O to exact V29 validation, compatibility, and fallback integrity. */
export function createSoundscaperScapeNativeRuntimeV29() {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV29()
	const projectAssetExtension = createSoundscaperNativePluginStateScapeExtensionV29()
	const migrateProject = (value: unknown) => loadSoundscaperProjectV29(value)
	const currentProjectSchemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV29 | null = null,
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
			store: SoundscaperScapeNativeStoreV29,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const adaptedStore = adaptSoundscaperScapeNativePluginStateStoreV29(store)
			const result = await importScapeProject(input, adaptedStore, {
				...options,
				migrateProject,
				currentProjectSchemaVersion,
				rebindProjectSourceIdentities: rebindSoundscaperProjectFreezeSourceIdentitiesV29,
				projectAssetExtension,
			})
			if (result.readOnly) return result
			return Object.freeze({
				...result,
				project: cloneSoundscaperProjectV29(result.project),
			})
		},
		exportScapeProject: (
			project: SoundscaperProjectV29 | unknown,
			store: SoundscaperScapeNativeStoreV29,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(
			cloneSoundscaperProjectV29(project),
			adaptSoundscaperScapeNativePluginStateStoreV29(store),
			{
				...options,
				currentProjectSchemaVersion,
				projectAssetExtension,
			},
		),
		copyScapeArchive: copyFutureScapeArchive,
	})
}
