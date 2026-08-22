/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import { createFramescaperProjectFeatureCompatibilityServiceV25 } from './editor-project-feature-requirements-v25.ts';
import { migrateFramescaperProjectV25 } from './editor-project-v25-migration.ts';
import { rebindFramescaperProfessionalMediaSourceIdentitiesV25 } from './editor-project-v25-source-rebind.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import { cloneFramescaperProjectV25, type FramescaperProjectV25 } from './editor-project-v25.ts';

export interface FramescaperScapeNativeStoreV25 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Dormant V25 archive authority. Future archives remain opaque byte-copy custody. */
export function createFramescaperScapeNativeRuntimeV25(profile: unknown) {
	assertFramescaperProjectV25CandidateProfile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV25(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV25(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV25 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 25,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV25,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options, migrateProject, currentProjectSchemaVersion: 25,
				rebindProjectSourceIdentities: rebindFramescaperProfessionalMediaSourceIdentitiesV25,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV25(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV25 | unknown,
			store: FramescaperScapeNativeStoreV25,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV25(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
