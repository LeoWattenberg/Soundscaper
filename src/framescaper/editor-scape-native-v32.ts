/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV32,
} from './editor-project-feature-requirements-v32.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { rebindFramescaperSourceIdentitiesV32 } from './editor-project-v32-source-rebind.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	loadFramescaperProjectV32,
	reimportFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';
import { createFramescaperScapeProjectAssetExtensionV32 } from './editor-scape-assets-v32.ts';

export interface FramescaperScapeNativeStoreV32 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Selected V32 archive boundary; choosing a V28 archive is its explicit reimport action. */
export function createFramescaperScapeNativeRuntimeV32(profile: unknown) {
	assertFramescaperProjectV32Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV32(profile);
	const projectAssetExtension = createFramescaperScapeProjectAssetExtensionV32(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 28) return Object.freeze({
			project: reimportFramescaperProjectV32(profile, value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
			migrated: true,
			fromVersion: 28,
		});
		return Object.freeze({
			...loadFramescaperProjectV32(profile, value),
			migrated: false,
			fromVersion: version,
		});
	};
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV32 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion: 32,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV32,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 32,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV32,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV32(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV32 | unknown,
			store: FramescaperScapeNativeStoreV32,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV32(profile, project), store, {
			...options,
			currentProjectSchemaVersion: 32,
			projectAssetExtension,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
