/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed family-qualified project rows admitted by native media execution. */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';
import {
	framescaperNativeProjectBody,
	type FramescaperNativeProjectMediaBody,
} from './native-services-project-body-custody.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_BODIES = 5_118;

export interface FramescaperNativeProjectMediaRecord {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly projectSha256: string;
	readonly bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[];
}

export interface FramescaperNativeProjectMediaBundle {
	readonly project: Readonly<{
		readonly schemaFamily: 'framescaper';
		readonly schemaVersion: 1;
		readonly projectRevision: number;
		readonly sha256: string;
	}>;
	readonly bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[];
}

export function framescaperNativeProjectMediaRecord(
	value: unknown,
): FramescaperNativeProjectMediaRecord | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A baseline native project row is malformed.');
	}
	assertFramescaperProjectIdentity(value, 'native project row');
	const row = value as Record<string, unknown>;
	if (typeof row.projectId !== 'string' || !Number.isSafeInteger(row.projectRevision)
		|| typeof row.projectSha256 !== 'string' || !SHA256.test(row.projectSha256)
		|| !Array.isArray(row.bodies) || row.bodies.length > MAXIMUM_BODIES) {
		throw new TypeError('A baseline native project row has invalid identity fields.');
	}
	return Object.freeze({
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: row.projectId, projectRevision: Number(row.projectRevision),
		projectSha256: row.projectSha256, bodies: bodies(row.bodies),
	});
}

export function framescaperNativeProjectMediaBundle(
	value: unknown,
): FramescaperNativeProjectMediaBundle {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A baseline native project bundle is unavailable.');
	}
	const row = value as Record<string, unknown>;
	const project = row.project;
	assertFramescaperProjectIdentity(project, 'native project bundle');
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		throw new TypeError('A baseline native project bundle is malformed.');
	}
	const descriptor = project as Record<string, unknown>;
	if (!Number.isSafeInteger(descriptor.projectRevision)
		|| typeof descriptor.sha256 !== 'string' || !SHA256.test(descriptor.sha256)
		|| !Array.isArray(row.bodies) || row.bodies.length > MAXIMUM_BODIES) {
		throw new TypeError('A baseline native project bundle is malformed.');
	}
	return Object.freeze({
		project: Object.freeze({
			schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY, schemaVersion: PROJECT_SCHEMA_VERSION,
			projectRevision: Number(descriptor.projectRevision), sha256: descriptor.sha256,
		}),
		bodies: bodies(row.bodies),
	});
}

export function assertFramescaperNativeProjectMediaPort(value: unknown): void {
	assertFramescaperProjectIdentity(value, 'native project port');
}

function bodies(value: readonly unknown[]): readonly Readonly<FramescaperNativeProjectMediaBody>[] {
	return Object.freeze(value
		.filter((body) => (body as Record<string, unknown> | null)?.kind !== 'assistance-transcript')
		.map(framescaperNativeProjectBody));
}

function assertFramescaperProjectIdentity(value: unknown, label: string): void {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError(`The ${label} requires the exact Framescaper v1 identity.`);
	}
}
