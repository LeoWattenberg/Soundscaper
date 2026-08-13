/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../common/editor/scape-project.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV20,
} from './editor-project-feature-requirements-v20.ts';
import { migrateFramescaperProjectV20 } from './editor-project-v20-migration.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	cloneFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20.ts';

export interface FramescaperScapeNativeStoreV20 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Bind the portable archive implementation to the unselected exact V20 model. */
export function createFramescaperScapeNativeRuntimeV20(
	profile: FramescaperProjectV20Profile | unknown,
) {
	assertFramescaperProjectV20Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV20(profile);
	const migrateProject = (value: unknown) => migrateFramescaperProjectV20(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV20 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion: 20,
			projectFeatureCompatibility: compatibility,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV20,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 20,
			});
			if (result.readOnly) return result;
			return Object.freeze({
				...result,
				project: cloneFramescaperProjectV20(profile, result.project),
			});
		},
		exportScapeProject: (
			project: FramescaperProjectV20 | unknown,
			store: FramescaperScapeNativeStoreV20,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV20(profile, project), store, options),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
