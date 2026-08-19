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
/**
 * What the trim rewriter is allowed to replace: the bytes, and how long they
 * are. `frameCount` and `sampleFrameCount` are the same quantity under two
 * names — the V10 normalizer derives one from the other — so both are accepted
 * and checked together.
 */
const REWRITE_FIELDS = new Set([
	'storageKey', 'contentSha256', 'byteLength', 'mimeType',
	'frameCount', 'sampleFrameCount', 'sourceFrameCount',
]);

/**
 * The facts every frame index in the document is measured against. A trim is a
 * lossless cut: it removes whole frames and moves nothing else, so if any of
 * these moved, remapping ranges by arithmetic would be a lie.
 */
const REWRITE_GRID = ['id', 'kind', 'sampleRate', 'channelCount', 'width', 'height', 'frameRate'];

/**
 * Point a source at rewritten media, moving every range measured against it.
 *
 * This is what makes trimming a source an edit rather than a filesystem
 * operation. The trimmed copy is new bytes with new frame indexing, so a
 * command that replaced the media alone would leave every clip reading from
 * the wrong place — and the document would still be valid, so nothing
 * downstream would notice. The two land together, and every clip that
 * references the source must be named: an unremapped reference is refused
 * rather than silently reinterpreted.
 *
 * A clip's duration is not in the payload at all. A trim retains every frame
 * the project referenced, so what a clip plays cannot change; only where it
 * reads from does.
 */
export function rewriteSourceMedia(project, command) {
	const source = requireSource(project, requireStableCommandId(command.sourceId, 'source'));
	const changes = command.changes && typeof command.changes === 'object' && !Array.isArray(command.changes)
		? command.changes
		: {};
	for (const key of Object.keys(changes)) {
		if (!REWRITE_FIELDS.has(key)) throw new RangeError(`A media rewrite cannot change: ${key}.`);
	}
	assertLengthNamedAsThisSourceMeasuresIt(source, changes);
	const rewritten = normalizeSourceForProject(project, { ...source, ...changes, id: source.id });
	for (const key of REWRITE_GRID) {
		if (!sameGridFact(rewritten[key], source[key])) {
			throw new RangeError(`A media rewrite cannot change ${key}.`);
		}
	}
	// Growing the media is not a trim; it is different content wearing the same
	// source id, and no range in the document could be checked against it.
	for (const key of ['frameCount', 'sampleFrameCount', 'sourceFrameCount']) {
		if (typeof source[key] === 'number' && rewritten[key] > source[key]) {
			throw new RangeError(`A media rewrite may only make the media shorter: ${key} grew.`);
		}
	}

	const projectBin = requireProjectBin(project);
	const moves = new Map((Array.isArray(command.clips) ? command.clips : []).map((entry) => [
		requireStableCommandId(entry?.clipId, 'clip'),
		{
			sourceStartFrame: assertFrame(entry.sourceStartFrame, 'clip.sourceStartFrame'),
			...(entry.sourceInFrame === undefined
				? {}
				: { sourceInFrame: assertFrame(entry.sourceInFrame, 'clip.sourceInFrame') }),
		},
	]));
	const referencing = [...project.clips, ...projectBin.clips].filter((clip) => clip.sourceId === source.id);
	for (const clip of referencing) {
		if (!moves.has(clip.id)) {
			throw new RangeError(`A media rewrite must remap every reference; ${clip.id} was left behind.`);
		}
	}
	const referencingIds = new Set(referencing.map((clip) => clip.id));
	for (const clipId of moves.keys()) {
		if (!referencingIds.has(clipId)) {
			throw new RangeError(`A media rewrite cannot move ${clipId}, which does not reference this source.`);
		}
	}

	const index = project.sources.findIndex((candidate) => candidate.id === source.id);
	project.sources[index] = rewritten;
	const conform = (clip) => {
		const move = clip.sourceId === source.id ? moves.get(clip.id) : null;
		return move ? { ...clip, ...move } : clip;
	};
	project.clips = project.clips.map(conform);
	projectBin.clips = projectBin.clips.map(conform);
	for (const clip of [...project.clips, ...projectBin.clips]) {
		if (clip.sourceId === source.id) assertClipSourceBounds(project, clip);
	}
}

/**
 * A source states its length under the names its own kind measures it in.
 *
 * A video source is measured twice — in sample frames and in video frames — and
 * the two must move together, because the document holds ranges in both. It is
 * also normalized from `sampleFrameCount` in preference to `frameCount`, so a
 * rewrite that named `frameCount` would be accepted and then quietly discarded,
 * leaving the source at its old length with new bytes behind it. Both are
 * refused by name rather than allowed to fail silently.
 */
function assertLengthNamedAsThisSourceMeasuresIt(source, changes) {
	const named = (key) => Object.hasOwn(changes, key);
	if (source.kind !== 'video') {
		for (const key of ['sampleFrameCount', 'sourceFrameCount']) {
			if (named(key)) throw new RangeError(`A media rewrite cannot change ${key} on a ${source.kind} source.`);
		}
		return;
	}
	if (named('frameCount')) {
		throw new RangeError('A video media rewrite states its length as sampleFrameCount, not frameCount.');
	}
	if (named('sampleFrameCount') !== named('sourceFrameCount')) {
		throw new RangeError('A video media rewrite must state both the sample-frame and the video-frame count.');
	}
}

/** Frame rates are rational objects; everything else compares by value. */
function sameGridFact(left, right) {
	if (left === right) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	return left.num === right.num && left.den === right.den;
}
