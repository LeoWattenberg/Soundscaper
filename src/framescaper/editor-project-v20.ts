/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createDefaultVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from './editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import {
	cloneFramescaperProjectV19,
	createFramescaperProjectV19,
	type FramescaperProjectV19Options,
} from './editor-project-v19.ts';
import {
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
} from './editor-project-v18.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	framescaperProjectV19FoundationV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';
import { admitFramescaperProjectV20Structure } from './editor-project-v20-structural-admission.ts';

export {
	FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION,
	framescaperProjectV19FoundationV20,
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';

export type FramescaperProjectV20Options = FramescaperProjectV19Options;

export interface LoadedFramescaperProjectV20 {
	readonly project: FramescaperProjectV20 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'proxy-attached' | 'newer-schema' | null;
}

/** Create exact V20 from the immutable exact-V19 factory. */
export function createFramescaperProjectV20(
	profile: FramescaperProjectV20Profile | unknown,
	options: FramescaperProjectV20Options = {},
): FramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	const foundation = createFramescaperProjectV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION;
	addDefaultFramescaperProjectClipKeyframesForV20Upgrade(foundation);
	normalizeFramescaperProjectClipKeyframesV20(foundation);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV20(profile, foundation);
	validateFramescaperProjectV20(profile, foundation);
	return foundation as FramescaperProjectV20;
}

/** Validate and detach an exact V20 document, including nested curve values. */
export function cloneFramescaperProjectV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
): FramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, project);
	const canonical = project as FramescaperProjectV20;
	const keyframes = snapshotFramescaperProjectClipKeyframesV20(canonical);
	const foundation = framescaperProjectV19FoundationV20(profile, canonical);
	const clone = cloneFramescaperProjectV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		foundation,
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(canonical.featureRequirements);
	restoreFramescaperProjectClipKeyframesV20(clone, keyframes);
	validateFramescaperProjectV20(profile, clone);
	return clone as FramescaperProjectV20;
}

/** Load exact V20 or preserve a descriptor-snapshotted future document opaquely. */
export function loadFramescaperProjectV20(
	profile: FramescaperProjectV20Profile | unknown,
	value: unknown,
): LoadedFramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion > FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION) {
		admitFramescaperProjectV20Structure(value);
		return {
			project: snapshotFramescaperOpaqueProject(value),
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		};
	}
	validateFramescaperProjectV20(profile, value);
	const project = cloneFramescaperProjectV20(profile, value);
	// See the V18 loader: a proxy attachment is provided state now, not a feature
	// the product has to open read-only around.
	return { project, readOnly: false, intrinsicReadOnly: false, reason: null };
}

/** Add contextual empty fields only while upgrading a fresh exact-V19 factory result. */
export function addDefaultFramescaperProjectClipKeyframesForV20Upgrade(
	project: Record<string, unknown>,
): void {
	visitClipCollections(project, (clip, name) => {
		const kind = dataProperty(clip, 'kind', name);
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (descriptor) {
			throw new TypeError(`${name}.videoKeyframes must be absent from the V19 upgrade foundation.`);
		}
		if (kind === 'video') {
			clip.videoKeyframes = createDefaultVideoKeyframeCurves(clipDuration(clip, name));
		}
	});
}

/** Strictly normalize mandatory fields on an already-exact V20 document. */
export function normalizeFramescaperProjectClipKeyframesV20(
	project: Record<string, unknown>,
): void {
	admitFramescaperProjectV20Structure(project);
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

function snapshotFramescaperProjectClipKeyframesV20(project: FramescaperProjectV20): KeyframeSnapshots {
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

function restoreFramescaperProjectClipKeyframesV20(
	project: Record<string, unknown>,
	snapshots: KeyframeSnapshots,
): void {
	const remaining = new Map(snapshots);
	visitClipCollections(project, (clip, name, scope) => {
		if (dataProperty(clip, 'kind', name) !== 'video') return;
		const key = occurrenceKey(scope, dataProperty(clip, 'id', name));
		const keyframes = remaining.get(key);
		if (!keyframes) throw new ReferenceError(`${name} has no detached V20 keyframe snapshot.`);
		clip.videoKeyframes = keyframes;
		remaining.delete(key);
	});
	if (remaining.size > 0) throw new ReferenceError('The V19 clone dropped a V20 video occurrence.');
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
