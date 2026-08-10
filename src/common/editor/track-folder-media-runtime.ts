/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deriveTrackFolderStateProjectionV12,
	type TrackFolderStateNodeV12,
} from './track-folder-state-projection.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION,
} from './project-schema-version.ts';
import { TRACK_FOLDER_V12_LIMITS } from './track-folder-v12.ts';
import { TRACK_HIERARCHY_V12_LIMITS } from './track-hierarchy-v12.ts';

export const TRACK_FOLDER_STATE_PROJECTION_VERSION = 1 as const;
export const TRACK_FOLDER_STATE_PROJECTION_MARKER = 'trackFolderStateProjectionVersion' as const;

type DataRecord = Record<PropertyKey, unknown>;

// Pinned to the exact current revision so a schema bump fails closed here
// instead of projecting a document this derivation was never reviewed against.
const EXACT_TRACK_FOLDER_SCHEMA_VERSION = AUDIO_EDITOR_PROJECT_V14_SCHEMA_VERSION;
const TRUSTED_MEDIA_PROJECTIONS = new WeakMap<object, string>();
// Re-projection cache per canonical input identity. The fingerprint is the
// folder lineage PLUS leaf audibility flags, so a hit skips hierarchy
// validation and the full state derivation while any input change - folder,
// node, or leaf flag - forces a fresh derivation. This is one bounded walk
// instead of validation plus projection, not O(1), and it never weakens the
// trust WeakMap or widens what mediaProjectionLineage itself covers.
const MEDIA_PROJECTION_CACHE = new WeakMap<object, { fingerprint: string; projected: object }>();

/**
 * Flatten exact V12 folder media state into a transient leaf projection.
 * Canonical input and nested routing records remain untouched. The marker is
 * enumerable so explicit transient clones can retain it, while the private
 * WeakMap prevents persisted or caller-forged markers from bypassing derivation.
 */
export function projectTrackFolderMediaStateV12<Project extends object>(project: Project): Project {
	if (AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION !== EXACT_TRACK_FOLDER_SCHEMA_VERSION) return project;
	const candidate = dataRecord(project, 'track folder media project');
	if (optionalOwnData(candidate, 'schemaVersion', 'track folder media project')
		!== EXACT_TRACK_FOLDER_SCHEMA_VERSION) return project;
	const marker = ownDescriptor(candidate, TRACK_FOLDER_STATE_PROJECTION_MARKER);
	if (marker !== undefined) {
		if (isTrackFolderMediaStateProjectionV12(candidate)) return project;
		throw new TypeError('A track folder media projection marker is not trusted.');
	}
	const trackFolders = requiredOwnData(candidate, 'trackFolders', 'track folder media project');
	if (canonicalArray(
		trackFolders,
		'track folder media project.trackFolders',
		TRACK_FOLDER_V12_LIMITS.maximumFolders,
	).length === 0) return project;

	const tracks = canonicalArray(
		requiredOwnData(candidate, 'tracks', 'track folder media project'),
		'track folder media project.tracks',
		TRACK_HIERARCHY_V12_LIMITS.maximumNodes,
	);
	const lineage = mediaProjectionLineage(candidate);
	const fingerprint = `${lineage}|${trackAudibilityFingerprint(tracks)}`;
	const cached = MEDIA_PROJECTION_CACHE.get(project);
	if (cached !== undefined && cached.fingerprint === fingerprint) {
		return cached.projected as Project;
	}
	const sequences = canonicalArray(
		requiredOwnData(candidate, 'sequences', 'track folder media project'),
		'track folder media project.sequences',
		TRACK_HIERARCHY_V12_LIMITS.maximumSequences,
	).map((value, index) => {
		const sequence = dataRecord(value, `track folder media project.sequences[${String(index)}]`);
		return {
			id: requiredOwnData(sequence, 'id', `track folder media project.sequences[${String(index)}]`),
			trackNodes: requiredOwnData(
				sequence,
				'trackNodes',
				`track folder media project.sequences[${String(index)}]`,
			),
			trackIds: requiredOwnData(
				sequence,
				'trackIds',
				`track folder media project.sequences[${String(index)}]`,
			),
		};
	});
	const projection = deriveTrackFolderStateProjectionV12(sequences, { trackFolders, tracks });
	const stateByTrackId = new Map<string, TrackFolderStateNodeV12>();
	for (const sequence of projection.sequences) for (const state of sequence.nodes) {
		if (state.kind === 'track') stateByTrackId.set(state.id, state);
	}
	const projectedTracks = tracks.map((value, index) => {
		const track = dataRecord(value, `track folder media project.tracks[${String(index)}]`);
		const id = requiredOwnData(track, 'id', `track folder media project.tracks[${String(index)}]`);
		if (typeof id !== 'string') throw new TypeError('A projected track ID must be a string.');
		const state = stateByTrackId.get(id);
		if (!state || state.kind !== 'track') throw new ReferenceError(`Missing projected track state for ${id}.`);
		if (state.type === 'audio') {
			return replaceDataProperties(track, {
				mute: state.effectiveMuted,
				solo: state.effectiveSoloed,
			});
		}
		if (state.type === 'video') {
			return replaceDataProperties(track, { hidden: state.effectiveHidden });
		}
		return track;
	});
	const projected = replaceDataProperties(candidate, {
		tracks: Object.freeze(projectedTracks),
		[TRACK_FOLDER_STATE_PROJECTION_MARKER]: TRACK_FOLDER_STATE_PROJECTION_VERSION,
	}) as unknown as Project;
	TRUSTED_MEDIA_PROJECTIONS.set(projected, lineage);
	MEDIA_PROJECTION_CACHE.set(project, { fingerprint, projected });
	return projected;
}

/**
 * Transfer private trust across one explicit transient clone or fallback
 * derivation which retained the exact enumerable marker.
 */
export function inheritTrackFolderMediaStateProjectionV12<Project extends object>(
	source: object,
	target: Project,
): Project {
	if (AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION !== EXACT_TRACK_FOLDER_SCHEMA_VERSION) return target;
	const sourceRecord = dataRecord(source, 'track folder media projection source');
	if (optionalOwnData(sourceRecord, 'schemaVersion', 'track folder media projection source')
		!== EXACT_TRACK_FOLDER_SCHEMA_VERSION) return target;
	const sourceLineage = TRUSTED_MEDIA_PROJECTIONS.get(source);
	if (!isTrackFolderMediaStateProjectionV12(source) || sourceLineage === undefined) {
		if (ownDescriptor(sourceRecord, TRACK_FOLDER_STATE_PROJECTION_MARKER)) {
			throw new TypeError('A track folder media projection source is not trusted.');
		}
		return target;
	}
	const candidate = dataRecord(target, 'track folder media projection target');
	if (!hasExactMarker(candidate)) {
		throw new TypeError('A derived track folder media projection must retain its exact marker.');
	}
	if (optionalOwnData(candidate, 'schemaVersion', 'track folder media projection target')
		!== EXACT_TRACK_FOLDER_SCHEMA_VERSION) {
		throw new TypeError('A derived track folder media projection must retain exact current schema.');
	}
	if (mediaProjectionLineage(candidate) !== sourceLineage) {
		throw new TypeError('A derived track folder media projection must retain its source folder lineage.');
	}
	TRUSTED_MEDIA_PROJECTIONS.set(target, sourceLineage);
	return target;
}

/** Return whether a transient project carries both the exact marker and private trust. */
export function isTrackFolderMediaStateProjectionV12(value: unknown): boolean {
	return Boolean(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION === EXACT_TRACK_FOLDER_SCHEMA_VERSION
		&& value && typeof value === 'object' && !Array.isArray(value)
		&& TRUSTED_MEDIA_PROJECTIONS.has(value)
		&& hasExactMarker(value as DataRecord));
}

function mediaProjectionLineage(project: DataRecord): string {
	const folders = canonicalArray(
		requiredOwnData(project, 'trackFolders', 'track folder media projection lineage'),
		'track folder media projection lineage.trackFolders',
		TRACK_FOLDER_V12_LIMITS.maximumFolders,
	).map((value, index) => {
		const name = `track folder media projection lineage.trackFolders[${String(index)}]`;
		const folder = dataRecord(value, name);
		return ['id', 'name', 'collapsed', 'height', 'hidden', 'mute', 'solo']
			.map((key) => lineagePrimitive(requiredOwnData(folder, key, name), `${name}.${key}`));
	});
	let nodeCount = 0;
	const sequences = canonicalArray(
		requiredOwnData(project, 'sequences', 'track folder media projection lineage'),
		'track folder media projection lineage.sequences',
		TRACK_HIERARCHY_V12_LIMITS.maximumSequences,
	).map((value, index) => {
		const name = `track folder media projection lineage.sequences[${String(index)}]`;
		const sequence = dataRecord(value, name);
		const nodes = canonicalArray(
			requiredOwnData(sequence, 'trackNodes', name),
			`${name}.trackNodes`,
			TRACK_HIERARCHY_V12_LIMITS.maximumNodes - nodeCount,
		).map((nodeValue, nodeIndex) => {
			const nodeName = `${name}.trackNodes[${String(nodeIndex)}]`;
			const node = dataRecord(nodeValue, nodeName);
			return ['kind', 'id', 'parentFolderId']
				.map((key) => lineagePrimitive(requiredOwnData(node, key, nodeName), `${nodeName}.${key}`));
		});
		nodeCount += nodes.length;
		const trackIds = canonicalArray(
			requiredOwnData(sequence, 'trackIds', name),
			`${name}.trackIds`,
			TRACK_HIERARCHY_V12_LIMITS.maximumNodes,
		).map((id, trackIndex) => lineagePrimitive(id, `${name}.trackIds[${String(trackIndex)}]`));
		return [
			lineagePrimitive(requiredOwnData(sequence, 'id', name), `${name}.id`),
			nodes,
			trackIds,
		];
	});
	return JSON.stringify([
		lineagePrimitive(requiredOwnData(project, 'id', 'track folder media projection lineage'), 'project.id'),
		lineagePrimitive(
			requiredOwnData(project, 'revision', 'track folder media projection lineage'),
			'project.revision',
		),
		folders,
		sequences,
	]);
}

function trackAudibilityFingerprint(tracks: readonly unknown[]): string {
	return JSON.stringify(tracks.map((value, index) => {
		const track = dataRecord(value, `track folder media cache.tracks[${String(index)}]`);
		return ['id', 'type', 'mute', 'solo', 'hidden', 'laneGroupId'].map((key) => {
			const entry = optionalOwnData(track, key, `track folder media cache.tracks[${String(index)}]`);
			return entry === undefined || entry === null || typeof entry === 'string'
				|| typeof entry === 'boolean' || typeof entry === 'number'
				? entry ?? null
				: String(entry);
		});
	}));
}

function lineagePrimitive(value: unknown, name: string): string | number | boolean | null {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return value;
	throw new TypeError(`${name} must be a canonical folder-lineage primitive.`);
}

function hasExactMarker(value: DataRecord): boolean {
	const descriptor = ownDescriptor(value, TRACK_FOLDER_STATE_PROJECTION_MARKER);
	return Boolean(descriptor?.enumerable
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === TRACK_FOLDER_STATE_PROJECTION_VERSION);
}

function replaceDataProperties(value: DataRecord, replacements: Record<string, unknown>): DataRecord {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, replacement] of Object.entries(replacements)) {
		descriptors[key] = { configurable: true, enumerable: true, writable: true, value: replacement };
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(value) as object | null, descriptors) as DataRecord);
}

function canonicalArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a canonical array.`);
	}
	if (!Number.isSafeInteger(maximumLength) || maximumLength < 0 || value.length > maximumLength) {
		throw new RangeError(`${name} exceeds its canonical length limit.`);
	}
	const snapshot: unknown[] = [];
	const allowed = new Set<string>(['length']);
	for (let index = 0; index < value.length; index += 1) {
		const key = String(index);
		allowed.add(key);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must be a dense canonical array of enumerable data elements.`);
		}
		snapshot.push(descriptor.value);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported canonical array field: ${String(key)}.`);
		}
	}
	return snapshot;
}

function requiredOwnData(value: DataRecord, key: string, name: string): unknown {
	const descriptor = ownDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalOwnData(value: DataRecord, key: string, name: string): unknown {
	const descriptor = ownDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function ownDescriptor(value: DataRecord, key: string): PropertyDescriptor | undefined {
	return Object.getOwnPropertyDescriptor(value, key);
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a data object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain data object.`);
	}
	return value as DataRecord;
}
