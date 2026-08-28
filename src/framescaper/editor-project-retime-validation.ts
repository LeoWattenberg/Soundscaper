/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import {
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	framescaperProjectFeatureRequirementsForCompositionFoundationRetime,
	validateFramescaperProjectFeatureRequirementsRetime,
} from './editor-project-feature-requirements-retime.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { validateFramescaperProjectComposition } from './editor-project-composition-validation.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	admitFramescaperProjectRetimeStructure,
	type FramescaperProjectRetimeValidationOptions,
} from './editor-project-retime-structural-admission.ts';

export const FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION = 1 as const;

export type { FramescaperProjectRetimeValidationOptions } from './editor-project-retime-structural-admission.ts';

export interface FramescaperVideoClipRetime extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly videoKeyframes: VideoKeyframeCurves;
}

export interface FramescaperProjectRetime extends Record<string, unknown> {
	readonly schemaFamily: 'framescaper';
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaVersion: 1;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly (FramescaperVideoClipRetime | Readonly<Record<string, unknown>>)[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{
		readonly clips: readonly (FramescaperVideoClipRetime | Readonly<Record<string, unknown>>)[];
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

/** Validate exact retime keyframe ownership over an immutable exact composition foundation. */
export function validateFramescaperProjectRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: unknown,
	options: FramescaperProjectRetimeValidationOptions = {},
): project is FramescaperProjectRetime {
	assertFramescaperProjectRetimeProfile(profile);
	const limits = admitFramescaperProjectRetimeStructure(project, options);
	const candidate = dataRecord(project, 'Framescaper project');
	const schemaVersion = dataProperty(candidate, 'schemaVersion', 'Framescaper project');
	if (schemaVersion !== FRAMESCAPER_PROJECT_RETIME_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(schemaVersion)}.`);
	}
	validateClipCollections(candidate);
	validateFramescaperProjectComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		framescaperProjectCompositionFoundationRetime(profile, candidate),
		{ limits },
	);
	validateFramescaperProjectFeatureRequirementsRetime(profile, candidate);
	return true;
}

/** Build a detached transient exact-composition view without changing persisted authority. */
export function framescaperProjectCompositionFoundationRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | Record<string, unknown> | unknown,
): Record<string, unknown> {
	assertFramescaperProjectRetimeProfile(profile);
	admitFramescaperProjectRetimeStructure(project);
	const candidate = dataRecord(project, 'Framescaper retime project');
	const result = structuredClone(candidate) as Record<string, unknown>;
	result.schemaVersion =  1;
	result.featureRequirements = framescaperProjectFeatureRequirementsForCompositionFoundationRetime(
		profile,
		candidate,
	);
	result.clips = copyClipArray(
		dataProperty(result, 'clips', 'Framescaper retime project'),
		'Framescaper retime project.clips',
	);
	const projectBin = dataRecord(dataProperty(result, 'projectBin', 'Framescaper retime project'), 'projectBin');
	projectBin.clips = copyClipArray(
		dataProperty(projectBin, 'clips', 'Framescaper retime project.projectBin'),
		'Framescaper retime project.projectBin.clips',
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
