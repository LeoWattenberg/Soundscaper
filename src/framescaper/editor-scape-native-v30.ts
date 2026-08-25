/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV30,
} from './editor-project-feature-requirements-v30.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { rebindFramescaperSourceIdentitiesV30 } from './editor-project-v30-source-rebind.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import {
	cloneFramescaperProjectV30,
	loadFramescaperProjectV30,
	reimportFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30.ts';
import { createFramescaperScapeProjectAssetExtensionV30 } from './editor-scape-assets-v30.ts';

export interface FramescaperScapeNativeStoreV30 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Selected V30 archive boundary; choosing a V28 archive is its explicit reimport action. */
export function createFramescaperScapeNativeRuntimeV30(profile: unknown) {
	assertFramescaperProjectV30Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV30(profile);
	const projectAssetExtension = createFramescaperScapeProjectAssetExtensionV30(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 28) return Object.freeze({
			project: reimportFramescaperProjectV30(profile, value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
			migrated: true,
			fromVersion: 28,
		});
		return Object.freeze({
			...loadFramescaperProjectV30(profile, value),
			migrated: false,
			fromVersion: version,
		});
	};
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV30 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion: 30,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV30,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 30,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV30,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV30(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV30 | unknown,
			store: FramescaperScapeNativeStoreV30,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV30(profile, project), store, {
			...options,
			currentProjectSchemaVersion: 30,
			projectAssetExtension,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
