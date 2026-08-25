/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import {
	createFramescaperProjectFeatureCompatibilityServiceV31,
} from './editor-project-feature-requirements-v31.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { rebindFramescaperSourceIdentitiesV27 } from './editor-project-v27-source-rebind.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import {
	cloneFramescaperProjectV31,
	loadFramescaperProjectV31,
	reimportFramescaperProjectV31,
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';
import { createFramescaperScapeProjectAssetExtensionV27 } from './editor-scape-assets-v27.ts';

export interface FramescaperScapeNativeStoreV31 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Prepared F31 portable document boundary; route activation remains separate. */
export function createFramescaperScapeNativeRuntimeV31(profile: unknown) {
	assertFramescaperProjectV31Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV31(profile);
	const projectAssetExtension = createAssetExtension(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 28) return Object.freeze({
			project: reimportFramescaperProjectV31(profile, value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
			migrated: true,
			fromVersion: 28,
		});
		return Object.freeze({
			...loadFramescaperProjectV31(profile, value),
			migrated: false,
			fromVersion: version,
		});
	};
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV31 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			migrateProject,
			currentProjectSchemaVersion: 31,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV31,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				migrateProject,
				currentProjectSchemaVersion: 31,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV27,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({
				...result,
				project: cloneFramescaperProjectV31(profile, result.project),
			});
		},
		exportScapeProject: (
			project: FramescaperProjectV31 | unknown,
			store: FramescaperScapeNativeStoreV31,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV31(profile, project), store, {
			...options,
			currentProjectSchemaVersion: 31,
			projectAssetExtension,
		}),
		copyScapeArchive: copyFutureScapeArchive,
	});
}

function createAssetExtension(profile: unknown): Readonly<ScapeProjectAssetExtension> {
	const v27 = createFramescaperScapeProjectAssetExtensionV27(FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE);
	const extension: ScapeProjectAssetExtension = {
		...v27,
		planExportAssets: (request) => v27.planExportAssets({
			...request,
			project: framescaperProjectV28FoundationShapeV31(request.project),
		}),
		validateImportAssets: (project, manifest) => v27.validateImportAssets(
			framescaperProjectV28FoundationShapeV31(project),
			manifest,
		),
		validateReboundProject: (project) => { validateFramescaperProjectV31(profile, project); },
	};
	return Object.freeze(extension);
}
