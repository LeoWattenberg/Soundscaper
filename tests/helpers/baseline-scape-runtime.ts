/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject as createLegacyAudioEditorProject,
	loadCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../../src/common/editor/project-schema-identity.ts';
import type { ScapeProjectInspection } from '../../src/common/editor/controller/scape-project-file-service.ts';
import type { ScapeProjectInput } from '../../src/common/editor/scape-project-input.ts';
import {
	importScapeProject as importRawScapeProject,
	inspectScapeProject as inspectRawScapeProject,
} from '../../src/common/editor/scape-project.js';

type CreateProjectOptions = Parameters<typeof createLegacyAudioEditorProject>[0];
type ImportStore = Parameters<typeof importRawScapeProject>[1];
type ImportOptions = NonNullable<Parameters<typeof importRawScapeProject>[2]>;
type InspectionStore = Parameters<typeof inspectRawScapeProject>[1];
type InspectionOptions = NonNullable<Parameters<typeof inspectRawScapeProject>[2]>;
type InspectionRetention = NonNullable<Parameters<typeof inspectRawScapeProject>[3]>;
type BaselineProject<Project extends object> = Omit<Project, 'schemaFamily' | 'schemaVersion'> & Readonly<{
	schemaFamily: typeof SOUNDSCAPER_PROJECT_SCHEMA_FAMILY;
	schemaVersion: typeof PROJECT_SCHEMA_VERSION;
}>;

/** Re-identify a canonical shared-domain fixture as the Soundscaper 1.0 family. */
export function createBaselineAudioEditorProject(
	options: CreateProjectOptions,
): AudioEditorProjectCurrent {
	return asBaselineSoundscaperProject(
		createLegacyAudioEditorProject(options),
	) as unknown as AudioEditorProjectCurrent;
}

export function asBaselineSoundscaperProject<Project extends object>(
	project: Project,
): BaselineProject<Project> {
	const clone = structuredClone(project);
	return {
		...clone,
		schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
	} as BaselineProject<Project>;
}

/** Exercise the retained shared-domain validator without treating its numeric lineage as persisted identity. */
export function validateBaselineSoundscaperProject(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A baseline Soundscaper project is required.');
	}
	const legacy = { ...(value as Record<string, unknown>), schemaVersion: 17 };
	Reflect.deleteProperty(legacy, 'schemaFamily');
	return loadCurrentAudioEditorProject(legacy).project !== null;
}

export const BASELINE_SOUNDSCAPER_SCAPE_OPTIONS = Object.freeze({
	currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
	loadProject: loadBaselineSoundscaperProject,
});

export function importBaselineScapeProject(
	input: ScapeProjectInput | null,
	store: ImportStore,
	options: ImportOptions = {},
) {
	if (input === null) throw new TypeError('A Scape project input is required.');
	return importRawScapeProject(input, store, {
		...BASELINE_SOUNDSCAPER_SCAPE_OPTIONS,
		...options,
		currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
	});
}

export async function inspectBaselineScapeProject(
	input: ScapeProjectInput | null,
	store: InspectionStore = null,
	options: InspectionOptions = {},
	retention: InspectionRetention = {},
): Promise<ScapeProjectInspection> {
	if (input === null) throw new TypeError('A Scape project input is required.');
	return await inspectRawScapeProject(input, store, {
		...BASELINE_SOUNDSCAPER_SCAPE_OPTIONS,
		...options,
		currentProjectSchemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		currentProjectSchemaVersion: PROJECT_SCHEMA_VERSION,
	}, retention) as unknown as ScapeProjectInspection;
}

function loadBaselineSoundscaperProject(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A baseline Soundscaper project is required.');
	}
	const legacy = { ...(value as Record<string, unknown>), schemaVersion: 17 };
	Reflect.deleteProperty(legacy, 'schemaFamily');
	const loaded = loadCurrentAudioEditorProject(legacy);
	return {
		...loaded,
		project: {
			...loaded.project,
			schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
			schemaVersion: PROJECT_SCHEMA_VERSION,
		},
	};
}
