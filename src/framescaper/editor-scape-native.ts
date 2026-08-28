/* SPDX-License-Identifier: AGPL-3.0-only */

import { deferredArchiveRuntime } from '../common/editor/controller/deferred-archive-runtime.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION } from
	'../common/editor/project-schema-identity.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	createFramescaperProjectFeatureCompatibilityService,
} from './editor-project-feature-requirements.ts';
import { rebindFramescaperSourceIdentities } from './editor-project-source-rebind.ts';
import {
	cloneFramescaperProject,
	loadFramescaperProject,
	type FramescaperProject,
} from './editor-project.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';

export interface FramescaperScapeNativeStore {
	loadProject?(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
}

/** Prepared Framescaper v1 portable document boundary. */
export function createFramescaperScapeNativeRuntime(profile: unknown) {
	const { copyFutureScapeArchive, exportScapeProject, importScapeProject, inspectScapeProject } =
		deferredArchiveRuntime;
	assertFramescaperProjectRuntimeProfile(profile);
	const compatibility = createFramescaperProjectFeatureCompatibilityService(profile);
	const projectAssetExtension = createFramescaperScapeProjectAssetExtension(profile);
	const admitProject = (value: unknown) => loadFramescaperProject(profile, value);
	return Object.freeze({
		inspectScapeProject: (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStore | null = null,
			options: Readonly<Record<string, unknown>> & Readonly<{ signal: AbortSignal }>,
			retention: Readonly<{ retain(settlement: PromiseLike<unknown>): void }>,
		) => inspectScapeProject(input, store, {
			...options,
			loadProject: admitProject,
			currentProjectSchemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
			currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
			projectFeatureCompatibility: compatibility,
			projectAssetExtension,
		}, retention),
		importScapeProject: async (
			input: ScapeProjectInput,
			store: FramescaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => {
			const result = await importScapeProject(input, store, {
				...options,
				loadProject: admitProject,
				currentProjectSchemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
				currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
				rebindProjectSourceIdentities: rebindFramescaperSourceIdentities,
				projectAssetExtension,
			});
			if (result.readOnly) return result;
			return Object.freeze({
				...result,
				project: cloneFramescaperProject(profile, result.project),
			});
		},
		exportScapeProject: (
			project: FramescaperProject | unknown,
			store: FramescaperScapeNativeStore,
			options: Readonly<Record<string, unknown>> = {},
		) => exportScapeProject(cloneFramescaperProject(profile, project), store, {
			...options,
			currentProjectSchemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
			currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
			projectAssetExtension,
		}),
		copyScapeArchive: (
			input: ScapeProjectInput,
			write: (bytes: Uint8Array) => void | PromiseLike<void>,
			options: Readonly<Record<string, unknown>> = {},
		) => copyFutureScapeArchive(input, write, {
			...options,
			currentProjectSchemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		}),
	});
}
