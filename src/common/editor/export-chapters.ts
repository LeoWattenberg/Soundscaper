/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectDurationFrames } from './project.js';
import { isTimelineAnnotationProjectSchema } from './project-schema-version.ts';
import {
	resolveRuntimeTimelineAnnotationsProjection,
	type RuntimeTimelineAnnotationProject,
} from './runtime-timeline-annotation-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;

/** One delivered chapter: a named span the project's labels put a boundary on. */
export interface ExportChapter {
	readonly name: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames: number;
}

interface ChapterBoundary {
	readonly name: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

interface ExportChapterRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * The chapters a label-split delivery writes.
 *
 * The boundaries are the project's own labels, read from whichever surface the
 * project keeps them on: the maintained timeline annotations when the schema
 * carries them, and the first populated label track otherwise. A region label
 * delivers exactly its own span; a point label opens a chapter that runs to the
 * next label, or to the end of the delivered range — and no further than the
 * end of a region it was dropped inside, whose tail is already delivered under
 * the region's own name. Everything is then clipped to that range, so a chapter
 * never promises audio the delivery is not rendering.
 */
export function resolveExportChapters(
	projectValue: unknown,
	range: ExportChapterRange,
): readonly ExportChapter[] {
	const boundaries = chapterBoundaries(projectValue);
	if (boundaries.length === 0) {
		throw new RangeError('A chapter delivery needs at least one label to split on; this project has none.');
	}
	const chapters: ExportChapter[] = [];
	const used = new Set<string>();
	for (const [index, boundary] of boundaries.entries()) {
		const openEnd = boundary.endFrame > boundary.startFrame
			? boundary.endFrame
			: Math.min(
				boundaries[index + 1]?.startFrame ?? range.endFrame,
				enclosingRegionEnd(boundaries, index) ?? range.endFrame,
			);
		const startFrame = Math.max(boundary.startFrame, range.startFrame);
		const endFrame = Math.min(openEnd, range.endFrame);
		if (endFrame <= startFrame) continue;
		chapters.push(Object.freeze({
			name: uniqueChapterName(boundary.name, index, used),
			startFrame,
			endFrame,
			durationFrames: endFrame - startFrame,
		}));
	}
	if (chapters.length === 0) {
		throw new RangeError('No label falls inside the delivered range, so there is no chapter to write.');
	}
	return Object.freeze(chapters);
}

/**
 * How many chapters a label split would deliver, without refusing.
 *
 * The dialog asks this to decide whether the option is offerable at all, so it
 * answers with the files the delivery would actually write: the labels resolved
 * over the very span the export cuts them from, not the labels alone. A project
 * that cannot answer — a shape the annotation projection rejects, or one whose
 * labels all fall outside that span — is reported as having none rather than
 * failing the surface that asked.
 */
export function exportChapterCount(projectValue: unknown): number {
	try {
		const range = chapterDeliveryRange(projectValue);
		return range === null
			? chapterBoundaries(projectValue).length
			: resolveExportChapters(projectValue, range).length;
	} catch {
		return 0;
	}
}

/**
 * The span a chapter delivery is cut from.
 *
 * A chapter split is only ever paired with the whole project, and the export
 * clips its chapters to that span, so a label past the last clip is delivered
 * by neither. Reading the same span here keeps the offered count and the
 * written files in agreement instead of offering a split that then refuses.
 *
 * A project that states no span of its own — a shape whose clip timing the
 * runtime projection rejects, or one with no audio at all, which every mode
 * refuses over its range rather than over its labels — leaves the count to the
 * labels themselves rather than withdrawing an option for someone else's
 * refusal.
 */
function chapterDeliveryRange(projectValue: unknown): ExportChapterRange | null {
	try {
		const endFrame = Number(projectDurationFrames(projectValue));
		return Number.isSafeInteger(endFrame) && endFrame > 0 ? { startFrame: 0, endFrame } : null;
	} catch {
		return null;
	}
}

function chapterBoundaries(projectValue: unknown): readonly ChapterBoundary[] {
	const project = dataRecord(projectValue);
	const annotations = annotationBoundaries(project);
	const boundaries = annotations.length > 0 ? annotations : labelTrackBoundaries(project);
	return Object.freeze([...boundaries].sort((left, right) => (
		left.startFrame - right.startFrame || left.endFrame - right.endFrame
	)));
}

/**
 * Where a point label's chapter has to stop because a region label already
 * promises the audio beyond it.
 *
 * A marker dropped inside a region would otherwise open a chapter running to
 * the next label or to the end of the delivered range, writing the region's own
 * tail a second time under another name. The region still delivers exactly its
 * own span; the nested chapter is the part of it the marker opens.
 */
function enclosingRegionEnd(boundaries: readonly ChapterBoundary[], index: number): number | null {
	const nested = boundaries[index];
	let end: number | null = null;
	for (const [candidate, region] of boundaries.entries()) {
		if (candidate === index || region.endFrame <= region.startFrame) continue;
		if (region.startFrame > nested.startFrame || region.endFrame <= nested.startFrame) continue;
		if (end === null || region.endFrame < end) end = region.endFrame;
	}
	return end;
}

function annotationBoundaries(project: DataRecord): readonly ChapterBoundary[] {
	if (!isTimelineAnnotationProjectSchema(project)) return [];
	if (!Array.isArray(project.timelineAnnotations) || project.timelineAnnotations.length === 0) return [];
	const projected = resolveRuntimeTimelineAnnotationsProjection(
		project as unknown as RuntimeTimelineAnnotationProject,
	);
	return projected.map((annotation) => Object.freeze({
		name: String(annotation.name ?? ''),
		startFrame: annotation.timelineStartFrame,
		endFrame: annotation.timelineEndFrame,
	}));
}

function labelTrackBoundaries(project: DataRecord): readonly ChapterBoundary[] {
	const tracks = Array.isArray(project.tracks) ? project.tracks : [];
	const track = tracks
		.map((value) => dataRecord(value))
		.find((candidate) => candidate.type === 'label' && Array.isArray(candidate.labels) && candidate.labels.length > 0);
	if (!track) return [];
	return (track.labels as readonly unknown[]).map((value) => {
		const label = dataRecord(value);
		const startFrame = nonNegativeFrame(label.startFrame, 'label.startFrame');
		const endFrame = nonNegativeFrame(label.endFrame ?? startFrame, 'label.endFrame');
		if (endFrame < startFrame) throw new RangeError('A label cannot end before it starts.');
		return Object.freeze({ name: String(label.title ?? ''), startFrame, endFrame });
	});
}

/**
 * Chapter names become file names, so two labels sharing a name would otherwise
 * collide inside the archive and fail the delivery at the point where the
 * second one is added. The index is what already distinguishes them.
 */
function uniqueChapterName(name: string, index: number, used: Set<string>): string {
	const trimmed = name.trim();
	const base = trimmed || `chapter-${String(index + 1)}`;
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let candidate = `${base}-${String(index + 1)}`;
	let suffix = index + 1;
	while (used.has(candidate)) {
		suffix += 1;
		candidate = `${base}-${String(suffix)}`;
	}
	used.add(candidate);
	return candidate;
}

function nonNegativeFrame(value: unknown, name: string): number {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return frame;
}

function dataRecord(value: unknown): DataRecord {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: {};
}

/** The plan one chapter's own render and conformance check are performed under. */
export function createExportChapterPlan<Plan extends DataRecord>(
	plan: Plan,
	output: DataRecord,
): Plan {
	const range = dataRecord(output.range);
	const outputFrames = Number(output.outputFrames);
	if (!Number.isSafeInteger(outputFrames) || outputFrames <= 0) {
		throw new RangeError('A chapter output must state how many frames it delivers.');
	}
	// A chapter sits at its own place on the project's timeline, so it carries
	// the broadcast metadata the plan derived for that place rather than the one
	// the whole delivery was derived at — in both the copy the writer embeds and
	// the copy the encoding settings hold, which the direct writers compare.
	const declared: unknown = output.bext;
	const bext = declared && typeof declared === 'object' && !Array.isArray(declared)
		? declared as DataRecord
		: null;
	return Object.freeze({
		...plan,
		...(bext ? { bext, encoding: Object.freeze({ ...dataRecord(plan.encoding), bext }) } : {}),
		// One chapter is an ordinary whole-mix delivery of its own span, so
		// everything downstream of here reads the plan it always read.
		mode: 'mix',
		range: Object.freeze({
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			durationFrames: range.durationFrames,
		}),
		tailFrames: 0,
		outputFrames,
		outputFileBytesPerRender: output.outputFileBytes ?? null,
		outputs: Object.freeze([output]),
		archive: null,
	}) as unknown as Plan;
}
