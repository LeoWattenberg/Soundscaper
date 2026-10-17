/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperImageClipV1 } from '../../common/editor/timeline-image-model.ts';
import type { FramescaperImageSourceCurrentV1 } from '../../common/editor/timeline-image-model-current-v1.ts';
import { serializeScapeProjectDocument } from '../../common/editor/scape-project-document.ts';
import type { FramescaperProjectTimelineImage } from '../editor-project-timeline-image.ts';
import type { FramescaperTimelineImageProjectCodecTimelineImage } from '../editor-timeline-image-publication-timeline-image.ts';

const TRANSITION_FIELDS = ['expected', 'project'] as const;
export interface PreparedPublication {
	readonly expected: FramescaperProjectTimelineImage;
	readonly project: FramescaperProjectTimelineImage;
	readonly source: FramescaperImageSourceCurrentV1;
	readonly clip: FramescaperImageClipV1;
	readonly projectId: string;
	readonly baseRevision: number;
	readonly nextRevision: number;
}

export function preparePublication(
	profile: unknown,
	value: unknown,
	codec: FramescaperTimelineImageProjectCodecTimelineImage,
): PreparedPublication {
	const raw = closedRecord(value, TRANSITION_FIELDS, 'timelineImage timeline-image publication');
	const expected = codec.clone(profile, raw.expected);
	const project = codec.clone(profile, raw.project);
	if (project.id !== expected.id) throw new Error('timelineImage image publication cannot change project identity.');
	const baseRevision = revision(expected.revision, 'base');
	const nextRevision = safeNextRevision(baseRevision);
	if (project.revision !== nextRevision) {
		throw new Error('timelineImage image publication must publish exactly the next revision.');
	}
	assertFreshTimestamp(expected.updatedAt, project.updatedAt);
	const expectedSourceIds = new Set(records(expected.sources, 'timelineImage base sources').map(stableId));
	const addedSources = records(project.sources, 'timelineImage target sources')
		.filter((source) => source.kind === 'image' && !expectedSourceIds.has(stableId(source)));
	if (addedSources.length !== 1) throw new Error('timelineImage image publication requires one fresh image source.');
	const source = addedSources[0] as unknown as FramescaperImageSourceCurrentV1;
	const expectedClipIds = new Set(allClips(expected).map(stableId));
	const addedClips = allClips(project)
		.filter((clip) => clip.kind === 'image' && !expectedClipIds.has(stableId(clip)));
	if (addedClips.length !== 1) throw new Error('timelineImage image publication requires one fresh image clip.');
	const clip = addedClips[0] as unknown as FramescaperImageClipV1;
	if (clip.sourceId !== source.id) throw new Error('The fresh timelineImage image clip must own its fresh source.');
	const placement = imagePlacement(project, clip.id);
	const trackCommand = freshTrackCommand(expected, project, clip, placement);
	const reconstructed = codec.apply(profile, expected, {
		type: 'batch',
		commands: [...(trackCommand ? [trackCommand] : []), {
			type: 'image-source/set', sourceId: source.id, expectedSource: null, source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null, clip, placement,
		}],
	}, { now: String(project.updatedAt) });
	if (!sameProject(reconstructed, project)) {
		throw new Error('timelineImage image publication may add only one source, one clip, and its placement.');
	}
	return Object.freeze({
		expected,
		project,
		source: structuredClone(source),
		clip: structuredClone(clip),
		projectId: expected.id,
		baseRevision,
		nextRevision,
	});
}

function freshTrackCommand(
	expected: FramescaperProjectTimelineImage,
	project: FramescaperProjectTimelineImage,
	clip: FramescaperImageClipV1,
	placement: ReturnType<typeof imagePlacement>,
): Record<string, unknown> | null {
	const expectedIds = new Set(records(expected.tracks, 'timelineImage base tracks').map(stableId));
	const targetTracks = records(project.tracks, 'timelineImage target tracks');
	const added = targetTracks.filter((track) => !expectedIds.has(stableId(track)));
	if (added.length === 0) return null;
	if (added.length !== 1 || placement.scope !== 'timeline') {
		throw new Error('timelineImage image publication may create at most one timeline video track.');
	}
	const track = added[0]!;
	const trackId = stableId(track);
	if (trackId !== placement.trackId || track.type !== 'video' || track.locked === true
		|| !Array.isArray(track.clipIds)
		|| track.clipIds.length !== 1 || track.clipIds[0] !== clip.id) {
		throw new Error('The fresh timelineImage image track must be unlocked and own only the fresh image clip.');
	}
	const primaryId = String(project.primarySequenceId);
	const owners = records(project.sequences, 'timelineImage target sequences').filter(({ trackIds }) => (
		Array.isArray(trackIds) && trackIds.includes(trackId)
	));
	if (owners.length !== 1 || owners[0]!.id !== primaryId) {
		throw new Error('The fresh timelineImage image track must belong only to the primary sequence.');
	}
	return {
		type: 'track/add',
		track: { ...structuredClone(track), clipIds: [] },
		index: targetTracks.indexOf(track),
	};
}

function imagePlacement(project: FramescaperProjectTimelineImage, clipId: string) {
	const timeline = records(project.clips, 'timelineImage target timeline clips').some(({ id }) => id === clipId);
	const bin = records(record(project.projectBin, 'timelineImage target project bin').clips, 'timelineImage target bin clips')
		.some(({ id }) => id === clipId);
	if (timeline === bin) throw new Error('The fresh timelineImage image clip requires one exact placement.');
	if (bin) return Object.freeze({ scope: 'project-bin' as const });
	const owners = records(project.tracks, 'timelineImage target tracks').filter(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(clipId)
	));
	if (owners.length !== 1 || owners[0]!.type !== 'video') {
		throw new Error('The fresh timelineImage timeline image requires one video-track owner.');
	}
	return Object.freeze({ scope: 'timeline' as const, trackId: stableId(owners[0]!) });
}

function allClips(project: FramescaperProjectTimelineImage): Record<string, unknown>[] {
	return [
		...records(project.clips, 'timelineImage timeline clips'),
		...records(record(project.projectBin, 'timelineImage project bin').clips, 'timelineImage bin clips'),
	];
}

function assertFreshTimestamp(before: unknown, after: unknown): void {
	const base = canonicalTimestamp(before, 'base updatedAt');
	const next = canonicalTimestamp(after, 'target updatedAt');
	if (Date.parse(next) <= Date.parse(base)) {
		throw new Error('timelineImage image publication requires one fresh updatedAt timestamp.');
	}
}

export function canonicalTimestamp(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`timelineImage image ${name} must be a timestamp.`);
	const date = new Date(value);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError(`timelineImage image ${name} must be canonical.`);
	}
	return value;
}

function revision(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The timelineImage image ${name} revision must be a non-negative safe integer.`);
	}
	return Number(value);
}

function safeNextRevision(value: number): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError('The timelineImage image revision cannot increment safely.');
	return value + 1;
}

export function revisionKey(projectId: string, revisionValue: number): string {
	return `${projectId}:${String(revisionValue).padStart(12, '0')}`;
}

export function sameProject(left: unknown, right: unknown): boolean {
	try { return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right); }
	catch { return false; }
}

function stableId(value: Record<string, unknown>): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError('timelineImage image identity must be non-empty.');
	return value.id;
}

export function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
	optional: readonly Fields[number][] = [],
): Record<Fields[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const required = fields.filter((field) => !optional.includes(field));
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| required.some((field) => !Object.hasOwn(value, field))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const output = Object.create(null) as Record<Fields[number], unknown>;
	for (const key of keys as string[]) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${key} must be an enumerable data property.`);
		}
		output[key as Fields[number]] = descriptor.value;
	}
	return output;
}

export function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
