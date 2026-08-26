/* SPDX-License-Identifier: AGPL-3.0-only */

import { deferredArchiveRuntime } from '../common/editor/controller/deferred-archive-runtime.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	createAssistanceTranscriptScapeProjectAssetExtensionV1,
} from '../common/editor/assistance/transcript-scape-asset-extension-v1.ts';
import {
	composeScapeProjectAssetExtensions,
} from '../common/editor/scape-project-asset-extension-composition.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV31,
} from './editor-project-feature-requirements-v31.ts';
import { readFramescaperProjectSchemaVersion } from './editor-project-v18.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import {
	cloneFramescaperProjectV31,
	loadFramescaperProjectV31,
	reimportFramescaperProjectV31,
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31.ts';
import { createFramescaperScapeProjectAssetExtensionV32 } from './editor-scape-assets-v32.ts';
import { framescaperProjectV32FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import { rebindFramescaperSourceIdentitiesV31 } from './editor-project-v31-source-rebind.ts';

export interface FramescaperScapeNativeStoreV31 {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Prepared F31 portable document boundary; route activation remains separate. */
export function createFramescaperScapeNativeRuntimeV31(profile: unknown) {
	const { copyFutureScapeArchive, exportScapeProject, importScapeProject, inspectScapeProject } = deferredArchiveRuntime;
	assertFramescaperProjectV31Profile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceV31(profile);
	const projectAssetExtension = createAssetExtension(profile);
	const migrateProject = (value: unknown) => {
		const version = readFramescaperProjectSchemaVersion(value);
		if (version === 28 || version === 32) return Object.freeze({
			project: reimportFramescaperProjectV31(profile, value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
			migrated: true,
			fromVersion: version,
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
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentitiesV31,
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
	const inherited = createFramescaperScapeProjectAssetExtensionV32(profile, {
		authenticate: assertFramescaperProjectV31Profile,
		clone: (codecProfile, project) => framescaperProjectV32FoundationShapeV31(
			cloneFramescaperProjectV31(codecProfile, project),
		),
		validate: validateFramescaperProjectV31,
	});
	return composeScapeProjectAssetExtensions([
		inherited,
		createAssistanceTranscriptScapeProjectAssetExtensionV1(),
	]);
}
