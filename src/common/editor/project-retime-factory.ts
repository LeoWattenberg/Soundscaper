/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeProjectFeatureRequirements } from './project-feature-requirements.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import { normalizeVideoRetimeCurveV16 } from './video-retime-v16.ts';

type DataRecord = Record<string, unknown>;

export interface ProjectRetimeFoundationOptions extends Readonly<DataRecord> {
	readonly clips?: readonly Readonly<DataRecord>[];
	readonly projectBin?: Readonly<DataRecord>;
}

export interface ProjectRetimeFoundation extends DataRecord {
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly Readonly<DataRecord>[];
	readonly clips: readonly Readonly<DataRecord>[];
	readonly tracks: readonly Readonly<DataRecord>[];
	readonly sequences: readonly Readonly<DataRecord>[];
	readonly primarySequenceId: string;
	readonly projectBin: Readonly<DataRecord> & {
		readonly clips: readonly Readonly<DataRecord>[];
	};
}

export type ProjectRetimeFoundationFactory = (
	options: Readonly<DataRecord>,
) => Readonly<DataRecord>;

interface RetimeSnapshot {
	readonly present: boolean;
	readonly value: unknown;
}

interface SanitizedProjectRetimeOptions {
	readonly options: Readonly<DataRecord>;
	readonly timeline: readonly RetimeSnapshot[];
	readonly bin: readonly RetimeSnapshot[];
}

/**
 * Hide current retime curves from an earlier foundation step, then restore and
 * bind them to the normalized clip geometry without changing the chosen schema.
 */
export function createProjectRetimeFoundation(
	options: ProjectRetimeFoundationOptions = {},
	foundationFactory: ProjectRetimeFoundationFactory,
): ProjectRetimeFoundation {
	if (typeof foundationFactory !== 'function') {
		throw new TypeError('Project retime foundation factory must be a function.');
	}
	const sanitized = sanitizeProjectRetimeOptions(options);
	const foundation = dataRecord(
		foundationFactory(sanitized.options),
		'project retime foundation',
	);
	const clips = restoreCurveMaps(
		recordArray(dataValue(foundation, 'clips', 'project'), 'project.clips'),
		sanitized.timeline,
		'project.clips',
	);
	const bin = dataRecord(
		dataValue(foundation, 'projectBin', 'project'),
		'project.projectBin',
	);
	const binClips = restoreCurveMaps(
		recordArray(dataValue(bin, 'clips', 'project.projectBin'), 'project.projectBin.clips'),
		sanitized.bin,
		'project.projectBin.clips',
	);
	const project: DataRecord = {
		...foundation,
		clips,
		projectBin: { ...bin, clips: binClips },
	};
	reconcileFeatureRequirements(project);
	return project as ProjectRetimeFoundation;
}

function sanitizeProjectRetimeOptions(
	options: ProjectRetimeFoundationOptions,
): SanitizedProjectRetimeOptions {
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
	return {
		options: {
			...input,
			...(timeline.values === null ? {} : { clips: timeline.values }),
			...(projectBin === null ? {} : {
				projectBin: {
					...projectBin,
					...(bin.values === null ? {} : { clips: bin.values }),
				},
			}),
		},
		timeline: timeline.snapshots,
		bin: bin.snapshots,
	};
}

function sanitizeClipCollection(
	values: readonly unknown[] | null,
	name: string,
): {
	readonly values: readonly DataRecord[] | null;
	readonly snapshots: readonly RetimeSnapshot[];
} {
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
			throw new TypeError(
				`${name}[${String(index)}].retimeMap must be an enumerable data property.`,
			);
		}
		snapshots.push({ present: true, value: descriptor.value });
		return { ...clip, retimeMap: null };
	});
	return { values: sanitized, snapshots };
}

function restoreCurveMaps(
	clips: readonly DataRecord[],
	snapshots: readonly RetimeSnapshot[],
	name: string,
): readonly DataRecord[] {
	if (snapshots.length !== 0 && snapshots.length !== clips.length) {
		throw new RangeError(`${name} changed length while creating the project retime foundation.`);
	}
	return clips.map((clip, index) => {
		const snapshot = snapshots[index];
		if (!snapshot?.present || snapshot.value == null) return clip;
		if (dataValue(clip, 'kind', `${name}[${String(index)}]`) !== 'video') {
			throw new TypeError(`${name}[${String(index)}] retime state requires a video clip.`);
		}
		const retimeMap = normalizeVideoRetimeCurveV16(snapshot.value, {
			sequenceFrameCount: dataValue(
				clip,
				'sequenceFrameCount',
				`${name}[${String(index)}]`,
			),
			sourceInFrame: dataValue(clip, 'sourceInFrame', `${name}[${String(index)}]`),
			sourceFrameCount: dataValue(
				clip,
				'sourceFrameCount',
				`${name}[${String(index)}]`,
			),
		});
		return { ...clip, retimeMap };
	});
}

function reconcileFeatureRequirements(project: DataRecord): void {
	const sources = recordArray(dataValue(project, 'sources', 'project'), 'project.sources');
	const clips = recordArray(dataValue(project, 'clips', 'project'), 'project.clips');
	const tracks = recordArray(dataValue(project, 'tracks', 'project'), 'project.tracks');
	const sequences = recordArray(dataValue(project, 'sequences', 'project'), 'project.sequences');
	const featureRequirements = normalizeProjectFeatureRequirements(
		dataValue(project, 'featureRequirements', 'project'),
		{
			sources,
			clips,
			tracks,
			schemaVersion: dataValue(project, 'schemaVersion', 'project'),
			sampleRate: dataValue(project, 'sampleRate', 'project'),
			sequences,
			primarySequenceId: dataValue(project, 'primarySequenceId', 'project'),
		},
	);
	project.featureRequirements = reconcileProjectOwnedFeatureRequirements(project, featureRequirements);
}

function optionalArray(value: DataRecord, key: string): readonly unknown[] | null {
	const candidate = optionalDataValue(value, key, 'project options');
	if (candidate === undefined) return null;
	if (!Array.isArray(candidate)) throw new TypeError(`project options.${key} must be an array.`);
	return candidate;
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataValue(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}
