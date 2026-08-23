/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV27,
} from './editor-project-feature-requirements-v27.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { rebindFramescaperSourceIdentitiesV27 } from './editor-project-v27-source-rebind.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	loadFramescaperProjectV27,
	reimportFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27.ts';
import { createFramescaperScapeProjectAssetExtensionV27 } from './editor-scape-assets-v27.ts';

export interface FramescaperScapeNativeStoreV27 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Selected V27 archive runtime; choosing a V20/V22/V24 archive is explicit reimport. */
export function createFramescaperScapeNativeRuntimeV27(profile: unknown) {
	assertFramescaperProjectV27Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV27(profile);
	const projectAssetExtension = createFramescaperScapeProjectAssetExtensionV27(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 20 || version === 22 || version === 24) {
			return Object.freeze({
				project: reimportFramescaperProjectV27(profile, value),
				readOnly: false, intrinsicReadOnly: false, reason: null,
				migrated: true, fromVersion: version,
			});
		}
		return Object.freeze({
			...loadFramescaperProjectV27(profile, value), migrated: false, fromVersion: version,
		});
	};
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV27 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 27,
			projectFeatureCompatibility: compatibility, projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV27,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options, migrateProject, currentProjectSchemaVersion: 27,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV27,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV27(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV27 | unknown,
			store: FramescaperScapeNativeStoreV27,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV27(profile, project), store, {
			...options, currentProjectSchemaVersion: 27, projectAssetExtension,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	});
}
