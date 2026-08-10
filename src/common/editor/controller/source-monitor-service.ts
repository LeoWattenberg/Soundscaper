/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOURCE_MONITOR_NO_MARKS,
	clampSourceFrame,
	markSourceIn,
	markSourceOut,
	normalizeSourceMonitorMarks,
	resolveSourceMonitorPoints,
	sourceFrameToMediaSeconds,
	sourceMonitorTimecodeLabel,
	stepSourceFrame,
	type SourceMonitorMarks,
	type SourceMonitorPoints,
} from '../source-monitor-model.ts';
import type { RationalRate } from '../timeline-time.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

/**
 * The source monitor: one video source open on its own frame grid.
 *
 * Which source is open, where its playhead sits, and what is marked are working
 * choices rather than facts about the document, so they live here beside edit
 * targeting and folder selection and are never persisted. Reopening a project
 * owes the user no scrub position.
 *
 * The state is held as identifiers and frames only; every view is re-resolved
 * against the live document, so a source that has gone away answers empty
 * rather than describing media that is no longer there.
 */

type DataRecord = Readonly<Record<string, unknown>>;

export interface SourceMonitorServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** The command projection: the same document every edit resolves against. */
	getProject(): DataRecord;
	publishProjectState(): void;
}

export interface SourceMonitorView {
	readonly binItemId: string | null;
	readonly sourceId: string | null;
	readonly sourceName: string | null;
	readonly frameRate: RationalRate | null;
	readonly sourceFrameCount: number;
	readonly positionFrame: number;
	readonly markIn: number | null;
	readonly markOut: number | null;
	readonly timecodeLabel: string | null;
	/** Where a media element's clock goes to show this frame. */
	readonly mediaSeconds: number;
}

export interface SourceMonitorOpenOptions {
	readonly positionFrame?: number | null;
	readonly markIn?: number | null;
	readonly markOut?: number | null;
}

export interface SourceMonitorService {
	view(): SourceMonitorView;
	open(binItemId: string, options?: SourceMonitorOpenOptions): SourceMonitorView;
	openSource(sourceId: string, options?: SourceMonitorOpenOptions): SourceMonitorView;
	close(): SourceMonitorView;
	seek(frame: number): SourceMonitorView;
	step(frameDelta: number): SourceMonitorView;
	markIn(frame?: number | null): SourceMonitorView;
	markOut(frame?: number | null): SourceMonitorView;
	clearMarks(): SourceMonitorView;
	/** The source points an edit from this bin item reads, or null for another item. */
	points(binItemId: string | null, sequencePointCount: number): SourceMonitorPoints | null;
}

const EMPTY_VIEW: SourceMonitorView = Object.freeze({
	binItemId: null,
	sourceId: null,
	sourceName: null,
	frameRate: null,
	sourceFrameCount: 0,
	positionFrame: 0,
	markIn: null,
	markOut: null,
	timecodeLabel: null,
	mediaSeconds: 0,
});

interface OpenSource {
	readonly source: DataRecord;
	readonly sourceFrameCount: number;
}

export function createSourceMonitorService(
	dependencies: SourceMonitorServiceDependencies,
): Readonly<SourceMonitorService> {
	let binItemId: string | null = null;
	let sourceId: string | null = null;
	let positionFrame = 0;
	let marks: SourceMonitorMarks = SOURCE_MONITOR_NO_MARKS;

	/** The open source as the document currently describes it, or null. */
	function open(): OpenSource | null {
		if (sourceId === null) return null;
		const project = dependencies.getProject();
		const source = arrayOf(project.sources).find((candidate) => (
			String(candidate.id) === sourceId && candidate.kind === 'video'
		));
		if (!source) return null;
		const count = Number(source.sourceFrameCount);
		if (!Number.isSafeInteger(count) || count <= 0) return null;
		return { source, sourceFrameCount: count };
	}

	function view(): SourceMonitorView {
		dependencies.lifetime.assertActive();
		return currentView();
	}

	function currentView(): SourceMonitorView {
		const opened = open();
		if (!opened) return EMPTY_VIEW;
		const rate = rationalRate(opened.source.frameRate);
		const position = clampSourceFrame(positionFrame, opened.sourceFrameCount);
		// The view reports only marks the media can still hold, on the same rule
		// the edit reads them by.
		const stated = normalizeSourceMonitorMarks(marks, opened.sourceFrameCount);
		return Object.freeze({
			binItemId,
			sourceId,
			sourceName: typeof opened.source.name === 'string' ? opened.source.name : null,
			frameRate: rate,
			sourceFrameCount: opened.sourceFrameCount,
			positionFrame: position,
			markIn: stated.markIn,
			markOut: stated.markOut,
			timecodeLabel: sourceMonitorTimecodeLabel(opened.source, position),
			mediaSeconds: sourceFrameToMediaSeconds(position, rate),
		});
	}

	function published(): SourceMonitorView {
		const next = currentView();
		dependencies.publishProjectState();
		return next;
	}

	function adopt(
		nextBinItemId: string | null,
		nextSourceId: string,
		options: SourceMonitorOpenOptions,
	): SourceMonitorView {
		const project = dependencies.getProject();
		const source = arrayOf(project.sources).find((candidate) => (
			String(candidate.id) === nextSourceId && candidate.kind === 'video'
		));
		if (!source) throw new ReferenceError(`Unknown video source: ${nextSourceId}.`);
		const count = Number(source.sourceFrameCount);
		if (!Number.isSafeInteger(count) || count <= 0) {
			throw new RangeError(`Video source ${nextSourceId} has no frames to monitor.`);
		}
		binItemId = nextBinItemId;
		sourceId = nextSourceId;
		positionFrame = clampSourceFrame(options.positionFrame ?? 0, count);
		marks = normalizedOpenMarks(options, count);
		return published();
	}

	function mutate(change: (opened: OpenSource) => void): SourceMonitorView {
		dependencies.lifetime.assertActive();
		const opened = open();
		if (!opened) return EMPTY_VIEW;
		change(opened);
		return published();
	}

	return Object.freeze({
		view,

		open(nextBinItemId: string, options: SourceMonitorOpenOptions = {}): SourceMonitorView {
			dependencies.lifetime.assertActive();
			const item = requireBinVideoClip(dependencies.getProject(), nextBinItemId);
			return adopt(String(item.binItemId ?? item.id), String(item.sourceId), options);
		},

		/**
		 * Open a source directly, remembering the bin item that carries it when
		 * there is one: match-frame arrives with a source, and an edit needs the
		 * item to find the audio that belongs with it.
		 */
		openSource(nextSourceId: string, options: SourceMonitorOpenOptions = {}): SourceMonitorView {
			dependencies.lifetime.assertActive();
			const item = binVideoClips(dependencies.getProject())
				.find((clip) => String(clip.sourceId) === nextSourceId) ?? null;
			return adopt(item ? String(item.binItemId ?? item.id) : null, nextSourceId, options);
		},

		close(): SourceMonitorView {
			dependencies.lifetime.assertActive();
			binItemId = null;
			sourceId = null;
			positionFrame = 0;
			marks = SOURCE_MONITOR_NO_MARKS;
			return published();
		},

		seek: (frame: number) => mutate((opened) => {
			positionFrame = clampSourceFrame(frame, opened.sourceFrameCount);
		}),

		step: (frameDelta: number) => mutate((opened) => {
			positionFrame = stepSourceFrame(positionFrame, frameDelta, opened.sourceFrameCount);
		}),

		markIn: (frame?: number | null) => mutate((opened) => {
			marks = markSourceIn(marks, frame ?? positionFrame, opened.sourceFrameCount);
		}),

		markOut: (frame?: number | null) => mutate((opened) => {
			marks = markSourceOut(marks, frame ?? positionFrame, opened.sourceFrameCount);
		}),

		clearMarks: () => mutate(() => {
			marks = SOURCE_MONITOR_NO_MARKS;
		}),

		points(requestedBinItemId: string | null, sequencePointCount: number): SourceMonitorPoints | null {
			dependencies.lifetime.assertActive();
			const opened = open();
			// Marks belong to the item they were set on. Editing a different item
			// reads no marks at all rather than borrowing somebody else's range.
			if (!opened || binItemId === null || binItemId !== requestedBinItemId) return null;
			return resolveSourceMonitorPoints(marks, opened.sourceFrameCount, sequencePointCount);
		},
	});
}

/** Marks supplied at open time are admitted by the same rule the user's are. */
function normalizedOpenMarks(
	options: SourceMonitorOpenOptions,
	sourceFrameCount: number,
): SourceMonitorMarks {
	if (options.markIn == null && options.markOut == null) return SOURCE_MONITOR_NO_MARKS;
	const withIn = options.markIn == null
		? SOURCE_MONITOR_NO_MARKS
		: markSourceIn(SOURCE_MONITOR_NO_MARKS, options.markIn, sourceFrameCount);
	// An out is exclusive, so it is stated here as the last frame it keeps.
	return options.markOut == null
		? withIn
		: markSourceOut(withIn, clampSourceFrame(options.markOut - 1, sourceFrameCount), sourceFrameCount);
}

function requireBinVideoClip(project: DataRecord, binItemId: string): DataRecord {
	const clip = binVideoClips(project).find((candidate) => (
		String(candidate.binItemId ?? candidate.id) === binItemId || String(candidate.id) === binItemId
	));
	if (!clip) throw new ReferenceError(`The Project Bin has no video item ${binItemId}.`);
	return clip;
}

function binVideoClips(project: DataRecord): DataRecord[] {
	const bin = isRecord(project.projectBin) ? arrayOf(project.projectBin.clips) : [];
	return bin.filter((clip) => clip.kind === 'video');
}

function arrayOf(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rationalRate(value: unknown): RationalRate {
	if (!isRecord(value)) throw new TypeError('A source frame rate must be rational.');
	const num = Number(value.num);
	const den = Number(value.den);
	if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
		throw new RangeError('A source frame rate must be a positive rational.');
	}
	return Object.freeze({ num, den });
}
