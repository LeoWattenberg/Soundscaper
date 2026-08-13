/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectFeatureRequirementsForV18FoundationV19,
	validateFramescaperProjectFeatureRequirementsV19,
} from './editor-project-feature-requirements-v19.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { validateFramescaperProjectV18 } from './editor-project-v18-validation.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';

export const FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION = 19 as const;

export interface FramescaperVideoClipV19 extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly videoComposition: VideoClipComposition;
}

export interface FramescaperProjectV19 extends Record<string, unknown> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaVersion: 19;
	readonly sampleRate: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly (FramescaperVideoClipV19 | Readonly<Record<string, unknown>>)[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly projectBin: Readonly<{
		readonly clips: readonly (FramescaperVideoClipV19 | Readonly<Record<string, unknown>>)[];
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

/** Validate exact V19 composition ownership over an unchanged exact V18 foundation. */
export function validateFramescaperProjectV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: unknown,
	options: Readonly<Record<string, unknown>> = {},
): project is FramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	const candidate = dataRecord(project, 'Framescaper project');
	const schemaVersion = dataProperty(candidate, 'schemaVersion', 'Framescaper project');
	if (schemaVersion !== FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported Framescaper project schema version: ${String(schemaVersion)}.`);
	}
	validateClipCollections(candidate);
	validateFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV18FoundationV19(profile, candidate, { retainComposition: false }),
		options,
	);
	validateTransitionCompositionV19(candidate);
	validateFramescaperProjectFeatureRequirementsV19(profile, candidate);
	return true;
}

function validateTransitionCompositionV19(project: Record<string, unknown>): void {
	const clips = new Map(dataRecords(
		dataProperty(project, 'clips', 'Framescaper project'), 'Framescaper project.clips',
	).map((clip) => [String(dataProperty(clip, 'id', 'Framescaper project clip')), clip]));
	for (const track of dataRecords(
		dataProperty(project, 'tracks', 'Framescaper project'), 'Framescaper project.tracks',
	)) {
		if (dataProperty(track, 'type', 'Framescaper project track') !== 'video') continue;
		const trackId = String(dataProperty(track, 'id', 'Framescaper project track'));
		const clipIds = dataProperty(track, 'clipIds', `Framescaper video track ${trackId}`);
		if (!Array.isArray(clipIds)) throw new TypeError(`Framescaper video track ${trackId}.clipIds must be an array.`);
		const ordered = clipIds.map((clipId) => clips.get(String(clipId)) as Record<string, unknown>)
			.sort((left, right) => sequenceStart(left) - sequenceStart(right));
		for (let index = 1; index < ordered.length; index += 1) {
			const outgoing = ordered[index - 1] as Record<string, unknown>;
			const incoming = ordered[index] as Record<string, unknown>;
			if (sequenceStart(incoming) >= sequenceStart(outgoing) + sequenceCount(outgoing)) continue;
			const outgoingComposition = normalizeVideoClipComposition(dataProperty(
				outgoing, 'videoComposition', `Framescaper video track ${trackId}`,
			));
			const incomingComposition = normalizeVideoClipComposition(dataProperty(
				incoming, 'videoComposition', `Framescaper video track ${trackId}`,
			));
			if (outgoingComposition.blendMode !== incomingComposition.blendMode) {
				throw new RangeError(`A transition on ${trackId} requires one blend mode across both clips.`);
			}
			if (outgoingComposition.compositingOrder !== incomingComposition.compositingOrder) {
				throw new RangeError(`A transition on ${trackId} requires one compositing order across both clips.`);
			}
		}
	}
}

function sequenceStart(clip: Record<string, unknown>): number {
	return Number(dataProperty(clip, 'sequenceStartFrame', 'Framescaper video clip'));
}

function sequenceCount(clip: Record<string, unknown>): number {
	return Number(dataProperty(clip, 'sequenceFrameCount', 'Framescaper video clip'));
}

/** Build a detached transient exact-V18 view without changing persisted authority. */
export function framescaperProjectV18FoundationV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | Record<string, unknown> | unknown,
	options: Readonly<{ retainComposition?: boolean }> = {},
): Record<string, unknown> {
	assertFramescaperProjectV19Profile(profile);
	const candidate = dataRecord(project, 'Framescaper V19 project');
	const result = copyDataRecord(candidate, 'Framescaper V19 project');
	result.schemaVersion = 18;
	result.featureRequirements = framescaperProjectFeatureRequirementsForV18FoundationV19(
		profile,
		candidate,
	);
	result.clips = copyClipArray(
		dataProperty(candidate, 'clips', 'Framescaper V19 project'),
		'Framescaper V19 project.clips',
		options.retainComposition === true,
	);
	const projectBin = copyDataRecord(
		dataRecord(dataProperty(candidate, 'projectBin', 'Framescaper V19 project'), 'projectBin'),
		'Framescaper V19 project.projectBin',
	);
	projectBin.clips = copyClipArray(
		dataProperty(projectBin, 'clips', 'Framescaper V19 project.projectBin'),
		'Framescaper V19 project.projectBin.clips',
		options.retainComposition === true,
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
		if (Object.getOwnPropertyDescriptor(clip, 'videoKeyframes')) {
			throw new TypeError(`Framescaper V19 clip ${id} must not carry V20 videoKeyframes.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(clip, 'videoComposition');
		if (kind === 'video') {
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(
					`Framescaper video clip ${id}.videoComposition must be an own enumerable data property.`,
				);
			}
			normalizeVideoClipComposition(descriptor.value);
		} else if (kind === 'audio' && descriptor) {
			throw new TypeError(`Framescaper audio clip ${id} must not carry videoComposition.`);
		}
	}
}

function copyClipArray(value: unknown, name: string, retainComposition: boolean): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		const clip = copyDataRecord(dataRecord(item, `${name}[${String(index)}]`), `${name}[${String(index)}]`);
		if (retainComposition && clip.kind === 'video') {
			clip.videoComposition = normalizeVideoClipComposition(clip.videoComposition);
		} else if (!retainComposition) delete clip.videoComposition;
		return clip;
	});
}

function copyDataRecord(value: Record<string, unknown>, name: string): Record<string, unknown> {
	const copy: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') throw new TypeError(`${name} cannot contain symbol properties.`);
		Object.defineProperty(copy, key, {
			configurable: true, enumerable: true, value: dataProperty(value, key, name), writable: true,
		});
	}
	return copy;
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

function dataRecords(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => dataRecord(entry, `${name}[${String(index)}]`));
}
