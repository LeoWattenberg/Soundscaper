/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	type ProjectFeatureVideoCapabilityId,
} from './project-feature-capabilities.ts';
import type { ProjectFeatureVideoClipRenderFallback } from './project-feature-requirements.ts';
import { resolveRuntimeClipProjection } from './runtime-clip-projection.ts';
import { normalizeVideoEffects } from './video-effects.js';

export interface ProjectFeatureVideoClipRenderV1Descriptor {
	readonly featureId: ProjectFeatureVideoCapabilityId;
	readonly requirementId: string;
	readonly fallback: ProjectFeatureVideoClipRenderFallback;
}

export interface ProjectFeatureVideoClipRenderV1Metadata {
	readonly schemaVersion: 1;
	readonly role: 'video-clip-render-v1';
	readonly featureId: typeof PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
	readonly requirementId: string;
	readonly sourceId: string;
	readonly targetClipId: string;
}

export interface ProjectFeatureVideoClipRenderV1Projection<Project> {
	readonly project: Project;
	readonly metadata: ProjectFeatureVideoClipRenderV1Metadata;
}

type RecordValue = Readonly<Record<string, unknown>>;

/**
 * Replace one video-effects clip with its complete publisher-supplied render.
 * Timeline placement, track membership, identity, grouping, and Project Bin
 * state remain canonical; only source-local transforms become neutral.
 */
export function projectFeatureVideoClipRenderV1Playback<Project extends object>(
	project: Project,
	descriptor: ProjectFeatureVideoClipRenderV1Descriptor,
): ProjectFeatureVideoClipRenderV1Projection<Project> {
	const projectRecord = recordValue(project, 'project');
	assertDescriptor(descriptor);
	assertManifestBinding(projectRecord, descriptor);
	const clips = arrayValue(dataProperty(projectRecord, 'clips', 'project'), 'project.clips');
	const target = exactRecordById(clips, descriptor.fallback.targetClipId, 'target clip');
	if (dataProperty(target.value, 'kind', target.name) !== 'video') {
		throw new RangeError('A video clip rendered fallback target must be video.');
	}
	const videoEffects = normalizeVideoEffects(
		dataProperty(target.value, 'videoEffects', target.name),
		`${target.name}.videoEffects`,
	);
	if (!videoEffects.some((effect) => effect.enabled)) {
		throw new RangeError('A video clip rendered fallback target requires at least one enabled maintained video effect.');
	}
	const sources = arrayValue(dataProperty(projectRecord, 'sources', 'project'), 'project.sources');
	const fallbackSource = exactRecordById(sources, descriptor.fallback.sourceId, 'fallback source').value;
	const targetSourceId = canonicalString(
		dataProperty(target.value, 'sourceId', target.name),
		'Video clip rendered fallback target source ID',
	);
	if (targetSourceId === descriptor.fallback.sourceId) {
		throw new RangeError('A video clip rendered fallback must differ from the target canonical source.');
	}
	const targetSource = exactRecordById(sources, targetSourceId, 'target canonical source').value;
	assertSourceGeometry(projectRecord, target.value, targetSource, fallbackSource);

	const foundationCoordinates = Object.hasOwn(target.value, 'sequenceFrameCount');
	const projectedTarget = replaceDataProperties(target.value, foundationCoordinates ? {
		sourceId: descriptor.fallback.sourceId,
		sourceInFrame: 0,
		sourceFrameCount: positiveSafeInteger(
			dataProperty(fallbackSource, 'sourceFrameCount', 'fallback source'),
			'Video clip rendered fallback source-frame count',
		),
		retimeMap: null,
		trimStartFrames: 0,
		trimEndFrames: 0,
		speedRatio: 1,
		videoEffects: Object.freeze([]),
	} : {
		sourceId: descriptor.fallback.sourceId,
		sourceStartFrame: 0,
		sourceDurationFrames: positiveSafeInteger(
			dataProperty(target.value, 'durationFrames', target.name),
			'Video clip rendered fallback target duration',
		),
		trimStartFrames: 0,
		trimEndFrames: 0,
		speedRatio: 1,
		videoEffects: Object.freeze([]),
	});
	const projectedClips = Object.freeze(clips.map((clip, index) => index === target.index ? projectedTarget : clip));
	const projected = replaceDataProperties(projectRecord, { clips: projectedClips }) as unknown as Project;
	const metadata = Object.freeze({
		schemaVersion: 1 as const,
		role: 'video-clip-render-v1' as const,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		requirementId: descriptor.requirementId,
		sourceId: descriptor.fallback.sourceId,
		targetClipId: descriptor.fallback.targetClipId,
	});
	return Object.freeze({ project: projected, metadata });
}

function assertDescriptor(descriptor: ProjectFeatureVideoClipRenderV1Descriptor): void {
	if (descriptor.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects) {
		throw new RangeError('A video clip rendered fallback requires the maintained video-effects feature.');
	}
	canonicalString(descriptor.requirementId, 'Video clip rendered fallback requirement ID');
	if (descriptor.fallback.role !== 'video-clip-render-v1' || descriptor.fallback.kind !== 'video') {
		throw new RangeError('A video clip rendered fallback descriptor has the wrong role or kind.');
	}
	canonicalString(descriptor.fallback.sourceId, 'Video clip rendered fallback source ID');
	canonicalString(descriptor.fallback.targetClipId, 'Video clip rendered fallback target clip ID');
}

function assertManifestBinding(
	project: RecordValue,
	descriptor: ProjectFeatureVideoClipRenderV1Descriptor,
): void {
	const manifest = recordValue(dataProperty(project, 'featureRequirements', 'project'), 'project.featureRequirements');
	const requirements = arrayValue(
		dataProperty(manifest, 'requirements', 'project.featureRequirements'),
		'project.featureRequirements.requirements',
	);
	const matches = requirements.filter((candidate, index) => isRecord(candidate)
		&& dataProperty(candidate, 'id', `project.featureRequirements.requirements[${String(index)}]`)
			=== descriptor.requirementId);
	if (matches.length !== 1) {
		throw new Error('The rendered fallback descriptor does not match one project manifest requirement.');
	}
	const requirement = matches[0]! as RecordValue;
	const fallback = recordValue(
		dataProperty(requirement, 'fallback', 'project feature requirement'),
		'project feature requirement fallback',
	);
	if (
		dataProperty(requirement, 'featureId', 'project feature requirement') !== descriptor.featureId
		|| dataProperty(requirement, 'disposition', 'project feature requirement') !== 'rendered-fallback'
		|| dataProperty(fallback, 'role', 'project feature requirement fallback') !== descriptor.fallback.role
		|| dataProperty(fallback, 'kind', 'project feature requirement fallback') !== descriptor.fallback.kind
		|| dataProperty(fallback, 'sourceId', 'project feature requirement fallback') !== descriptor.fallback.sourceId
		|| dataProperty(fallback, 'sha256', 'project feature requirement fallback') !== descriptor.fallback.sha256
		|| dataProperty(fallback, 'targetClipId', 'project feature requirement fallback')
			!== descriptor.fallback.targetClipId
	) throw new Error('The rendered fallback descriptor does not match the project manifest.');
}

function assertSourceGeometry(
	project: RecordValue,
	targetClip: RecordValue,
	targetSource: RecordValue,
	fallbackSource: RecordValue,
): void {
	if (dataProperty(targetSource, 'kind', 'target canonical source') !== 'video') {
		throw new RangeError('A video clip rendered fallback target source must be video.');
	}
	if (dataProperty(fallbackSource, 'kind', 'fallback source') !== 'video') {
		throw new RangeError('A video clip rendered fallback source must be video.');
	}
	if (dataProperty(fallbackSource, 'hasAudio', 'fallback source') !== false) {
		throw new RangeError('A video clip rendered fallback source must not contain audio.');
	}
	const projectRate = positiveSafeInteger(dataProperty(project, 'sampleRate', 'project'), 'Project sample rate');
	const fallbackRate = positiveSafeInteger(
		dataProperty(fallbackSource, 'sampleRate', 'fallback source'),
		'Video clip rendered fallback sample rate',
	);
	if (fallbackRate !== projectRate) {
		throw new RangeError('Video clip rendered fallback sample rate must match the project sample rate.');
	}
	const targetDuration = resolveRuntimeClipProjection(project, targetClip).durationFrames;
	const fallbackFrames = positiveSafeInteger(
		dataProperty(fallbackSource, Object.hasOwn(fallbackSource, 'sampleFrameCount')
			? 'sampleFrameCount'
			: 'frameCount', 'fallback source'),
		'Video clip rendered fallback sample-frame count',
	);
	if (fallbackFrames !== targetDuration) {
		throw new RangeError('Video clip rendered fallback sample-frame count must equal the target duration.');
	}
	for (const field of ['sampleRate', 'width', 'height'] as const) {
		const fallbackValue = positiveSafeInteger(
			dataProperty(fallbackSource, field, 'fallback source'),
			`Video clip rendered fallback ${field}`,
		);
		const targetValue = positiveSafeInteger(
			dataProperty(targetSource, field, 'target canonical source'),
			`Video clip rendered fallback target ${field}`,
		);
		if (fallbackValue !== targetValue) {
			throw new RangeError(`Video clip rendered fallback ${field} must match its canonical source.`);
		}
	}
	if (!sameFrameRate(
		dataProperty(fallbackSource, 'frameRate', 'fallback source'),
		dataProperty(targetSource, 'frameRate', 'target canonical source'),
	)) {
		throw new RangeError('Video clip rendered fallback frame rate must match its canonical source.');
	}
}

function sameFrameRate(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (!isRecord(left) || !isRecord(right)) return false;
	return dataProperty(left, 'num', 'fallback source frameRate')
		=== dataProperty(right, 'num', 'canonical source frameRate')
		&& dataProperty(left, 'den', 'fallback source frameRate')
			=== dataProperty(right, 'den', 'canonical source frameRate');
}

function exactRecordById(
	values: readonly unknown[],
	id: string,
	label: string,
): Readonly<{ value: RecordValue; index: number; name: string }> {
	const matches: Array<Readonly<{ value: RecordValue; index: number }>> = [];
	for (let index = 0; index < values.length; index += 1) {
		const candidate = values[index];
		if (isRecord(candidate) && dataProperty(candidate, 'id', `${label}[${String(index)}]`) === id) {
			matches.push({ value: candidate, index });
		}
	}
	if (matches.length !== 1) throw new ReferenceError(`A video clip rendered fallback requires exactly one ${label} ${id}.`);
	return Object.freeze({ ...matches[0]!, name: `${label} ${id}` });
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function canonicalString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${name} must be a non-empty canonical string.`);
	}
	return value;
}

function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

function isRecord(value: unknown): value is RecordValue {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown, name: string): RecordValue {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return value;
}

function dataProperty(value: RecordValue, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function replaceDataProperties(value: RecordValue, replacements: Record<string, unknown>): RecordValue {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const [key, replacement] of Object.entries(replacements)) {
		descriptors[key] = { configurable: true, enumerable: true, writable: true, value: replacement };
	}
	return Object.freeze(Object.create(Object.getPrototypeOf(value) as object | null, descriptors) as RecordValue);
}
