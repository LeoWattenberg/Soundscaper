/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The commands that change a source record itself.
 *
 * A source is the document's account of one piece of media: which bytes it is,
 * how long they are, and what a probe concluded about them. Three commands can
 * change that account, and they are separated because each may change a
 * different part of it and none may change the others:
 *
 * - `source/update` edits what a user chose to call it, and nothing measured.
 * - `source/reprobe` replaces what a re-read concluded, but never the bytes.
 * - `source/rewrite-media` replaces the bytes, but never the grid they sit on.
 *
 * The last two both carry clip ranges with them, because a document must never
 * hold new source facts with ranges measured against the old ones. That is also
 * why the `source/update` allowlist stays closed to every measured field: a
 * command that could change a frame count on its own could leave a clip
 * pointing past the end of its own media.
 */

import { assertFrame } from '../project.js';
import {
	assertClipSourceBounds,
	assertUnusedId,
	normalizeSourceForProject,
	requireProjectBin,
	requireSource,
	requireStableCommandId,
} from './shared-runtime.js';

export function addSource(project, value) {
	const source = normalizeSourceForProject(project, value);
	assertUnusedId(project.sources, source.id, 'source');
	project.sources.push(source);
}

export function removeSource(project, sourceId) {
	const inUse = [
		...project.clips,
		...(project.projectBin?.clips || []),
	].some((clip) => clip.sourceId === sourceId);
	if (inUse) throw new RangeError('A source in use cannot be removed.');
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	project.sources.splice(index, 1);
}

export function updateSource(project, sourceId, changes = {}) {
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	const allowed = new Set([
		'name', 'mimeType', 'originalSampleRate', 'sampleFormat', 'opaqueExtensions',
		'videoCodec', 'audioCodec', 'hasAudio',
	]);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Source field cannot be updated: ${key}.`);
	project.sources[index] = normalizeSourceForProject(project, { ...project.sources[index], ...changes, id: sourceId });
}

const REPROBE_FIELDS = new Set([
	'frameRate', 'sourceFrameCount', 'timingAsset', 'timingDecision',
	'characteristics', 'videoCodec', 'audioCodec', 'width', 'height',
]);
const REPROBE_IDENTITY = ['id', 'storageKey', 'contentSha256', 'sampleFrameCount', 'hasAudio'];

/**
 * Replace what a re-read of a video source concluded, together with every clip
 * range cut against the grid it replaces. The two land in one mutation because
 * a document must never hold a new frame rate with ranges measured on the old
 * one — which is also why the narrow `source/update` allowlist stays closed to
 * these fields.
 */
export function reprobeSource(project, command) {
	const source = requireSource(project, requireStableCommandId(command.sourceId, 'source'));
	if (source.kind !== 'video') throw new RangeError('Only a video source can be re-probed.');
	const changes = command.changes && typeof command.changes === 'object' && !Array.isArray(command.changes)
		? command.changes
		: {};
	for (const key of Object.keys(changes)) {
		if (!REPROBE_FIELDS.has(key)) throw new RangeError(`A re-probe cannot change: ${key}.`);
	}
	const upgraded = normalizeSourceForProject(project, { ...source, ...changes, id: source.id });
	// The bytes are the source's identity: reading them again cannot rename them,
	// re-time their audio, or point the document at different content.
	for (const key of REPROBE_IDENTITY) {
		if (upgraded[key] !== source[key]) throw new RangeError(`A re-probe cannot change ${key}.`);
	}
	const index = project.sources.findIndex((candidate) => candidate.id === source.id);
	project.sources[index] = upgraded;
	const ranges = new Map((Array.isArray(command.clips) ? command.clips : []).map((entry) => [
		requireStableCommandId(entry?.clipId, 'clip'),
		{
			sourceStartFrame: assertFrame(entry.sourceInFrame, 'clip.sourceInFrame'),
			sourceDurationFrames: assertFrame(entry.sourceFrameCount, 'clip.sourceFrameCount'),
		},
	]));
	const conform = (clip) => {
		const range = clip.sourceId === source.id ? ranges.get(clip.id) : null;
		if (!range) return clip;
		if (!range.sourceDurationFrames) throw new RangeError('A re-probed clip keeps at least one source frame.');
		return {
			...clip,
			...range,
			sourceInFrame: range.sourceStartFrame,
			sourceFrameCount: range.sourceDurationFrames,
		};
	};
	project.clips = project.clips.map(conform);
	const projectBin = requireProjectBin(project);
	projectBin.clips = projectBin.clips.map(conform);
	for (const clip of [...project.clips, ...projectBin.clips]) {
		if (clip.sourceId === source.id) assertClipSourceBounds(project, clip);
	}
}