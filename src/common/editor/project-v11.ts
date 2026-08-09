/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioEditorProjectV10,
	type AudioEditorProjectV10Options,
} from './project-v10.ts';
import {
	AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
	validateAudioEditorProjectV11,
	type AudioEditorProjectV11,
} from './project-v11-validation.ts';
import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { createTimelineAnnotationsV11 } from './timeline-annotation.ts';
import type { HoldTempoMap } from './timeline-time.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
	validateAudioEditorProjectV11,
	type AudioEditorProjectV11,
} from './project-v11-validation.ts';

export interface AudioEditorProjectV11Options extends AudioEditorProjectV10Options {
	readonly timelineAnnotations?: readonly unknown[];
	readonly selection?: Readonly<Record<string, unknown>> & {
		readonly annotationIds?: readonly string[];
	};
}

/** Create the exact current document while retaining V10's media and timing foundation. */
export function createAudioEditorProjectV11(
	options: AudioEditorProjectV11Options = {},
): AudioEditorProjectV11 {
	const { timelineAnnotations: annotationInput = [], ...foundationOptions } = options;
	const foundation = createAudioEditorProjectV10(foundationOptions);
	const timelineAnnotations = createTimelineAnnotationsV11(annotationInput, {
		tempoMap: foundation.tempoMap as HoldTempoMap,
		sampleRate: foundation.sampleRate,
		sequenceIds: foundation.sequences.map((sequence) => String(sequence.id)),
	});
	const selection = createV11Selection(foundation.selection, options.selection, timelineAnnotations);
	const project = {
		...foundation,
		schemaVersion: AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION,
		selection,
		timelineAnnotations,
	} as AudioEditorProjectV11;
	const featureRequirements = normalizeProjectFeatureRequirements(options.featureRequirements ?? foundation.featureRequirements, {
		sources: project.sources,
		clips: project.clips,
		tracks: project.tracks,
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: project.sequences,
		primarySequenceId: project.primarySequenceId,
	});
	const result = {
		...project,
		featureRequirements: reconcileProjectOwnedFeatureRequirements(project, featureRequirements),
	} as AudioEditorProjectV11;
	validateAudioEditorProjectV11(result);
	return result;
}

export function cloneAudioEditorProjectV11(project: AudioEditorProjectV11): AudioEditorProjectV11 {
	validateAudioEditorProjectV11(project);
	return clone(project);
}

export function loadAudioEditorProjectV11(value: unknown): {
	project: AudioEditorProjectV11 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = object(value, 'saved project');
	const schemaVersion = projectSchemaVersion(candidate.schemaVersion);
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V11_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV11(candidate);
	return { project: clone(candidate) as AudioEditorProjectV11, readOnly: false, reason: null };
}

function createV11Selection(
	foundationValue: unknown,
	inputValue: unknown,
	annotations: readonly Readonly<{ readonly id: string }>[],
): Readonly<Record<string, unknown>> & { readonly annotationIds: readonly string[] } {
	const foundation = object(foundationValue, 'project selection');
	const input = inputValue === undefined ? {} : object(inputValue, 'project selection');
	const value = input.annotationIds ?? [];
	if (!Array.isArray(value)) throw new TypeError('selection.annotationIds must be an array.');
	const available = new Set(annotations.map(({ id }) => id));
	const annotationIds: string[] = [];
	const seen = new Set<string>();
	for (const [index, candidate] of value.entries()) {
		if (typeof candidate !== 'string' || !candidate.length) {
			throw new TypeError(`selection.annotationIds[${String(index)}] must be a non-empty string.`);
		}
		if (seen.has(candidate)) throw new RangeError('selection.annotationIds cannot contain duplicate IDs.');
		if (!available.has(candidate)) throw new ReferenceError(`Selection references missing annotation ${candidate}.`);
		seen.add(candidate);
		annotationIds.push(candidate);
	}
	return { ...foundation, annotationIds };
}

function projectSchemaVersion(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('Saved project schema version must be a safe integer.');
	return Number(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
