/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createDefaultVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectComposition,
	createFramescaperProjectComposition,
	type FramescaperProjectCompositionOptions,
} from './editor-project-composition.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION,
	framescaperProjectCompositionFoundationRetime,
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';
import { admitFramescaperProjectRetimeStructure } from './editor-project-retime-structural-admission.ts';

export {
	FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION,
	framescaperProjectCompositionFoundationRetime,
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';

export type FramescaperProjectRetimeOptions = FramescaperProjectCompositionOptions;

/** Create exact retime from the immutable exact-composition factory. */
export function createFramescaperProjectRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	options: FramescaperProjectRetimeOptions = {},
): FramescaperProjectRetime {
	assertFramescaperProjectRetimeProfile(profile);
	const foundation = createFramescaperProjectComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION;
	addDefaultFramescaperProjectClipKeyframesForRetimeUpgrade(foundation);
	normalizeFramescaperProjectClipKeyframesRetime(foundation);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsRetime(profile, foundation);
	validateFramescaperProjectRetime(profile, foundation);
	return foundation as FramescaperProjectRetime;
}

/** Validate and detach an exact retime document, including nested curve values. */
export function cloneFramescaperProjectRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
): FramescaperProjectRetime {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectRetime(profile, project);
	const canonical = project as FramescaperProjectRetime;
	const keyframes = snapshotFramescaperProjectClipKeyframesRetime(canonical);
	const foundation = framescaperProjectCompositionFoundationRetime(profile, canonical);
	const clone = cloneFramescaperProjectComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		foundation,
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(canonical.featureRequirements);
	restoreFramescaperProjectClipKeyframesRetime(clone, keyframes);
	validateFramescaperProjectRetime(profile, clone);
	return clone as FramescaperProjectRetime;
}

/** Add contextual empty fields only while upgrading a fresh exact-composition factory result. */
export function addDefaultFramescaperProjectClipKeyframesForRetimeUpgrade(
	project: Record<string, unknown>,
): void {
	visitClipCollections(project, (clip, name) => {
		const kind = dataProperty(clip, 'kind', name);
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (descriptor) {
			throw new TypeError(`${name}.videoKeyframes must be absent from the composition upgrade foundation.`);
		}
		if (kind === 'video') {
			clip.videoKeyframes = createDefaultVideoKeyframeCurves(clipDuration(clip, name));
		}
	});
}

/** Strictly normalize mandatory fields on an already-exact retime document. */
export function normalizeFramescaperProjectClipKeyframesRetime(
	project: Record<string, unknown>,
): void {
	admitFramescaperProjectRetimeStructure(project);
	const replacements: Array<Readonly<{
		clip: Record<string, unknown>;
		keyframes: VideoKeyframeCurves;
	}>> = [];
	visitClipCollections(project, (clip, name) => {
		const kind = dataProperty(clip, 'kind', name);
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (kind === 'video') {
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`${name}.videoKeyframes must be an own enumerable data property.`);
			}
			replacements.push({ clip, keyframes: normalizeVideoKeyframeCurves(
				descriptor.value, normalizationOptions(clip, name), `${name}.videoKeyframes`,
			) });
		} else if (kind === 'audio' && descriptor) {
			throw new TypeError(`${name} must not carry videoKeyframes.`);
		}
	});
	for (const { clip, keyframes } of replacements) clip.videoKeyframes = keyframes;
}

type ClipScope = 'timeline' | 'project-bin';
type KeyframeSnapshots = ReadonlyMap<string, VideoKeyframeCurves>;

function snapshotFramescaperProjectClipKeyframesRetime(project: FramescaperProjectRetime): KeyframeSnapshots {
	const snapshots = new Map<string, VideoKeyframeCurves>();
	visitClipCollections(project as unknown as Record<string, unknown>, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const key = occurrenceKey(scope, dataProperty(clip, 'id', name));
		if (snapshots.has(key)) throw new RangeError(`${name} has a duplicate occurrence identity.`);
		snapshots.set(key, normalizeVideoKeyframeCurves(
			dataProperty(clip, 'videoKeyframes', name),
			normalizationOptions(clip, name),
			`${name}.videoKeyframes`,
		));
	});
	return snapshots;
}

function restoreFramescaperProjectClipKeyframesRetime(
	project: Record<string, unknown>,
	snapshots: KeyframeSnapshots,
): void {
	const remaining = new Map(snapshots);
	visitClipCollections(project, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const key = occurrenceKey(scope, dataProperty(clip, 'id', name));
		const keyframes = remaining.get(key);
		if (!keyframes) throw new ReferenceError(`${name} has no detached retime keyframe snapshot.`);
		clip.videoKeyframes = keyframes;
		remaining.delete(key);
	});
	if (remaining.size > 0) throw new ReferenceError('The composition clone dropped a retime video occurrence.');
}

function visitClipCollections(
	project: Record<string, unknown>,
	visit: (clip: Record<string, unknown>, name: string, scope: ClipScope) => void,
): void {
	visitClipArray(dataProperty(project, 'clips', 'Framescaper project'), 'Framescaper project.clips', 'timeline', visit);
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper project'), 'Framescaper project.projectBin');
	visitClipArray(dataProperty(projectBin, 'clips', 'Framescaper project.projectBin'), 'Framescaper project.projectBin.clips', 'project-bin', visit);
}

function visitClipArray(
	value: unknown,
	name: string,
	scope: ClipScope,
	visit: (clip: Record<string, unknown>, name: string, scope: ClipScope) => void,
): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (let index = 0; index < value.length; index += 1) {
		const item = arrayDataProperty(value, index, name);
		visit(dataRecord(item, `${name}[${String(index)}]`), `${name}[${String(index)}]`, scope);
	}
}

function normalizationOptions(clip: Record<string, unknown>, name: string): Readonly<Record<string, unknown>> {
	return {
		duration: clipDuration(clip, name),
		composition: dataProperty(clip, 'videoComposition', name),
		videoEffects: dataProperty(clip, 'videoEffects', name),
	};
}

function clipDuration(clip: Record<string, unknown>, name: string): Readonly<{ num: number; den: 1 }> {
	const value = dataProperty(clip, 'sequenceFrameCount', name);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name}.sequenceFrameCount must be a positive safe integer.`);
	}
	return { num: value, den: 1 };
}

function occurrenceKey(scope: ClipScope, id: unknown): string {
	return JSON.stringify([scope, String(id)]);
}

function arrayDataProperty(value: unknown[], index: number, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
