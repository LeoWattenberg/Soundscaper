/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	classifyProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from '../common/editor/project-schema-identity.ts';

const CUSTODY_VIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface SoundscaperOpaqueCustodyConsumerProject
	extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly schemaFamily: ProjectSchemaFamily;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly never[];
	readonly clips: readonly never[];
	readonly tracks: readonly never[];
}

/** Build an inert consumer shell without traversing the foreign/future domain. */
export function createSoundscaperOpaqueCustodyConsumerProject(
	value: unknown,
): SoundscaperOpaqueCustodyConsumerProject {
	const classification = classifyProjectSchemaIdentity(value, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY);
	if (classification.disposition === 'current') {
		throw new TypeError('Current Soundscaper projects do not use opaque custody.');
	}
	const record = value as object;
	const id = envelopeString(record, 'id', 'foreign-project');
	const title = envelopeString(record, 'title', 'Read-only project');
	const sampleRate = envelopeSampleRate(record);
	const shell = createAudioEditorProjectV17({
		id,
		title,
		sampleRate,
		now: CUSTODY_VIEW_TIMESTAMP,
		updatedAt: CUSTODY_VIEW_TIMESTAMP,
		sources: [], clips: [], tracks: [],
	});
	return Object.freeze({
		...shell,
		schemaFamily: classification.identity.schemaFamily,
		schemaVersion: classification.identity.schemaVersion,
		sources: Object.freeze([]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
	}) as SoundscaperOpaqueCustodyConsumerProject;
}

function envelopeString(value: object, field: string, fallback: string): string {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'string' && descriptor.value.trim()
		? descriptor.value : fallback;
}

function envelopeSampleRate(value: object): number {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'sampleRate');
	const sampleRate = descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		? descriptor.value : undefined;
	return Number.isSafeInteger(sampleRate) && Number(sampleRate) >= 8_000
		&& Number(sampleRate) <= 384_000 ? Number(sampleRate) : 48_000;
}
