/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	snapshotScapeProjectFallbackIntegrity,
	type ScapeProjectFallbackClaim,
} from './scape-project-assets.ts';
import {
	normalizeProjectFeatureRequirements,
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import type { ProjectAudioFallbackSource } from './project-fallback-integrity-audio.ts';
import {
	isMaintainedRenderedFallbackProjectSchema,
	isSoundscaperProductionProjectSchema,
} from './project-schema-version.ts';
import { snapshotInertJsonValue } from './inert-json-snapshot.ts';

export interface ProjectFallbackIntegritySource extends ProjectAudioFallbackSource {
	readonly contentSha256?: string;
	readonly width?: number;
	readonly height?: number;
	readonly sampleFrameCount?: number;
	readonly sourceFrameCount?: number;
	readonly frameRate?: unknown;
	readonly timingAsset?: unknown;
	readonly hasAudio?: boolean;
}

export interface CapturedProjectFallbackIntegrity {
	readonly schemaVersion: unknown;
	readonly sampleRate: unknown;
	readonly primarySequenceId: unknown;
	readonly sequences: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly claims: readonly ScapeProjectFallbackClaim[];
	readonly requirements: readonly ProjectFeatureRequirement[];
	readonly sources: readonly ProjectFallbackIntegritySource[];
	readonly clips: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly tracks: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly automationLanes: readonly Readonly<Record<PropertyKey, unknown>>[];
}

export function captureProjectFallbackIntegrity(project: unknown): CapturedProjectFallbackIntegrity {
	const candidate = objectRecord(project, 'The project fallback integrity candidate');
	const schemaVersion = ownDataValue(candidate, 'schemaVersion', 'project');
	if (!isMaintainedRenderedFallbackProjectSchema(schemaVersion)) {
		return Object.freeze({
			schemaVersion,
			sampleRate: undefined,
			primarySequenceId: undefined,
			sequences: Object.freeze([]),
			claims: Object.freeze([]),
			requirements: Object.freeze([]),
			sources: Object.freeze([]),
			clips: Object.freeze([]),
			tracks: Object.freeze([]),
			automationLanes: Object.freeze([]),
		});
	}
	const freezeAuthority = isSoundscaperProductionProjectSchema(schemaVersion);
	const sources = snapshotArray(
		ownDataValue(candidate, 'sources', 'project'),
		'project.sources',
		snapshotSource,
	);
	const clipsValue = optionalOwnDataValue(candidate, 'clips', 'project');
	const clips = clipsValue === undefined
		? Object.freeze([])
		: snapshotArray(clipsValue, 'project.clips', (value, index) => (
			freezeAuthority ? snapshotFreezeAuthority(value, `project.clips[${String(index)}]`) : snapshotClip(value, index)
		));
	const tracksValue = optionalOwnDataValue(candidate, 'tracks', 'project');
	const tracks = tracksValue === undefined
		? Object.freeze([])
		: snapshotArray(tracksValue, 'project.tracks', (value, index) => (
			freezeAuthority ? snapshotFreezeAuthority(value, `project.tracks[${String(index)}]`) : snapshotTrack(value, index)
		));
	const automationLanes = freezeAuthority ? snapshotArray(
		ownDataValue(candidate, 'automationLanes', 'project'),
		'project.automationLanes',
		(value, index) => snapshotFreezeAuthority(value, `project.automationLanes[${String(index)}]`),
	) : Object.freeze([]);
	const sampleRate = ownDataValue(candidate, 'sampleRate', 'project');
	const primarySequenceId = ownDataValue(candidate, 'primarySequenceId', 'project');
	const sequences = snapshotArray(
		ownDataValue(candidate, 'sequences', 'project'),
		'project.sequences',
		snapshotSequence,
	);
	const featureRequirements = snapshotFeatureRequirements(
		ownDataValue(candidate, 'featureRequirements', 'project'),
	);
	const snapshot = freezeAuthority
		? soundscaperV21FallbackSnapshot({
			schemaVersion, sampleRate, primarySequenceId, sequences, sources, clips, tracks,
			featureRequirements,
		})
		: snapshotScapeProjectFallbackIntegrity(Object.freeze({
			schemaVersion, sampleRate, primarySequenceId, sequences, sources, clips, tracks,
			featureRequirements,
		}), { currentProjectSchemaVersion: Number(schemaVersion) });
	return Object.freeze({
		schemaVersion,
		sampleRate,
		primarySequenceId,
		sequences,
		claims: snapshot.claims,
		requirements: snapshot.featureRequirements?.requirements ?? Object.freeze([]),
		sources,
		clips,
		tracks,
		automationLanes,
	});
}

export function sameCapturedProjectFallbackIntegrity(
	left: CapturedProjectFallbackIntegrity,
	right: CapturedProjectFallbackIntegrity,
): boolean {
	if (left.schemaVersion !== right.schemaVersion
		|| left.sampleRate !== right.sampleRate
		|| left.primarySequenceId !== right.primarySequenceId
		|| !sameSnapshotValue(left.sequences, right.sequences)
		|| left.claims.length !== right.claims.length
		|| left.sources.length !== right.sources.length
		|| left.clips.length !== right.clips.length
		|| left.tracks.length !== right.tracks.length
		|| !sameSnapshotValue(left.automationLanes, right.automationLanes)) return false;
	for (let index = 0; index < left.claims.length; index += 1) {
		const first = left.claims[index];
		const second = right.claims[index];
		if (!first || !second || first.role !== second.role || first.kind !== second.kind
			|| fallbackTarget(first) !== fallbackTarget(second)
			|| first.sourceId !== second.sourceId || first.sha256 !== second.sha256) return false;
	}
	for (let index = 0; index < left.sources.length; index += 1) {
		if (!sameSource(left.sources[index], right.sources[index])) return false;
	}
	for (let index = 0; index < left.clips.length; index += 1) {
		if (!sameSnapshotValue(left.clips[index], right.clips[index])) return false;
	}
	for (let index = 0; index < left.tracks.length; index += 1) {
		if (!sameSnapshotValue(left.tracks[index], right.tracks[index])) return false;
	}
	return true;
}

function snapshotSource(value: unknown, index: number): ProjectFallbackIntegritySource {
	const source = objectRecord(value, `project.sources[${String(index)}]`);
	const id = ownDataValue(source, 'id', `project.sources[${String(index)}]`);
	if (typeof id !== 'string' || !id) {
		throw new TypeError('A rendered fallback source must have an ID.');
	}
	return Object.freeze({
		id,
		kind: optionalOwnDataValue(source, 'kind', `project source ${id}`) as 'audio' | 'video' | undefined,
		storageKey: optionalOwnDataValue(source, 'storageKey', `project source ${id}`) as string | undefined,
		frameCount: optionalOwnDataValue(source, 'frameCount', `project source ${id}`) as number,
		sampleFrameCount: optionalOwnDataValue(source, 'sampleFrameCount', `project source ${id}`) as number,
		sourceFrameCount: optionalOwnDataValue(source, 'sourceFrameCount', `project source ${id}`) as number,
		channelCount: optionalOwnDataValue(source, 'channelCount', `project source ${id}`) as number,
		chunkFrames: optionalOwnDataValue(source, 'chunkFrames', `project source ${id}`) as number,
		contentSha256: optionalOwnDataValue(source, 'contentSha256', `project source ${id}`) as string | undefined,
		sampleRate: optionalOwnDataValue(source, 'sampleRate', `project source ${id}`) as number | undefined,
		width: optionalOwnDataValue(source, 'width', `project source ${id}`) as number | undefined,
		height: optionalOwnDataValue(source, 'height', `project source ${id}`) as number | undefined,
		frameRate: snapshotOptionalRecordValue(source, 'frameRate', `project source ${id}`),
		timingAsset: snapshotOptionalRecordValue(source, 'timingAsset', `project source ${id}`),
		hasAudio: optionalOwnDataValue(source, 'hasAudio', `project source ${id}`) as boolean | undefined,
	});
}

function snapshotClip(value: unknown, index: number): Readonly<Record<PropertyKey, unknown>> {
	const label = `project.clips[${String(index)}]`;
	const clip = objectRecord(value, label);
	const videoEffects = optionalOwnDataValue(clip, 'videoEffects', label);
	return Object.freeze({
		id: optionalOwnDataValue(clip, 'id', label),
		kind: optionalOwnDataValue(clip, 'kind', label),
		sourceId: optionalOwnDataValue(clip, 'sourceId', label),
		timelineStartFrame: optionalOwnDataValue(clip, 'timelineStartFrame', label),
		durationFrames: optionalOwnDataValue(clip, 'durationFrames', label),
		sequenceId: optionalOwnDataValue(clip, 'sequenceId', label),
		sequenceStartFrame: optionalOwnDataValue(clip, 'sequenceStartFrame', label),
		sequenceFrameCount: optionalOwnDataValue(clip, 'sequenceFrameCount', label),
		sourceInFrame: optionalOwnDataValue(clip, 'sourceInFrame', label),
		sourceFrameCount: optionalOwnDataValue(clip, 'sourceFrameCount', label),
		videoEffects: videoEffects === undefined
			? undefined
			: snapshotVideoEffects(videoEffects, `${label}.videoEffects`),
	});
}

function snapshotSequence(value: unknown, index: number): Readonly<Record<PropertyKey, unknown>> {
	const label = `project.sequences[${String(index)}]`;
	const sequence = objectRecord(value, label);
	return Object.freeze({
		id: ownDataValue(sequence, 'id', label),
		rate: snapshotOptionalRecordValue(sequence, 'rate', label),
	});
}

/**
 * A track-scoped fallback binds to rack activity and lane membership, so those
 * fields join the admission identity. Effect parameters stay outside it: the
 * admitted project is read-only, and the binding does not claim mix fidelity.
 */
function snapshotTrack(value: unknown, index: number): Readonly<Record<PropertyKey, unknown>> {
	const label = `project.tracks[${String(index)}]`;
	const track = objectRecord(value, label);
	const effects = optionalOwnDataValue(track, 'effects', label);
	const clipIds = optionalOwnDataValue(track, 'clipIds', label);
	return Object.freeze({
		id: optionalOwnDataValue(track, 'id', label),
		type: optionalOwnDataValue(track, 'type', label),
		effectsActive: optionalOwnDataValue(track, 'effectsActive', label),
		effects: effects === undefined ? undefined : snapshotArray(
			effects,
			`${label}.effects`,
			(item, effectIndex) => {
				const effectLabel = `${label}.effects[${String(effectIndex)}]`;
				const effect = objectRecord(item, effectLabel);
				return Object.freeze({
					id: optionalOwnDataValue(effect, 'id', effectLabel),
					type: optionalOwnDataValue(effect, 'type', effectLabel),
					enabled: optionalOwnDataValue(effect, 'enabled', effectLabel),
					bypassed: optionalOwnDataValue(effect, 'bypassed', effectLabel),
				});
			},
		),
		clipIds: clipIds === undefined ? undefined : snapshotArray(
			clipIds,
			`${label}.clipIds`,
			(item) => item,
		),
	});
}

function snapshotFeatureRequirements(value: unknown): Readonly<Record<string, unknown>> {
	const manifest = objectRecord(value, 'project.featureRequirements');
	const output = snapshotEnumerableDataRecord(manifest, 'project.featureRequirements');
	const requirements = snapshotArray(
		ownDataValue(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
		snapshotRequirement,
		PROJECT_FEATURE_REQUIREMENTS_LIMITS.maximumRequirements,
	);
	defineData(output, 'requirements', requirements);
	return Object.freeze(output);
}

function snapshotRequirement(value: unknown, index: number): Readonly<Record<string, unknown>> {
	const label = `project.featureRequirements.requirements[${String(index)}]`;
	const requirement = objectRecord(value, label);
	const output = snapshotEnumerableDataRecord(requirement, label);
	const fallback = optionalOwnDataValue(requirement, 'fallback', label);
	if (fallback !== undefined) {
		defineData(output, 'fallback', fallback === null
			? null
			: Object.freeze(snapshotEnumerableDataRecord(objectRecord(fallback, `${label}.fallback`), `${label}.fallback`)));
	}
	return Object.freeze(output);
}

function soundscaperV21FallbackSnapshot(context: Readonly<{
	readonly schemaVersion: unknown;
	readonly sampleRate: unknown;
	readonly primarySequenceId: unknown;
	readonly sequences: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly sources: readonly ProjectFallbackIntegritySource[];
	readonly clips: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly tracks: readonly Readonly<Record<PropertyKey, unknown>>[];
	readonly featureRequirements: Readonly<Record<string, unknown>>;
}>): Readonly<{
	readonly featureRequirements: Readonly<{ readonly requirements: readonly ProjectFeatureRequirement[] }>;
	readonly claims: readonly ScapeProjectFallbackClaim[];
}> {
	const featureRequirements = normalizeProjectFeatureRequirements(context.featureRequirements, {
		sources: context.sources,
		clips: context.clips,
		tracks: context.tracks,
		schemaVersion: context.schemaVersion,
		sampleRate: context.sampleRate,
		sequences: context.sequences,
		primarySequenceId: context.primarySequenceId,
	});
	const claims = Object.freeze(featureRequirements.requirements.flatMap((requirement) => (
		requirement.disposition === 'rendered-fallback' && requirement.fallback
			? [Object.freeze({ ...requirement.fallback })]
			: []
	)));
	return Object.freeze({ featureRequirements, claims });
}

function snapshotFreezeAuthority(
	value: unknown,
	label: string,
): Readonly<Record<PropertyKey, unknown>> {
	const snapshot = snapshotInertJsonValue(value, label, {
		maximumArrayLength: 100_000,
		maximumNodes: 250_000,
	});
	return objectRecord(snapshot, label);
}

function snapshotVideoEffects(value: unknown, label: string): readonly unknown[] {
	return snapshotArray(value, label, (item, index) => {
		const effectLabel = `${label}[${String(index)}]`;
		const effect = objectRecord(item, effectLabel);
		const output = snapshotEnumerableDataRecord(effect, effectLabel);
		for (const key of ['id', 'type', 'enabled'] as const) {
			defineData(output, key, ownDataValue(effect, key, effectLabel));
		}
		const params = ownDataValue(effect, 'params', effectLabel);
		defineData(output, 'params', Object.freeze(snapshotEnumerableDataRecord(
			objectRecord(params, `${effectLabel}.params`),
			`${effectLabel}.params`,
		)));
		return Object.freeze(output);
	});
}

function snapshotEnumerableDataRecord(
	value: Record<PropertyKey, unknown>,
	label: string,
): Record<PropertyKey, unknown> {
	const output = Object.create(null) as Record<PropertyKey, unknown>;
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !('value' in descriptor)) {
			throw new TypeError(`${label}.${key} must be an own data property.`);
		}
		defineData(output, key, descriptor.value);
	}
	return output;
}

function snapshotArray<Value>(
	value: unknown,
	label: string,
	snapshot: (item: unknown, index: number) => Value,
	maximumLength = Number.MAX_SAFE_INTEGER,
): readonly Value[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${label} must be an ordinary array.`);
	}
	const lengthValue = ownDataValue(value as unknown as Record<PropertyKey, unknown>, 'length', label);
	if (!Number.isSafeInteger(lengthValue) || Number(lengthValue) < 0) {
		throw new RangeError(`${label} has an invalid length.`);
	}
	const length = Number(lengthValue);
	if (length > maximumLength) throw new RangeError(`${label} exceeds its maximum length.`);
	const output: Value[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !('value' in descriptor)) {
			throw new TypeError(`${label}[${String(index)}] must be an own data property.`);
		}
		output.push(snapshot(descriptor.value, index));
	}
	return Object.freeze(output);
}

function objectRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as Record<PropertyKey, unknown>;
}

function ownDataValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	label: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError(`${label}.${String(key)} must be an own data property.`);
	}
	return descriptor.value;
}

function optionalOwnDataValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	label: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) return undefined;
	if (!('value' in descriptor)) {
		throw new TypeError(`${label}.${String(key)} must be an own data property.`);
	}
	return descriptor.value;
}

function defineData(record: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

function fallbackTarget(claim: ScapeProjectFallbackClaim): string | null {
	if (claim.role === 'video-clip-render-v1') return claim.targetClipId;
	if (claim.role === 'audio-track-render-v1') return claim.targetTrackId;
	return null;
}

function sameSource(
	left: ProjectFallbackIntegritySource | undefined,
	right: ProjectFallbackIntegritySource | undefined,
): boolean {
	return Boolean(left && right && left.id === right.id && left.kind === right.kind
		&& left.storageKey === right.storageKey && left.frameCount === right.frameCount
		&& left.contentSha256 === right.contentSha256
		&& left.sampleFrameCount === right.sampleFrameCount
		&& left.sourceFrameCount === right.sourceFrameCount
		&& left.channelCount === right.channelCount && left.chunkFrames === right.chunkFrames
		&& left.sampleRate === right.sampleRate && left.width === right.width
		&& left.height === right.height && sameSnapshotValue(left.frameRate, right.frameRate)
		&& sameSnapshotValue(left.timingAsset, right.timingAsset)
		&& left.hasAudio === right.hasAudio);
}

function snapshotOptionalRecordValue(
	record: Record<PropertyKey, unknown>,
	key: PropertyKey,
	label: string,
): unknown {
	const value = optionalOwnDataValue(record, key, label);
	if (value == null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return Object.freeze(value.map((item) => item));
	return Object.freeze(snapshotEnumerableDataRecord(
		objectRecord(value, `${label}.${String(key)}`),
		`${label}.${String(key)}`,
	));
}

function sameSnapshotValue(left: unknown, right: unknown): boolean {
	const pending: Array<readonly [unknown, unknown]> = [[left, right]];
	const compared = new WeakMap<object, WeakSet<object>>();
	while (pending.length > 0) {
		const [first, second] = pending.pop()!;
		if (Object.is(first, second)) continue;
		if (Array.isArray(first) || Array.isArray(second)) {
			if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
		} else if (!first || !second || typeof first !== 'object' || typeof second !== 'object') {
			return false;
		}
		const firstObject = first as object;
		const secondObject = second as object;
		let matches = compared.get(firstObject);
		if (matches?.has(secondObject)) continue;
		if (!matches) {
			matches = new WeakSet<object>();
			compared.set(firstObject, matches);
		}
		matches.add(secondObject);
		if (Array.isArray(first) && Array.isArray(second)) {
			for (let index = first.length - 1; index >= 0; index -= 1) {
				pending.push([first[index], second[index]]);
			}
			continue;
		}
		const firstRecord = first as Readonly<Record<string, unknown>>;
		const secondRecord = second as Readonly<Record<string, unknown>>;
		const firstKeys = Object.keys(firstRecord);
		const secondKeys = Object.keys(secondRecord);
		if (firstKeys.length !== secondKeys.length) return false;
		for (let index = firstKeys.length - 1; index >= 0; index -= 1) {
			const key = firstKeys[index]!;
			if (key !== secondKeys[index]) return false;
			pending.push([firstRecord[key], secondRecord[key]]);
		}
	}
	return true;
}
