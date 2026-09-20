/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddTrackCommand } from '../common/editor/commands/factories.ts';
import { createStableId } from '../common/editor/stable-id.js';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';

type Data = Record<string, unknown>;
type ReadonlyData = Readonly<Record<string, unknown>>;

export const FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES = Object.freeze([
	'video-title', 'video-text', 'video-shape', 'video-solid',
] as const);

export type FramescaperSelectedGeneratorAuthoringSurface =
	(typeof FRAMESCAPER_SELECTED_GENERATOR_AUTHORING_SURFACES)[number];

export interface FramescaperSelectedPreparedAuthoringFinishing {
	readonly command: unknown;
}

/** Lazily prepare one of the directly invoked generator commands. */
export async function prepareFramescaperSelectedAuthoringFinishing(
	surface: FramescaperSelectedGeneratorAuthoringSurface,
	projectValue: unknown,
): Promise<Readonly<FramescaperSelectedPreparedAuthoringFinishing>> {
	assertFramescaperProjectIdentity(projectValue);
	const project = record(projectValue, 'Framescaper finishing project');
	return Object.freeze({ command: generatorCommand(project, surface) });
}

function generatorCommand(
	project: ReadonlyData,
	surface: FramescaperSelectedGeneratorAuthoringSurface,
): unknown {
	const placement = placementPlan(project);
	const sourceId = createStableId('visual-source');
	const clipId = createStableId('visual-clip');
	const generator = surface === 'video-title' ? {
		kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 96,
		color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
	} : surface === 'video-text' ? {
		kind: 'text', text: 'Text', fontFamily: 'soundscaper-sans', fontSize: 64,
		color: '#ffffffff', horizontalAlign: 'start', verticalAlign: 'middle',
	} : surface === 'video-shape' ? {
		kind: 'shape', shape: 'rectangle', fillColor: '#ffffffff',
		strokeColor: null, strokeWidth: 0,
	} : { kind: 'solid', color: '#000000ff' };
	const source = {
		schemaVersion: 1, kind: 'generator', id: sourceId,
		name: surfaceName(surface), width: 1_920, height: 1_080,
		frameRate: placement.rate, frameCount: placement.duration, generator,
	};
	const clip = {
		schemaVersion: 1, kind: 'generator', id: clipId, sourceId,
		sequenceId: placement.sequenceId, sequenceStartFrame: placement.start,
		sequenceFrameCount: placement.duration, sourceInFrame: 0,
		sourceFrameCount: placement.duration,
	};
	return batch([
		...placement.trackCommands,
		{ type: 'video-visual-source/set', sourceId, expectedSource: null, source },
		{ type: 'video-visual-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip, placement: { scope: 'timeline', trackId: placement.trackId } },
	]);
}

function placementPlan(project: ReadonlyData) {
	const sequenceId = typeof project.primarySequenceId === 'string'
		? project.primarySequenceId : String(records(project.sequences, 'sequences')[0]?.id ?? 'main-sequence');
	const sequence = records(project.sequences, 'sequences').find(({ id }) => id === sequenceId);
	if (!sequence) throw new Error('Framescaper visual authoring requires a primary sequence.');
	const tracks = records(project.tracks, 'tracks');
	const selectedTrackIds = recordsOrEmpty(project.selection).trackIds;
	const selectedId = Array.isArray(selectedTrackIds) ? selectedTrackIds.find((id) => (
		tracks.some((track) => track.id === id && track.type === 'video' && track.locked !== true)
	)) : undefined;
	const existing = tracks.find((track) => track.id === selectedId)
		?? tracks.find((track) => track.type === 'video' && track.locked !== true);
	const trackId = existing ? String(existing.id) : createStableId('video-track');
	const trackCommands = existing ? [] : [{
		...createAddTrackCommand({ type: 'video', id: trackId, name: 'Visuals', laneGroupId: null }),
		index: tracks.length,
	}];
	const clipIds = existing && Array.isArray(existing.clipIds)
		? new Set(existing.clipIds.map(String)) : new Set<string>();
	let start = 0;
	for (const clip of records(project.clips, 'clips')) {
		if (!clipIds.has(String(clip.id)) || clip.sequenceId !== sequenceId) continue;
		start = Math.max(start, positiveRangeEnd(clip));
	}
	const frameRate = rate(sequence);
	const duration = Math.max(1, Math.round(frameRate.num * 5 / frameRate.den));
	return Object.freeze({ sequenceId, trackId, trackCommands, start, duration, rate: frameRate });
}

function batch(commands: readonly unknown[]): unknown {
	return { type: 'batch', commands };
}

function positiveRangeEnd(clip: ReadonlyData): number {
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'clip sequence start');
	const duration = positiveInteger(clip.sequenceFrameCount, 'clip sequence duration');
	const end = start + duration;
	if (!Number.isSafeInteger(end)) throw new RangeError('The visual clip range exceeds safe integers.');
	return end;
}

function rate(sequence: ReadonlyData): Readonly<{ num: number; den: number }> {
	const value = record(sequence.rate, 'sequence rate');
	return Object.freeze({
		num: positiveInteger(value.num, 'sequence rate numerator'),
		den: positiveInteger(value.den, 'sequence rate denominator'),
	});
}

function surfaceName(surface: FramescaperSelectedGeneratorAuthoringSurface): string {
	if (surface === 'video-title') return 'Title';
	if (surface === 'video-text') return 'Text';
	if (surface === 'video-shape') return 'Shape';
	return 'Solid';
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function recordsOrEmpty(value: unknown): Data {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Data;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}
