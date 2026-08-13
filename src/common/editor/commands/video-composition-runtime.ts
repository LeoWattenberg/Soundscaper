/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoClipComposition,
	videoClipCompositionsEqual,
} from '../video-clip-composition.ts';
import type { EditorCommandProject } from './protocol.ts';
import type { VideoCompositionCommandHandlers } from './video-composition.ts';

type DataRecord = Record<string, unknown>;

export function createVideoCompositionRuntimeHandlers(): VideoCompositionCommandHandlers {
	return { 'video-composition/set': setVideoComposition };
}

function setVideoComposition(
	projectValue: EditorCommandProject,
	command: Parameters<VideoCompositionCommandHandlers['video-composition/set']>[1],
): void {
	const project = dataRecord(projectValue, 'project');
	const clipId = nonEmptyString(command.clipId, 'video composition clipId');
	const matches = clipCollections(project).filter((clip) => (
		dataProperty(clip, 'id', `clip ${clipId}`) === clipId
	));
	if (matches.length === 0) throw new ReferenceError(`Video clip ${clipId} is missing.`);
	if (matches.length !== 1) throw new RangeError(`Video clip ID ${clipId} is not globally unique.`);
	const clip = matches[0]!;
	if (dataProperty(clip, 'kind', `clip ${clipId}`) !== 'video') {
		throw new TypeError(`Clip ${clipId} is not a video clip.`);
	}
	const current = dataProperty(clip, 'videoComposition', `video clip ${clipId}`);
	if (!videoClipCompositionsEqual(current, command.expectedComposition)) {
		throw new RangeError(`Video clip ${clipId} composition changed before the edit was committed.`);
	}
	clip.videoComposition = normalizeVideoClipComposition(
		command.composition,
		`video clip ${clipId} composition`,
	);
}

function clipCollections(project: DataRecord): DataRecord[] {
	const timeline = recordArray(dataProperty(project, 'clips', 'project'), 'project.clips');
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'project'), 'project.projectBin');
	return [
		...timeline,
		...recordArray(dataProperty(projectBin, 'clips', 'project.projectBin'), 'project.projectBin.clips'),
	];
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => dataRecord(item, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
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

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	return value;
}
