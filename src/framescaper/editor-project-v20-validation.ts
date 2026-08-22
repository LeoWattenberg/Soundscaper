/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import { FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import {
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	framescaperProjectFeatureRequirementsForV19FoundationV20,
	validateFramescaperProjectFeatureRequirementsV20,
} from './editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import { validateFramescaperProjectV19 } from './editor-project-v19-validation.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	admitFramescaperProjectV20Structure,
	type FramescaperProjectV20ValidationOptions,
} from './editor-project-v20-structural-admission.ts';

export { FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';

export type { FramescaperProjectV20ValidationOptions } from './editor-project-v20-structural-admission.ts';

export interface FramescaperVideoClipV20 extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly videoKeyframes: VideoKeyframeCurves;
}

export interface FramescaperProjectV20 extends Record<string, unknown> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaVersion: 20;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly (FramescaperVideoClipV20 | Readonly<Record<string, unknown>>)[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{
		readonly clips: readonly (FramescaperVideoClipV20 | Readonly<Record<string, unknown>>)[];
	}>;
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly id: string;
		readonly rate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly trackIds: readonly string[];
	})[];
	readonly primarySequenceId: string;
	readonly subsequences: readonly Readonly<Record<string, unknown>>[];
	readonly multicameraGroups: readonly Readonly<Record<string, unknown>>[];
}

/** Validate exact V20 keyframe ownership over an immutable exact V19 foundation. */
export function validateFramescaperProjectV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: unknown,
	options: FramescaperProjectV20ValidationOptions = {},
): project is FramescaperProjectV20 {
	assertFramescaperProjectV20Profile(profile);
	const limits = admitFramescaperProjectV20Structure(project, options);
	const candidate = dataRecord(project, 'Framescaper project');
	const schemaVersion = dataProperty(candidate, 'schemaVersion', 'Framescaper project');
	if (schemaVersion !== FRAMESCAPER_PROJECT_V20_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(schemaVersion)}.`);
	}
	validateClipCollections(candidate);
	validateFramescaperProjectV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV19FoundationV20(profile, candidate),
		{ limits },
	);
	validateFramescaperProjectFeatureRequirementsV20(profile, candidate);
	return true;
}

/** Build a detached transient exact-V19 view without changing persisted authority. */
export function framescaperProjectV19FoundationV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | Record<string, unknown> | unknown,
): Record<string, unknown> {
	assertFramescaperProjectV20Profile(profile);
	admitFramescaperProjectV20Structure(project);
	const candidate = dataRecord(project, 'Framescaper V20 project');
	const result = structuredClone(candidate) as Record<string, unknown>;
	result.schemaVersion = 19;
	result.featureRequirements = framescaperProjectFeatureRequirementsForV19FoundationV20(
		profile,
		candidate,
	);
	result.clips = copyClipArray(
		dataProperty(result, 'clips', 'Framescaper V20 project'),
		'Framescaper V20 project.clips',
	);
	const projectBin = dataRecord(dataProperty(result, 'projectBin', 'Framescaper V20 project'), 'projectBin');
	projectBin.clips = copyClipArray(
		dataProperty(projectBin, 'clips', 'Framescaper V20 project.projectBin'),
		'Framescaper V20 project.projectBin.clips',
	);
	result.projectBin = projectBin;
	return result;
}

function validateClipCollections(project: Record<string, unknown>): void {
	validateClipArray(dataProperty(project, 'clips', 'Framescaper project'), 'Framescaper project.clips');
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'Framescaper project'), 'projectBin');
	validateClipArray(
		dataProperty(projectBin, 'clips', 'Framescaper project.projectBin'),
		'Framescaper project.projectBin.clips',
	);
}

function validateClipArray(value: unknown, name: string): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (const [index, item] of value.entries()) {
		const clip = dataRecord(item, `${name}[${String(index)}]`);
		const kind = dataProperty(clip, 'kind', `${name}[${String(index)}]`);
		const id = String(dataProperty(clip, 'id', `${name}[${String(index)}]`));
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoKeyframes');
		if (kind === 'video') {
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(
					`Framescaper video clip ${id}.videoKeyframes must be an own enumerable data property.`,
				);
			}
			const keyframeName = `Framescaper video clip ${id}.videoKeyframes`;
			normalizeVideoKeyframeCurves(descriptor.value, normalizationOptions(clip, id), keyframeName);
			assertCanonicalCurveTargetOrder(descriptor.value, keyframeName);
		} else if (kind === 'audio' && descriptor) {
			throw new TypeError(`Framescaper audio clip ${id} must not carry videoKeyframes.`);
		}
	}
}

function copyClipArray(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		const clip = dataRecord(item, `${name}[${String(index)}]`);
		delete clip.videoKeyframes;
		return clip;
	});
}

function normalizationOptions(clip: Record<string, unknown>, id: string): Readonly<Record<string, unknown>> {
	const name = `Framescaper video clip ${id}`;
	return {
		duration: { num: dataProperty(clip, 'sequenceFrameCount', name), den: 1 },
		composition: dataProperty(clip, 'videoComposition', name),
		videoEffects: dataProperty(clip, 'videoEffects', name),
	};
}

function assertCanonicalCurveTargetOrder(value: unknown, name: string): void {
	const collection = dataRecord(value, name);
	const curves = dataProperty(collection, 'curves', name);
	if (!Array.isArray(curves)) throw new TypeError(`${name}.curves must be an array.`);
	let previous: string | null = null;
	for (const [index, value] of curves.entries()) {
		const entryName = `${name}.curves[${String(index)}]`;
		const entry = dataRecord(value, entryName);
		const target = dataRecord(dataProperty(entry, 'target', entryName), `${entryName}.target`);
		const kind = String(dataProperty(target, 'kind', `${entryName}.target`));
		const parameterId = String(dataProperty(target, 'parameterId', `${entryName}.target`));
		const key = kind === 'composition'
			? JSON.stringify([kind, parameterId])
			: JSON.stringify([kind, String(dataProperty(target, 'effectId', `${entryName}.target`)), parameterId]);
		if (previous !== null && key <= previous) {
			throw new RangeError(`${name}.curves must use canonical target order.`);
		}
		previous = key;
	}
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
