/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTrackCommand } from '../common/editor/commands/factories.ts';
import type { FramescaperProjectV32 } from './editor-project-v32.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperImageBatchPlacementRequestV32 {
	readonly sequenceStartFrame: number;
	readonly sequenceFrameCounts: readonly number[];
	readonly createId: (prefix: string) => string;
}

export interface FramescaperImageBatchPlacementV32 {
	readonly sequenceId: string;
	readonly trackId: string;
	readonly trackCommand: Readonly<Record<string, unknown>> | null;
	readonly placements: readonly Readonly<{
		readonly sequenceStartFrame: number;
		readonly sequenceFrameCount: number;
	}>[];
}

/** Place the complete ordered batch without overwrite or ripple. */
export function createFramescaperImageBatchPlacementV32(
	projectValue: FramescaperProjectV32 | unknown,
	request: FramescaperImageBatchPlacementRequestV32,
): FramescaperImageBatchPlacementV32 {
	const project = record(projectValue, 'Framescaper V32 image placement project');
	if (project.schemaVersion !== 32 && (project as Readonly<{ schemaVersion: number }>).schemaVersion !== 31) {
		throw new TypeError('Image placement requires a V32-compatible selected project.');
	}
	const start = nonNegative(request?.sequenceStartFrame, 'image placement start');
	if (!Array.isArray(request?.sequenceFrameCounts) || request.sequenceFrameCounts.length < 1
		|| request.sequenceFrameCounts.length > 64) {
		throw new RangeError('Image placement requires a batch of 1 through 64 files.');
	}
	const counts = request.sequenceFrameCounts.map((value, index) => (
		positive(value, `image batch frame count ${String(index)}`)
	));
	const total = counts.reduce((sum, value) => safeAdd(sum, value, 'image batch range'), 0);
	const end = safeAdd(start, total, 'image batch range');
	const sequenceId = stableId(project.primarySequenceId, 'primary sequence ID');
	const sequence = records(project.sequences, 'sequences').find(({ id }) => id === sequenceId);
	if (!sequence || !Array.isArray(sequence.trackIds)) {
		throw new ReferenceError('Image placement requires the primary sequence track order.');
	}
	const sequenceTrackIds = new Set(sequence.trackIds.map(String));
	const tracks = records(project.tracks, 'tracks');
	const selection = record(project.selection, 'selection');
	const selectedTrackIds = Array.isArray(selection.trackIds) ? selection.trackIds.map(String) : [];
	const candidates = tracks.filter((track) => (
		track.type === 'video' && track.locked !== true && sequenceTrackIds.has(String(track.id))
	)).sort((left, right) => (
		Number(selectedTrackIds.includes(String(right.id))) - Number(selectedTrackIds.includes(String(left.id)))
	));
	const clips = records(project.clips, 'clips');
	const selected = candidates.find((track) => rangeIsClear(track, clips, sequenceId, start, end));
	let trackId: string;
	let trackCommand: Readonly<Record<string, unknown>> | null = null;
	if (selected) trackId = stableId(selected.id, 'image placement track ID');
	else {
		if (typeof request.createId !== 'function') throw new TypeError('Image placement requires an ID factory.');
		trackId = stableId(request.createId('image-track'), 'new image track ID');
		if (tracks.some(({ id }) => id === trackId)) throw new RangeError('The new image track ID is not unique.');
		trackCommand = Object.freeze({
			...createAddTrackCommand({ type: 'video', id: trackId, name: 'Images', laneGroupId: null }),
			index: tracks.length,
		});
	}
	let cursor = start;
	const placements = counts.map((sequenceFrameCount) => {
		const placement = Object.freeze({ sequenceStartFrame: cursor, sequenceFrameCount });
		cursor = safeAdd(cursor, sequenceFrameCount, 'image placement cursor');
		return placement;
	});
	return Object.freeze({
		sequenceId,
		trackId,
		trackCommand,
		placements: Object.freeze(placements),
	});
}

function rangeIsClear(
	track: Data,
	clips: readonly Data[],
	sequenceId: string,
	start: number,
	end: number,
): boolean {
	if (!Array.isArray(track.clipIds)) throw new TypeError('A video track must contain clip IDs.');
	const clipIds = new Set(track.clipIds.map(String));
	return !clips.some((clip) => {
		if (!clipIds.has(String(clip.id)) || clip.sequenceId !== sequenceId) return false;
		const clipStart = nonNegative(clip.sequenceStartFrame, `clip ${String(clip.id)} start`);
		const clipEnd = safeAdd(
			clipStart, positive(clip.sequenceFrameCount, `clip ${String(clip.id)} duration`),
			`clip ${String(clip.id)} range`,
		);
		return clipStart < end && start < clipEnd;
	});
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function positive(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegative(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${name} exceeds safe integers.`);
	return result;
}
