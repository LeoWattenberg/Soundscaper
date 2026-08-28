/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	classifyProjectSchemaIdentity,
	isProjectSchemaFamily,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
	type ProjectSchemaIdentity,
} from './project-schema-identity.ts';
import {
	parseOpaqueScapeProjectDocument,
	parseScapeProjectDocument,
} from './scape-project-document.ts';

type DataRecord = Record<string, unknown>;

export interface ScapeProjectAdmissionOptions {
	readonly currentProjectSchemaFamily?: ProjectSchemaFamily;
	readonly currentProjectSchemaVersion?: number;
	readonly loadProject?: (project: unknown) => Readonly<{
		readonly project: DataRecord;
		readonly readOnly: boolean;
		readonly reason?: string | null;
	}>;
}

export interface ScapeProjectAdmission extends Readonly<Record<string, unknown>> {
	readonly project: DataRecord;
	readonly readOnly: boolean;
	readonly reason?: string | null;
	readonly identity: Readonly<ProjectSchemaIdentity>;
}

/** Classify the tuple before decoding or traversing any product-owned field. */
export function loadScapeProjectDocument(
	projectText: string,
	declaredIdentity: unknown,
	options: ScapeProjectAdmissionOptions = {},
): ScapeProjectAdmission {
	const currentFamily = resolveScapeCurrentProjectSchemaFamily(options);
	const opaqueProject = parseOpaqueScapeProjectDocument(projectText, {
		currentProjectSchemaFamily: currentFamily,
	});
	const classification = classifyProjectSchemaIdentity(opaqueProject, currentFamily);
	const declared = readProjectSchemaIdentity(declaredIdentity);
	if (declared.schemaFamily !== classification.identity.schemaFamily
		|| declared.schemaVersion !== classification.identity.schemaVersion) {
		throw new Error('The Scape manifest project identity does not match its project document.');
	}
	if (classification.disposition !== 'current') {
		return Object.freeze({
			project: opaqueProject as DataRecord,
			readOnly: true,
			reason: classification.disposition === 'foreign' ? 'foreign-family' : 'newer-schema',
			identity: classification.identity,
		});
	}
	const parsed = parseScapeProjectDocument(projectText, {
		currentProjectSchemaFamily: currentFamily,
	});
	if (typeof options.loadProject !== 'function') {
		throw new TypeError('The Scape project admission owner must be a function.');
	}
	const loaded = options.loadProject(parsed);
	if (!loaded || typeof loaded !== 'object' || !isRecord(loaded.project)) {
		throw new TypeError('The Scape project admission owner returned an invalid result.');
	}
	if (typeof loaded.readOnly !== 'boolean') {
		throw new TypeError('The Scape project admission result requires a readOnly decision.');
	}
	const loadedIdentity = readProjectSchemaIdentity(loaded.project);
	if (loadedIdentity.schemaFamily !== classification.identity.schemaFamily
		|| loadedIdentity.schemaVersion !== classification.identity.schemaVersion) {
		throw new Error('The Scape project admission owner changed the project identity.');
	}
	return Object.freeze({ ...loaded, identity: loadedIdentity });
}

export function resolveScapeCurrentProjectSchemaVersion(
	options: ScapeProjectAdmissionOptions = {},
): typeof PROJECT_SCHEMA_VERSION {
	const value = options.currentProjectSchemaVersion ?? PROJECT_SCHEMA_VERSION;
	if (value !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError(`The Scape baseline project schema version must be ${String(PROJECT_SCHEMA_VERSION)}.`);
	}
	return value;
}

export function resolveScapeCurrentProjectSchemaFamily(
	options: ScapeProjectAdmissionOptions = {},
): ProjectSchemaFamily {
	const value = options.currentProjectSchemaFamily;
	if (!isProjectSchemaFamily(value)) {
		throw new TypeError('The Scape current project schema family must be soundscaper or framescaper.');
	}
	return value;
}

function isRecord(value: unknown): value is DataRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
