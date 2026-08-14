/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts'
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts'
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js'
import {
	createSoundscaperProjectFeatureCompatibilityServiceV21,
} from './editor-project-feature-compatibility-v21.ts'
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV21,
} from './editor-project-feature-requirements-v21.ts'
import {
	cloneSoundscaperProjectV21,
	loadSoundscaperProjectV21,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	type SoundscaperProjectV21,
} from './editor-project-v21.ts'

export interface SoundscaperScapeNativeStoreV21 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
}

/** Bind portable archive I/O to exact V21 validation, compatibility, and fallback integrity. */
export function createSoundscaperScapeNativeRuntimeV21() {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV21()
	const migrateProject = (value: unknown) => loadSoundscaperProjectV21(value)
	const currentProjectSchemaVersion = SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV21 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV21,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion,
				rebindProjectSourceIdentities: rebindSoundscaperProjectFreezeSourceIdentitiesV21,
			})
			if (result.readOnly) return result
			return Object.freeze({
				...result,
				project: cloneSoundscaperProjectV21(result.project),
			})
		},
		exportScapeProject: (
			project: SoundscaperProjectV21 | unknown,
			store: SoundscaperScapeNativeStoreV21,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneSoundscaperProjectV21(project), store, {
			...options,
			currentProjectSchemaVersion,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	})
}
