/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV17 } from './project-v17.ts';
import type { ProjectSchemaIdentity } from './project-schema-identity.ts';
import type { ProjectDocumentBody } from './project-document-body-types.ts';
import type { TakeCompDocumentGroup } from './take-comp-document-v17.ts';

export type OpaqueProjectConsumer = ProjectDocumentBody & Readonly<{
	sources: readonly never[];
	clips: readonly never[];
	tracks: readonly never[];
	takeGroups: readonly TakeCompDocumentGroup[];
}>;

/** Construct an inert view from envelope data; the stored document stays with its custody owner. */
export function createOpaqueProjectConsumer<Identity extends Readonly<{
	schemaVersion: number; schemaFamily?: ProjectSchemaIdentity['schemaFamily'];
}>>(
	value: unknown,
	identity: Identity,
): OpaqueProjectConsumer & Identity {
	const shell = createAudioEditorProjectV17({
		id: envelopeString(value, 'id', 'foreign-project'),
		title: envelopeString(value, 'title', 'Read-only project'),
		sampleRate: envelopeSampleRate(value),
		now: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z',
		sources: [], clips: [], tracks: [],
	});
	return Object.freeze({
		...shell, ...identity,
		sources: Object.freeze([]), clips: Object.freeze([]), tracks: Object.freeze([]),
		automationLanes: Object.freeze([]),
	});
}

function envelopeValue(value: unknown, field: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : undefined;
}

function envelopeString(value: unknown, field: string, fallback: string): string {
	const candidate = envelopeValue(value, field);
	return typeof candidate === 'string' && candidate.trim() ? candidate : fallback;
}

function envelopeSampleRate(value: unknown): number {
	const candidate = envelopeValue(value, 'sampleRate');
	return typeof candidate === 'number' && Number.isSafeInteger(candidate)
		&& candidate >= 8_000 && candidate <= 384_000 ? candidate : 48_000;
}
