/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeProjectProjection,
	type RuntimeProjectProjection,
} from '../common/editor/runtime-clip-projection.ts';
import { cloneVideoClipComposition } from '../common/editor/video-clip-composition.ts';
import {
	normalizeVideoKeyframeCurves,
} from '../common/editor/video-keyframe-curves.ts';
import {
	framescaperProjectFeatureRequirementsForV19FoundationV20,
} from './editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';
import {
	framescaperProjectForCommandConsumersV18,
	framescaperProjectForPlaybackFoundationV18,
	type FramescaperProjectRuntimeFoundationV17,
} from './editor-project-v18-runtime.ts';
import {
	framescaperProjectV18FoundationV19,
} from './editor-project-v19-validation.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import {
	validateFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20-validation.ts';

type DataRecord = Record<string, unknown>;

/** Resolve exact V20 through the inherited V18 materializer and shared V17 engine. */
export function framescaperProjectForRuntimeConsumersV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
): RuntimeProjectProjection<FramescaperProjectRuntimeFoundationV17> {
	return resolveRuntimeProjectProjection(framescaperProjectForPlaybackFoundationV20(profile, project));
}

/** Retain and detach keyed state on every authored or materialized playback occurrence. */
export function framescaperProjectForPlaybackFoundationV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	const foundation = privateFramescaperProjectV18FoundationV20(profile, project);
	const playback = framescaperProjectForPlaybackFoundationV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation as never,
	);
	return detachVideoAuthoringOccurrences(playback);
}

/** Preserve V20 carriers for controller services without widening the public V19 wire. */
export function framescaperProjectForCommandConsumersV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	const foundation = privateFramescaperProjectV18FoundationV20(profile, project);
	const commanded = framescaperProjectForCommandConsumersV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation as never,
	);
	return detachVideoAuthoringOccurrences(commanded);
}

/**
 * Build an internal V18 command/playback view that retains V20 carriers.
 * It is never exposed as an exact V19 document and never enters V19 validation.
 */
function privateFramescaperProjectV18FoundationV20(
	profile: FramescaperProjectV20Profile | unknown,
	project: FramescaperProjectV20 | unknown,
): DataRecord {
	assertFramescaperProjectV20Profile(profile);
	validateFramescaperProjectV20(profile, project);
	const canonical = project as FramescaperProjectV20;
	const transient = structuredClone(canonical) as DataRecord;
	transient.schemaVersion = 19;
	transient.featureRequirements = framescaperProjectFeatureRequirementsForV19FoundationV20(
		profile,
		canonical,
	);
	return framescaperProjectV18FoundationV19(
		FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
		transient,
		{ retainComposition: true },
	);
}

function detachVideoAuthoringOccurrences(
	project: FramescaperProjectRuntimeFoundationV17,
): FramescaperProjectRuntimeFoundationV17 {
	if (!Array.isArray(project.clips)) throw new TypeError('The V20 runtime foundation requires clips.');
	const clips = project.clips.map((clipValue, index) => {
		const clip = dataRecord(clipValue, `V20 runtime clip ${String(index)}`);
		if (dataProperty(clip, 'kind', `V20 runtime clip ${String(index)}`) !== 'video') return clipValue;
		const name = `V20 runtime video clip ${String(dataProperty(clip, 'id', 'V20 runtime clip'))}`;
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
	return Object.freeze({ ...project, clips: Object.freeze(clips) }) as FramescaperProjectRuntimeFoundationV17;
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
