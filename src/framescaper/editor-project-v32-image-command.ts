/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v32.ts';

export type FramescaperImageClipPlacementV32 =
	| Readonly<{ readonly scope: 'timeline'; readonly trackId: string }>
	| Readonly<{ readonly scope: 'project-bin' }>;

export interface FramescaperImageSourceSetCommandV32 {
	readonly type: 'image-source/set';
	readonly sourceId: string;
	readonly expectedSource: FramescaperImageSourceV1 | null;
	readonly source: FramescaperImageSourceV1 | null;
}

export interface FramescaperImageClipSetCommandV32 {
	readonly type: 'image-clip/set';
	readonly clipId: string;
	readonly expectedClip: FramescaperImageClipV1 | null;
	readonly expectedPlacement: FramescaperImageClipPlacementV32 | null;
	readonly clip: FramescaperImageClipV1 | null;
	readonly placement: FramescaperImageClipPlacementV32 | null;
}

export type FramescaperImageCommandV32 =
	| FramescaperImageSourceSetCommandV32
	| FramescaperImageClipSetCommandV32;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function snapshotFramescaperImageCommandV32(value: unknown): FramescaperImageCommandV32 {
	const type = commandType(value);
	if (type === 'image-source/set') return sourceCommand(value);
	if (type === 'image-clip/set') return clipCommand(value);
	throw new RangeError('Framescaper V32 image command type is unsupported.');
}

export function applyFramescaperImageCommandV32(
	project: Record<string, unknown>,
	command: FramescaperImageCommandV32,
): void {
	if (command.type === 'image-source/set') applySource(project, command);
	else applyClip(project, command);
}

function sourceCommand(value: unknown): FramescaperImageSourceSetCommandV32 {
	const command = readClosedDomainRecord(value, 'Framescaper V32 image source command', [
		'type', 'sourceId', 'expectedSource', 'source',
	]);
	const sourceId = stableId(field(command, 'sourceId'), 'sourceId');
	const expectedSource = optional(field(command, 'expectedSource'), normalizeFramescaperImageSourceV1);
	const source = optional(field(command, 'source'), normalizeFramescaperImageSourceV1);
	assertMutation(expectedSource, source, 'image source');
	assertIdentity(sourceId, expectedSource, source, 'image source');
	return Object.freeze({ type: 'image-source/set', sourceId, expectedSource, source });
}

function clipCommand(value: unknown): FramescaperImageClipSetCommandV32 {
	const command = readClosedDomainRecord(value, 'Framescaper V32 image clip command', [
		'type', 'clipId', 'expectedClip', 'expectedPlacement', 'clip', 'placement',
	]);
	const clipId = stableId(field(command, 'clipId'), 'clipId');
	const expectedClip = optional(field(command, 'expectedClip'), normalizeFramescaperImageClipV1);
	const clip = optional(field(command, 'clip'), normalizeFramescaperImageClipV1);
	const expectedPlacement = optionalPlacement(field(command, 'expectedPlacement'));
	const placement = optionalPlacement(field(command, 'placement'));
	assertMutation(expectedClip, clip, 'image clip');
	assertIdentity(clipId, expectedClip, clip, 'image clip');
	if ((expectedClip === null) !== (expectedPlacement === null)
		|| (clip === null) !== (placement === null)) {
		throw new RangeError('A V32 image clip and its placement are present or absent together.');
	}
	return Object.freeze({
		type: 'image-clip/set', clipId, expectedClip, expectedPlacement, clip, placement,
	});
}

function applySource(project: Record<string, unknown>, command: FramescaperImageSourceSetCommandV32): void {
	const sources = records(project.sources, 'sources');
	const index = sources.findIndex(({ id, kind }) => id === command.sourceId && kind === 'image');
	const current = index < 0 ? null : sources[index]!;
	if (!same(current, command.expectedSource)) throw new Error('The expected V32 image source is stale.');
	if (command.source === null) sources.splice(index, 1);
	else if (index < 0) sources.push(command.source as unknown as Record<string, unknown>);
	else sources[index] = command.source as unknown as Record<string, unknown>;
	project.sources = sources;
}

function applyClip(project: Record<string, unknown>, command: FramescaperImageClipSetCommandV32): void {
	const timeline = records(project.clips, 'clips');
	const bin = record(project.projectBin, 'projectBin');
	const binClips = records(bin.clips, 'projectBin.clips');
	const tracks = records(project.tracks, 'tracks');
	const timelineIndex = timeline.findIndex(({ id, kind }) => id === command.clipId && kind === 'image');
	const binIndex = binClips.findIndex(({ id, kind }) => id === command.clipId && kind === 'image');
	const current = timelineIndex >= 0 ? timeline[timelineIndex]! : binIndex >= 0 ? binClips[binIndex]! : null;
	const owner = timelineIndex < 0 ? undefined : tracks.find((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(command.clipId)
	));
	const currentPlacement = current === null ? null : timelineIndex >= 0
		? Object.freeze({ scope: 'timeline' as const, trackId: String(owner?.id) })
		: Object.freeze({ scope: 'project-bin' as const });
	if (!same(current, command.expectedClip) || !same(currentPlacement, command.expectedPlacement)) {
		throw new Error('The expected V32 image clip or placement is stale.');
	}
	assertUnlocked(owner, 'source');
	if (timelineIndex >= 0) timeline.splice(timelineIndex, 1);
	if (binIndex >= 0) binClips.splice(binIndex, 1);
	for (const track of tracks) {
		if (Array.isArray(track.clipIds)) track.clipIds = track.clipIds.filter((id) => id !== command.clipId);
	}
	if (command.clip !== null && command.placement?.scope === 'timeline') {
		const targetTrackId = command.placement.trackId;
		const target = tracks.find(({ id }) => id === targetTrackId);
		if (!target || target.type !== 'video') throw new ReferenceError('A V32 image clip requires a video track.');
		assertUnlocked(target, 'target');
		timeline.push(command.clip as unknown as Record<string, unknown>);
		(target.clipIds as unknown[]).push(command.clipId);
	} else if (command.clip !== null) {
		binClips.push(command.clip as unknown as Record<string, unknown>);
	}
	project.clips = timeline;
	bin.clips = binClips;
	project.tracks = tracks;
}

function optionalPlacement(value: unknown): FramescaperImageClipPlacementV32 | null {
	if (value === null) return null;
	const discriminant = readClosedDomainRecord(value, 'V32 image placement', ['scope', 'trackId'], ['scope']);
	const scope = field(discriminant, 'scope');
	if (scope === 'project-bin') {
		readClosedDomainRecord(value, 'V32 image Project Bin placement', ['scope']);
		return Object.freeze({ scope });
	}
	if (scope === 'timeline') {
		const placement = readClosedDomainRecord(value, 'V32 image timeline placement', ['scope', 'trackId']);
		return Object.freeze({
			scope, trackId: stableId(field(placement, 'trackId'), 'placement.trackId'),
		});
	}
	throw new RangeError('V32 image placement scope is unsupported.');
}

function optional<T>(value: unknown, normalize: (candidate: unknown) => T): T | null {
	return value === null ? null : normalize(value);
}

function assertMutation(before: unknown, after: unknown, name: string): void {
	if (before === null && after === null) throw new RangeError(`A V32 ${name} command must mutate state.`);
}

function assertIdentity(id: string, before: unknown, after: unknown, name: string): void {
	for (const value of [before, after]) {
		if (value !== null && (value as Readonly<{ id: string }>).id !== id) {
			throw new RangeError(`A V32 ${name} command cannot change identity.`);
		}
	}
}

function commandType(value: unknown): string {
	const command = record(value, 'Framescaper V32 image command');
	const type = readClosedDomainField(command, 'type', 'Framescaper V32 image command');
	if (typeof type !== 'string') throw new TypeError('Framescaper V32 image command.type must be a string.');
	return type;
}

function field(recordValue: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(recordValue, name, 'Framescaper V32 image command');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Framescaper V32 ${name} must be a stable ID.`);
	return value;
}

function assertUnlocked(track: Record<string, unknown> | undefined, name: string): void {
	if (track?.locked === true) throw new Error(`The V32 image clip ${name} track is locked.`);
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
