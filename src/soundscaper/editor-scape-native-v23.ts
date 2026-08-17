/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts'
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts'
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js'
import {
	createSoundscaperProjectFeatureCompatibilityServiceV23,
} from './editor-project-feature-compatibility-v23.ts'
import {
	rebindSoundscaperProjectFreezeSourceIdentitiesV23,
} from './editor-project-feature-requirements-v23.ts'
import {
	cloneSoundscaperProjectV23,
	loadSoundscaperProjectV23,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	type SoundscaperProjectV23,
} from './editor-project-v23.ts'

export interface SoundscaperScapeNativeStoreV23 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
}

/** Bind portable archive I/O to exact V23 validation, compatibility, and fallback integrity. */
export function createSoundscaperScapeNativeRuntimeV23() {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV23()
	const migrateProject = (value: unknown) => loadSoundscaperProjectV23(value)
	const currentProjectSchemaVersion = SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: SoundscaperScapeNativeStoreV23 | null = null,
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
			store: SoundscaperScapeNativeStoreV23,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion,
				rebindProjectSourceIdentities: rebindSoundscaperProjectFreezeSourceIdentitiesV23,
			})
			if (result.readOnly) return result
			return Object.freeze({
				...result,
				project: cloneSoundscaperProjectV23(result.project),
			})
		},
		exportScapeProject: (
			project: SoundscaperProjectV23 | unknown,
			store: SoundscaperScapeNativeStoreV23,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneSoundscaperProjectV23(project), store, {
			...options,
			currentProjectSchemaVersion,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	})
}
