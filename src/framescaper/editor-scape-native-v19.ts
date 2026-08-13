/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV19,
} from './editor-project-feature-requirements-v19.ts';
import { migrateFramescaperProjectV19 } from './editor-project-v19-migration.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	cloneFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19.ts';

export interface FramescaperScapeNativeStoreV19 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Bind the portable archive implementation to the exact V19 migration owner. */
export function createFramescaperScapeNativeRuntimeV19(
	profile: EditorProjectRuntimeProfile | unknown,
) {
	assertFramescaperProjectV19Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV19(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV19(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV19 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion: 19,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV19,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 19,
			});
			if (result.readOnly) return result;
			return Object.freeze({
				...result,
				project: cloneFramescaperProjectV19(profile, result.project),
			});
		},
		exportScapeProject: (
			project: FramescaperProjectV19 | unknown,
			store: FramescaperScapeNativeStoreV19,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV19(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
