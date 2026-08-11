/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION } from './project-schema-version.ts';
import {
	createAudioEditorProjectV15,
	type AudioEditorProjectV15Options,
} from './project-v15.ts';
import {
	validateAudioEditorProjectV16,
	type AudioEditorProjectV16,
} from './project-v16-validation.ts';
import { normalizeVideoRetimeCurveV16 } from './video-retime-v16.ts';

export { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';
export const AUDIO_EDITOR_PROJECT_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION;
export {
	AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION,
	validateAudioEditorProjectV16,
	type AudioEditorProjectV16,
} from './project-v16-validation.ts';

export type AudioEditorProjectV16Options = AudioEditorProjectV15Options;

interface RetimeSnapshot {
	readonly present: boolean;
	readonly value: unknown;
}

interface SanitizedV16Options {
	readonly options: AudioEditorProjectV15Options;
	readonly timeline: readonly RetimeSnapshot[];
	readonly bin: readonly RetimeSnapshot[];
}

/** Create V16 without exposing its curve wire to the historical V10 normalizer. */
export function createAudioEditorProjectV16(
	options: AudioEditorProjectV16Options = {},
): AudioEditorProjectV16 {
	const sanitized = sanitizeV16Options(options);
	const foundation = createAudioEditorProjectV15(sanitized.options) as unknown as Record<string, unknown>;
	const clips = restoreCurveMaps(
		recordArray(foundation.clips, 'project.clips'),
		sanitized.timeline,
		'project.clips',
	);
	const bin = dataRecord(foundation.projectBin, 'project.projectBin');
	const binClips = restoreCurveMaps(
		recordArray(dataValue(bin, 'clips', 'project.projectBin'), 'project.projectBin.clips'),
		sanitized.bin,
		'project.projectBin.clips',
	);
	const project: Record<string, unknown> = {
		...foundation,
		schemaVersion: AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION,
		clips,
		projectBin: { ...bin, clips: binClips },
	};
	const sources = recordArray(project.sources, 'project.sources');
	const tracks = recordArray(project.tracks, 'project.tracks');
	const sequences = recordArray(project.sequences, 'project.sequences');
	const featureRequirements = normalizeProjectFeatureRequirements(project.featureRequirements, {
		sources,
		clips,
		tracks,
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences,
		primarySequenceId: project.primarySequenceId,
	});
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(project, featureRequirements);
	validateAudioEditorProjectV16(project);
	return project as unknown as AudioEditorProjectV16;
}

export function cloneAudioEditorProjectV16(project: AudioEditorProjectV16): AudioEditorProjectV16 {
	validateAudioEditorProjectV16(project);
	return clone(project);
}

export function loadAudioEditorProjectV16(value: unknown): {
	project: AudioEditorProjectV16 | Record<string, unknown>;
	readOnly: boolean;
	reason: 'newer-schema' | null;
} {
	const candidate = dataRecord(value, 'saved project');
	const schemaVersion = projectSchemaVersion(dataValue(candidate, 'schemaVersion', 'saved project'));
	if (schemaVersion > AUDIO_EDITOR_PROJECT_V16_SCHEMA_VERSION) {
		return { project: clone(candidate), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProjectV16(candidate);
	return { project: clone(candidate), readOnly: false, reason: null };
}

function sanitizeV16Options(options: AudioEditorProjectV16Options): SanitizedV16Options {
	const input = dataRecord(options, 'project options');
	const timeline = sanitizeClipCollection(optionalArray(input, 'clips'), 'project options.clips');
	const projectBinValue = optionalDataValue(input, 'projectBin', 'project options');
	const projectBin = projectBinValue == null
		? null
		: dataRecord(projectBinValue, 'project options.projectBin');
	const bin = sanitizeClipCollection(
		projectBin ? optionalArray(projectBin, 'clips') : null,
		'project options.projectBin.clips',
	);
	const sanitizedOptions = {
		...options,
		...(timeline.values === null ? {} : { clips: timeline.values }),
		...(projectBin === null ? {} : {
			projectBin: {
				...projectBin,
				...(bin.values === null ? {} : { clips: bin.values }),
			},
		}),
	};
	return {
		options: sanitizedOptions,
		timeline: timeline.snapshots,
		bin: bin.snapshots,
	};
}

function sanitizeClipCollection(
	values: readonly unknown[] | null,
	name: string,
): { readonly values: readonly Record<string, unknown>[] | null; readonly snapshots: readonly RetimeSnapshot[] } {
	if (values === null) return { values: null, snapshots: [] };
	const snapshots: RetimeSnapshot[] = [];
	const sanitized = values.map((value, index) => {
		const clip = dataRecord(value, `${name}[${String(index)}]`);
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'retimeMap');
		if (!descriptor) {
			snapshots.push({ present: false, value: undefined });
			return clip;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}].retimeMap must be an enumerable data property.`);
		}
		snapshots.push({ present: true, value: descriptor.value });
		return { ...clip, retimeMap: null };
	});
	return { values: sanitized, snapshots };
}

function restoreCurveMaps(
	clips: readonly Record<string, unknown>[],
	snapshots: readonly RetimeSnapshot[],
	name: string,
): readonly Record<string, unknown>[] {
	if (snapshots.length !== 0 && snapshots.length !== clips.length) {
		throw new RangeError(`${name} changed length while creating V16.`);
	}
	return clips.map((clip, index) => {
		const snapshot = snapshots[index];
		if (!snapshot?.present || snapshot.value == null) return clip;
		if (dataValue(clip, 'kind', `${name}[${String(index)}]`) !== 'video') {
			throw new TypeError(`${name}[${String(index)}] retime state requires a video clip.`);
		}
		const retimeMap = normalizeVideoRetimeCurveV16(snapshot.value, {
			sequenceFrameCount: dataValue(clip, 'sequenceFrameCount', `${name}[${String(index)}]`),
			sourceInFrame: dataValue(clip, 'sourceInFrame', `${name}[${String(index)}]`),
			sourceFrameCount: dataValue(clip, 'sourceFrameCount', `${name}[${String(index)}]`),
		});
		return { ...clip, retimeMap };
	});
}

function projectSchemaVersion(value: unknown): number {
	if (!Number.isSafeInteger(value)) throw new RangeError('Saved project schema version must be a safe integer.');
	return Number(value);
}

function optionalArray(value: Record<string, unknown>, key: string): readonly unknown[] | null {
	const candidate = optionalDataValue(value, key, 'project options');
	if (candidate === undefined) return null;
	if (!Array.isArray(candidate)) throw new TypeError(`project options.${key} must be an array.`);
	return candidate;
}

function recordArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function dataValue(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataValue(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
