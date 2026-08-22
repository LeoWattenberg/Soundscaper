/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import { createFramescaperProjectFeatureCompatibilityServiceV26 } from './editor-project-feature-requirements-v26.ts';
import { migrateFramescaperProjectV26 } from './editor-project-v26-migration.ts';
import { rebindFramescaperOpenFxSourceIdentitiesV26 } from './editor-project-v26-source-rebind.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import { cloneFramescaperProjectV26, type FramescaperProjectV26 } from './editor-project-v26.ts';

export interface FramescaperScapeNativeStoreV26 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Dormant V26 archive authority. Unknown future archives remain byte-copy only. */
export function createFramescaperScapeNativeRuntimeV26(profile: unknown) {
	assertFramescaperProjectV26CandidateProfile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV26(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV26(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV26 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 26,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV26,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 26,
				rebindProjectSourceIdentities: rebindFramescaperOpenFxSourceIdentitiesV26,
			});
			if (result.readOnly) return result;
			return Object.freeze({
				...result,
				project: cloneFramescaperProjectV26(profile, result.project),
			});
		},
		exportScapeProject: (
			project: FramescaperProjectV26 | unknown,
			store: FramescaperScapeNativeStoreV26,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV26(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
