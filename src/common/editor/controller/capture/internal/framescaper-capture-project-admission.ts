/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION, readProjectSchemaIdentity,
} from '../../../project-schema-identity.ts';

export interface FramescaperCaptureAppProject extends Record<string, unknown> {
	readonly id: string;
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly revision: number;
	readonly updatedAt?: unknown;
	readonly sampleRate: number;
	readonly primarySequenceId: string;
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly id: string;
		readonly rate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly trackIds: readonly string[];
	})[];
}

/** Read capture geometry only after the closed product identity has been admitted. */
export function admitFramescaperCaptureProject<Project extends object>(value: Project, expectedId?: string): Project & FramescaperCaptureAppProject;
export function admitFramescaperCaptureProject(value: unknown, expectedId?: string): FramescaperCaptureAppProject;
export function admitFramescaperCaptureProject(value: unknown, expectedId?: string): FramescaperCaptureAppProject {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY || identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError('Framescaper capture project requires the current project schema identity.');
	}
	if (!isRecord(value)) throw new TypeError('Framescaper capture requires an exact route project.');
	stableId(value.id, 'project ID');
	if (expectedId !== undefined && value.id !== expectedId) throw new RangeError('Framescaper capture loaded another project.');
	integer(value.revision, 'project revision', 0);
	integer(value.sampleRate, 'project sample rate', 1);
	stableId(value.primarySequenceId, 'primary sequence ID');
	if (!Array.isArray(value.sequences) || !value.sequences.length) {
		throw new TypeError('Framescaper capture project requires sequences.');
	}
	for (const sequence of value.sequences as unknown[]) {
		if (!isRecord(sequence) || !isRecord(sequence.rate) || !Array.isArray(sequence.trackIds)) {
			throw new TypeError('Framescaper capture sequence geometry is invalid.');
		}
		stableId(sequence.id, 'sequence ID');
		integer(sequence.rate.num, 'sequence rate numerator', 1);
		integer(sequence.rate.den, 'sequence rate denominator', 1);
		for (const id of sequence.trackIds as unknown[]) stableId(id, 'track ID');
	}
	return value as FramescaperCaptureAppProject;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableId(value: unknown, name: string): void {
	if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256
		|| [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new TypeError(`Framescaper capture ${name} is invalid.`);
	}
}

function integer(value: unknown, name: string, minimum: number): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new RangeError(`Framescaper capture ${name} is invalid.`);
	}
}
