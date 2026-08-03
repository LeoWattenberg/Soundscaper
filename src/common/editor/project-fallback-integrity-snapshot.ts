/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	snapshotScapeProjectFallbackIntegrity,
	type ScapeProjectFallbackClaim,
} from './scape-project-assets.ts';
import {
	PROJECT_FEATURE_REQUIREMENTS_LIMITS,
	type ProjectFeatureRequirement,
} from './project-feature-requirements.ts';
import type { ProjectAudioFallbackSource } from './project-fallback-integrity-audio.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-v9.ts';

export interface ProjectFallbackIntegritySource extends ProjectAudioFallbackSource {
	readonly width?: number;
	readonly height?: number;
	readonly frameRate?: number;
	readonly hasAudio?: boolean;
}

export interface CapturedProjectFallbackIntegrity {
	readonly schemaVersion: unknown;
	readonly claims: readonly ScapeProjectFallbackClaim[];
	readonly requirements: readonly ProjectFeatureRequirement[];
	readonly sources: readonly ProjectFallbackIntegritySource[];
	readonly clips: readonly Readonly<Record<PropertyKey, unknown>>[];
}

export function captureProjectFallbackIntegrity(project: unknown): CapturedProjectFallbackIntegrity {
	const candidate = objectRecord(project, 'The project fallback integrity candidate');
	const schemaVersion = ownDataValue(candidate, 'schemaVersion', 'project');
	if (schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) {
		return Object.freeze({
			schemaVersion,
			claims: Object.freeze([]),
			requirements: Object.freeze([]),
			sources: Object.freeze([]),
			clips: Object.freeze([]),
		});
	}
	const sources = snapshotArray(
		ownDataValue(candidate, 'sources', 'project'),
		'project.sources',
		snapshotSource,
	);
	const clipsValue = optionalOwnDataValue(candidate, 'clips', 'project');
	const clips = clipsValue === undefined
		? Object.freeze([])
		: snapshotArray(clipsValue, 'project.clips', snapshotClip);
	const featureRequirements = snapshotFeatureRequirements(
		ownDataValue(candidate, 'featureRequirements', 'project'),
	);
	const snapshot = snapshotScapeProjectFallbackIntegrity(Object.freeze({
		schemaVersion,
		sources,
		clips,
		featureRequirements,
	}));
	return Object.freeze({
		schemaVersion,
		claims: snapshot.claims,
		requirements: snapshot.featureRequirements?.requirements ?? Object.freeze([]),
		sources,
		clips,
	});
}

export function sameCapturedProjectFallbackIntegrity(
	left: CapturedProjectFallbackIntegrity,
	right: CapturedProjectFallbackIntegrity,
): boolean {
	if (left.schemaVersion !== right.schemaVersion
		|| left.claims.length !== right.claims.length
		|| left.sources.length !== right.sources.length
		|| left.clips.length !== right.clips.length) return false;
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
		channelCount: optionalOwnDataValue(source, 'channelCount', `project source ${id}`) as number,
		chunkFrames: optionalOwnDataValue(source, 'chunkFrames', `project source ${id}`) as number,
		sampleRate: optionalOwnDataValue(source, 'sampleRate', `project source ${id}`) as number | undefined,
		width: optionalOwnDataValue(source, 'width', `project source ${id}`) as number | undefined,
		height: optionalOwnDataValue(source, 'height', `project source ${id}`) as number | undefined,
		frameRate: optionalOwnDataValue(source, 'frameRate', `project source ${id}`) as number | undefined,
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
		durationFrames: optionalOwnDataValue(clip, 'durationFrames', label),
		videoEffects: videoEffects === undefined
			? undefined
			: snapshotVideoEffects(videoEffects, `${label}.videoEffects`),
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
	return claim.role === 'video-clip-render-v1' ? claim.targetClipId : null;
}

function sameSource(
	left: ProjectFallbackIntegritySource | undefined,
	right: ProjectFallbackIntegritySource | undefined,
): boolean {
	return Boolean(left && right && left.id === right.id && left.kind === right.kind
		&& left.storageKey === right.storageKey && left.frameCount === right.frameCount
		&& left.channelCount === right.channelCount && left.chunkFrames === right.chunkFrames
		&& left.sampleRate === right.sampleRate && left.width === right.width
		&& left.height === right.height && left.frameRate === right.frameRate
		&& left.hasAudio === right.hasAudio);
}

function sameSnapshotValue(left: unknown, right: unknown, remainingDepth = 4): boolean {
	if (Object.is(left, right)) return true;
	if (remainingDepth === 0) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((value, index) => sameSnapshotValue(value, right[index], remainingDepth - 1));
	}
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	const leftRecord = left as Readonly<Record<string, unknown>>;
	const rightRecord = right as Readonly<Record<string, unknown>>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => (
		key === rightKeys[index]
			&& sameSnapshotValue(leftRecord[key], rightRecord[key], remainingDepth - 1)
	));
}
