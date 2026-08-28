/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection,
	isRuntimeProjectProjection,
	resolveRuntimeProjectProjection,
	type RuntimeProjectProjection,
} from '../common/editor/runtime-clip-projection.ts';
import { cloneVideoClipComposition } from '../common/editor/video-clip-composition.ts';
import {
	normalizeVideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	framescaperProjectFeatureRequirementsForCompositionFoundationRetime,
} from './editor-project-feature-requirements-retime.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectForCommandConsumersSequence,
	framescaperProjectForPlaybackFoundationSequence,
	type FramescaperProjectRuntimeFoundationV17,
} from './editor-project-sequence-runtime.ts';
import {
	framescaperProjectSequenceFoundationComposition,
} from './editor-project-composition-validation.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	validateFramescaperProjectRetime,
	type FramescaperProjectRetime,
} from './editor-project-retime-validation.ts';

type DataRecord = Record<string, unknown>;

/** Resolve exact retime through the inherited sequence materializer and shared V17 engine. */
export function framescaperProjectForRuntimeConsumersRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
): RuntimeProjectProjection<FramescaperProjectRuntimeFoundationV17> {
	return resolveRuntimeProjectProjection(framescaperProjectForPlaybackFoundationRetime(profile, project));
}

/** Retain and detach keyed state on every authored or materialized playback occurrence. */
export function framescaperProjectForPlaybackFoundationRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	const foundation = privateFramescaperProjectSequenceFoundationRetime(profile, project);
	const playback = framescaperProjectForPlaybackFoundationSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		foundation as never,
	);
	return detachVideoAuthoringOccurrences(playback);
}

/** Preserve retime carriers for controller services without widening the public composition wire. */
export function framescaperProjectForCommandConsumersRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	const foundation = privateFramescaperProjectSequenceFoundationRetime(profile, project);
	const commanded = framescaperProjectForCommandConsumersSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		foundation as never,
	);
	return detachVideoAuthoringOccurrences(commanded);
}

/**
 * Build an internal sequence command/playback view that retains retime carriers.
 * It is never exposed as an exact composition document and never enters composition validation.
 */
function privateFramescaperProjectSequenceFoundationRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	project: FramescaperProjectRetime | unknown,
): DataRecord {
	assertFramescaperProjectRetimeProfile(profile);
	validateFramescaperProjectRetime(profile, project);
	const canonical = project as FramescaperProjectRetime;
	const transient = structuredClone(canonical) as DataRecord;
	transient.schemaVersion =  1;
	transient.featureRequirements = framescaperProjectFeatureRequirementsForCompositionFoundationRetime(
		profile,
		canonical,
	);
	return framescaperProjectSequenceFoundationComposition(
		FRAMESCAPER_COMPOSITION_PROJECT_RUNTIME_PROFILE,
		transient,
		{ retainComposition: true },
	);
}

function detachVideoAuthoringOccurrences(
	project: FramescaperProjectRuntimeFoundationV17,
): FramescaperProjectRuntimeFoundationV17 {
	if (!Array.isArray(project.clips)) throw new TypeError('The retime runtime foundation requires clips.');
	const clips = project.clips.map((clipValue, index) => {
		const clip = dataRecord(clipValue, `retime runtime clip ${String(index)}`);
		if (dataProperty(clip, 'kind', `retime runtime clip ${String(index)}`) !== 'video') return clipValue;
		const name = `retime runtime video clip ${String(dataProperty(clip, 'id', 'retime runtime clip'))}`;
		const composition = cloneVideoClipComposition(
			dataProperty(clip, 'videoComposition', name),
			`${name}.videoComposition`,
		);
		const keyframes = normalizeVideoKeyframeCurves(
			dataProperty(clip, 'videoKeyframes', name),
			{
				duration: clipDuration(clip, name),
				composition,
				videoEffects: dataProperty(clip, 'videoEffects', name),
			},
			`${name}.videoKeyframes`,
		);
		return Object.freeze({ ...clip, videoComposition: composition, videoKeyframes: keyframes });
	});
	const detached = Object.freeze({ ...project, clips: Object.freeze(clips) });
	return (isRuntimeProjectProjection(project)
		? brandRuntimeProjectProjection(detached)
		: detached) as FramescaperProjectRuntimeFoundationV17;
}

function clipDuration(clip: DataRecord, name: string): Readonly<{ num: number; den: 1 }> {
	const value = dataProperty(clip, 'sequenceFrameCount', name);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name}.sequenceFrameCount must be a positive safe integer.`);
	}
	return Object.freeze({ num: value, den: 1 });
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
