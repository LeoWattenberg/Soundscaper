/* SPDX-License-Identifier: AGPL-3.0-only */

import { copyFutureScapeArchive } from '../common/editor/scape-archive-copy.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { exportScapeProject, importScapeProject, inspectScapeProject } from '../common/editor/scape-project.js';
import { createFramescaperProjectFeatureCompatibilityServiceV28 } from './editor-project-feature-requirements-v28.ts';
import { rebindFramescaperSourceIdentitiesV27 } from './editor-project-v27-source-rebind.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import {
	cloneFramescaperProjectV28,
	loadFramescaperProjectV28,
	reimportFramescaperProjectV28,
	type FramescaperProjectV28,
	validateFramescaperProjectV28,
} from './editor-project-v28.ts';
import { createFramescaperScapeProjectAssetExtensionV27 } from './editor-scape-assets-v27.ts';

export interface FramescaperScapeNativeStoreV28 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Selected V28 portable archive boundary; V27 is accepted only through explicit reimport. */
export function createFramescaperScapeNativeRuntimeV28(profile: unknown) {
	assertFramescaperProjectV28Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV28(profile);
	const projectAssetExtension = createAssetExtension(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 27) return Object.freeze({
			project: reimportFramescaperProjectV28(profile, value),
			readOnly: false, intrinsicReadOnly: false, reason: null,
			migrated: true, fromVersion: 27,
		});
		return Object.freeze({
			...loadFramescaperProjectV28(profile, value), migrated: false, fromVersion: version,
		});
	};
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV28 | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options, migrateProject, currentProjectSchemaVersion: 28,
			projectFeatureCompatibility: compatibility, projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStoreV28,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options, migrateProject, currentProjectSchemaVersion: 28,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV27,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({ ...result, project: cloneFramescaperProjectV28(profile, result.project) });
		},
		exportScapeProject: (
			project: FramescaperProjectV28 | unknown,
			store: FramescaperScapeNativeStoreV28,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProjectV28(profile, project), store, {
			...options, currentProjectSchemaVersion: 28, projectAssetExtension,
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
			project: framescaperProjectV27FoundationShapeV28(request.project as unknown as FramescaperProjectV28),
		}),
		validateImportAssets: (project, manifest) => v27.validateImportAssets(
			framescaperProjectV27FoundationShapeV28(project as FramescaperProjectV28), manifest,
		),
		validateReboundProject: (project) => { validateFramescaperProjectV28(profile, project); },
	};
	return Object.freeze(extension);
}
