/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import { createFramescaperProjectFeatureCompatibilityServiceV22 } from './editor-project-feature-requirements-v22.ts';
import { rebindFramescaperMulticameraSourceIdentitiesV18 } from './editor-multicamera-source-rebind-v18.ts';
import { migrateFramescaperProjectV22 } from './editor-project-v22-migration.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import { cloneFramescaperProjectV22, type FramescaperProjectV22 } from './editor-project-v22.ts';

export interface FramescaperScapeNativeStoreV22 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Dormant archive authority; callers must explicitly authenticate the V22 candidate. */
export function createFramescaperScapeNativeRuntimeV22(profile: unknown) {
	assertFramescaperProjectV22CandidateProfile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV22(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV22(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV22 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 22,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV22,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options, migrateProject, currentProjectSchemaVersion: 22,
				rebindProjectSourceIdentities: rebindFramescaperMulticameraSourceIdentitiesV18,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV22(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV22 | unknown,
			store: FramescaperScapeNativeStoreV22,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV22(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
