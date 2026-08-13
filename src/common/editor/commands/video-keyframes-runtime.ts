/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoKeyframeCurves,
	videoKeyframeCurvesEqual,
} from '../video-keyframe-curves.ts';
import {
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	admitAudioEditorProjectV9ValidationStructure,
} from '../project-v9-validation-budget.ts';
import type { EditorCommandProject } from './protocol.ts';
import {
	defineVideoKeyframesCommandHandlers,
	snapshotVideoKeyframesSetCommand,
	type VideoKeyframesCommandHandlers,
} from './video-keyframes.ts';

type DataRecord = Record<string, unknown>;
const MAXIMUM_CLIP_COLLECTION_LENGTH = 100_000;

export function createVideoKeyframesRuntimeHandlers(): Readonly<VideoKeyframesCommandHandlers> {
	return defineVideoKeyframesCommandHandlers({
		'video-keyframes/set': setVideoKeyframes,
	});
}

function setVideoKeyframes(
	projectValue: EditorCommandProject,
	commandValue: Parameters<VideoKeyframesCommandHandlers['video-keyframes/set']>[1],
): void {
	const command = snapshotVideoKeyframesSetCommand(commandValue);
	const clip = uniqueClip(dataRecord(projectValue, 'project'), command.clipId);
	if (dataProperty(clip, 'kind', `clip ${command.clipId}`) !== 'video') {
		throw new TypeError(`Clip ${command.clipId} is not a video clip.`);
	}
	const context = normalizationContext(clip, command.clipId);
	const current = normalizeVideoKeyframeCurves(
		dataProperty(clip, 'videoKeyframes', `video clip ${command.clipId}`),
		context,
		`video clip ${command.clipId}.videoKeyframes`,
	);
	if (!videoKeyframeCurvesEqual(current, command.expectedKeyframes, context)) {
		throw new RangeError(`Video clip ${command.clipId} keyframes changed before the edit was committed.`);
	}
	clip.videoKeyframes = normalizeVideoKeyframeCurves(
		command.keyframes,
		context,
		`video clip ${command.clipId}.nextVideoKeyframes`,
	);
}

function normalizationContext(clip: DataRecord, clipId: string): Readonly<Record<string, unknown>> {
	const name = `video clip ${clipId}`;
	const sequenceFrameCount = dataProperty(clip, 'sequenceFrameCount', name);
	if (!Number.isSafeInteger(sequenceFrameCount) || Number(sequenceFrameCount) <= 0) {
		throw new RangeError(`${name}.sequenceFrameCount must be a positive safe integer.`);
	}
	const composition = dataProperty(clip, 'videoComposition', name);
	const videoEffects = dataProperty(clip, 'videoEffects', name);
	admitAudioEditorProjectV9ValidationStructure(
		composition,
		AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	);
	admitAudioEditorProjectV9ValidationStructure(
		videoEffects,
		AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	);
	return Object.freeze({
		duration: Object.freeze({ num: Number(sequenceFrameCount), den: 1 }),
		composition,
		videoEffects,
	});
}

function uniqueClip(project: DataRecord, clipId: string): DataRecord {
	const timeline = dataArray(dataProperty(project, 'clips', 'project'), 'project.clips');
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'project'), 'project.projectBin');
	const bin = dataArray(
		dataProperty(projectBin, 'clips', 'project.projectBin'),
		'project.projectBin.clips',
	);
	const matches = [...timeline, ...bin].filter((clip) => (
		dataProperty(clip, 'id', `clip candidate for ${clipId}`) === clipId
	));
	if (matches.length === 0) throw new ReferenceError(`Video clip ${clipId} is missing.`);
	if (matches.length !== 1) throw new RangeError(`Video clip ID ${clipId} is not globally unique.`);
	return matches[0]!;
}

function dataArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be an ordinary array.`);
	}
	if (value.length > MAXIMUM_CLIP_COLLECTION_LENGTH) {
		throw new RangeError(`${name} exceeds its clip limit.`);
	}
	const result: DataRecord[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		result.push(dataRecord(descriptor.value, `${name}[${String(index)}]`));
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)
			|| Number(key) >= value.length) {
			throw new TypeError(`${name} contains an unsupported field.`);
		}
	}
	return result;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
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
