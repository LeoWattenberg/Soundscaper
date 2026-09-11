/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorClipboardTrack } from '../../commands/protocol.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export type PasteMonoConversionDisposition = 'preserve' | 'confirm' | 'convert';

export interface PasteMonoConversionTarget {
	readonly sourceTrackId: string;
	readonly targetTrackId: string;
	readonly stereoSourceIds: readonly string[];
}

export interface PasteMonoConversionPlan {
	readonly disposition: PasteMonoConversionDisposition;
	readonly targets: readonly PasteMonoConversionTarget[];
}

export interface PasteMonoConversionRequest {
	readonly clipboard: AudioEditorClipboard;
	readonly project: unknown;
	readonly transferredSources?: readonly unknown[];
	readonly trackMap?: Readonly<Record<string, string>>;
	readonly alwaysConvertToMono: boolean;
}

/**
 * Identify Audacity's conversion boundary before a paste mutates anything.
 *
 * A copied stereo track needs conversion only when it maps to a non-empty
 * mono track. An empty destination adopts the clipboard layout, while mono to
 * stereo and like-for-like transfers preserve the source. Soundscaper tracks
 * derive their width from the sources of their clips, so the plan records the
 * exact stereo roots an asynchronous paste owner must persist as mono.
 */
export function planPasteMonoConversion(
	request: PasteMonoConversionRequest,
): Readonly<PasteMonoConversionPlan> {
	if (typeof request.alwaysConvertToMono !== 'boolean') {
		throw new TypeError('alwaysConvertToMono must be boolean.');
	}
	const project = record(request.project, 'paste project');
	const sources = sourceChannelCounts([
		...array(project.sources, 'paste project.sources'),
		...(request.transferredSources ?? []),
	]);
	const clips = recordsById(array(project.clips, 'paste project.clips'), 'paste clip');
	const tracks = recordsById(array(project.tracks, 'paste project.tracks'), 'paste track');
	const targets: PasteMonoConversionTarget[] = [];
	for (const clipboardTrack of request.clipboard.tracks) {
		if (clipboardTrackType(clipboardTrack) !== 'audio') continue;
		const targetTrackId = request.trackMap?.[clipboardTrack.sourceTrackId]
			?? clipboardTrack.sourceTrackId;
		const targetTrack = tracks.get(targetTrackId);
		// A synthesized target is absent from the pre-paste project and therefore empty.
		if (!targetTrack || targetTrack.type !== 'audio') continue;
		const targetClipIds = stringArray(targetTrack.clipIds, `paste track ${targetTrackId}.clipIds`);
		if (!targetClipIds.length || trackChannelCount(targetClipIds, clips, sources) !== 1) continue;
		const sourceIds = clipboardTrack.clips.map((clip, index) => (
			nonEmptyString(clip.sourceId, `clipboard track ${clipboardTrack.sourceTrackId} clip ${String(index)}.sourceId`)
		));
		const sourceWidth = maximumChannelCount(sourceIds, sources);
		if (sourceWidth !== 2) continue;
		const stereoSourceIds = [...new Set(sourceIds.filter((sourceId) => sources.get(sourceId) === 2))];
		targets.push(Object.freeze({
			sourceTrackId: clipboardTrack.sourceTrackId,
			targetTrackId,
			stereoSourceIds: Object.freeze(stereoSourceIds),
		}));
	}
	return Object.freeze({
		disposition: targets.length ? (request.alwaysConvertToMono ? 'convert' : 'confirm') : 'preserve',
		targets: Object.freeze(targets),
	});
}

/** Audacity's stereo-to-mono transfer is the samplewise arithmetic mean. */
export function downmixStereoPasteSource(
	channels: readonly Float32Array[],
): Float32Array {
	if (!Array.isArray(channels) || channels.length !== 2) {
		throw new TypeError('A stereo paste source must contain exactly two channels.');
	}
	const [left, right] = channels;
	if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) {
		throw new TypeError('Stereo paste channels must be Float32Array values.');
	}
	if (left.length !== right.length) {
		throw new RangeError('Stereo paste channels must have equal length.');
	}
	const mono = new Float32Array(left.length);
	for (let frame = 0; frame < mono.length; frame += 1) {
		mono[frame] = ((left[frame] ?? 0) + (right[frame] ?? 0)) * 0.5;
	}
	return mono;
}

function trackChannelCount(
	clipIds: readonly string[],
	clips: ReadonlyMap<string, DataRecord>,
	sources: ReadonlyMap<string, number>,
): number {
	return maximumChannelCount(clipIds.map((clipId) => {
		const clip = clips.get(clipId);
		if (!clip) throw new ReferenceError(`Paste track references missing clip ${clipId}.`);
		return nonEmptyString(clip.sourceId, `paste clip ${clipId}.sourceId`);
	}), sources);
}

function maximumChannelCount(
	sourceIds: readonly string[],
	sources: ReadonlyMap<string, number>,
): number {
	let result = 0;
	for (const sourceId of sourceIds) {
		const channelCount = sources.get(sourceId);
		if (channelCount === undefined) {
			throw new ReferenceError(`Paste source ${sourceId} has no channel metadata.`);
		}
		result = Math.max(result, channelCount);
	}
	return result;
}

function sourceChannelCounts(values: readonly unknown[]): ReadonlyMap<string, number> {
	const result = new Map<string, number>();
	for (const [index, value] of values.entries()) {
		const source = record(value, `paste source ${String(index)}`);
		const id = nonEmptyString(source.id, `paste source ${String(index)}.id`);
		const channelCount = Number(source.channelCount);
		if (!Number.isSafeInteger(channelCount) || channelCount < 0 || channelCount > 32) {
			throw new RangeError(`Paste source ${id}.channelCount must be an integer from 0 through 32.`);
		}
		result.set(id, channelCount);
	}
	return result;
}

function recordsById(values: readonly unknown[], label: string): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	for (const [index, value] of values.entries()) {
		const entry = record(value, `${label} ${String(index)}`);
		result.set(nonEmptyString(entry.id, `${label} ${String(index)}.id`), entry);
	}
	return result;
}

function clipboardTrackType(track: AudioEditorClipboardTrack): 'audio' | 'video' {
	if (track.sourceTrackType === 'video') return 'video';
	if (track.sourceTrackType === 'audio') return 'audio';
	return track.clips[0]?.kind === 'video' ? 'video' : 'audio';
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
		throw new TypeError(`${label} must contain IDs.`);
	}
	return value;
}

function record(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value as DataRecord;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a non-empty string.`);
	return value;
}
