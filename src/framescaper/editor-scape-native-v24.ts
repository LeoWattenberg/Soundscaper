/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import { createFramescaperProjectFeatureCompatibilityServiceV24 } from './editor-project-feature-requirements-v24.ts';
import { rebindFramescaperVisualSourceIdentitiesV24 } from './editor-project-v24-source-rebind.ts';
import { migrateFramescaperProjectV24 } from './editor-project-v24-migration.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import { cloneFramescaperProjectV24, type FramescaperProjectV24 } from './editor-project-v24.ts';

export interface FramescaperScapeNativeStoreV24 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Dormant V24 archive authority. Unknown future archives remain byte-copy only. */
export function createFramescaperScapeNativeRuntimeV24(profile: unknown) {
	assertFramescaperProjectV24CandidateProfile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV24(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV24(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV24 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 24,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV24,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options, migrateProject, currentProjectSchemaVersion: 24,
				rebindProjectSourceIdentities: rebindFramescaperVisualSourceIdentitiesV24,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV24(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV24 | unknown,
			store: FramescaperScapeNativeStoreV24,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV24(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
