/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Turning a finished trim into an edit the project can undo.
 *
 * A trimmed copy is new bytes with new frame indexing, so the media and the
 * edits that reference it have to move together. This builds the batch that
 * moves them: one `source/rewrite-media` per source that was actually trimmed,
 * each carrying the new in-point of every clip that referenced it.
 *
 * The mapping is against the runs the writer produced, never the runs the plan
 * asked for. A lossless cut may only begin at a keyframe, so a run can come
 * back wider than requested, and remapping against the request would move every
 * reference after the first widened run.
 *
 * Two things are refused rather than approximated. A reference whose in-point
 * is not in the copy at all cannot be remapped, and sliding it to the nearest
 * survivor would move an edit without saying so. A reference that straddles a
 * gap between two runs cannot be remapped either: it would come out shorter
 * than it went in, and a clip quietly playing less than it did is exactly the
 * failure the plan exists to prevent. Either one takes its whole source out of
 * the batch, with a finding, and leaves that source bound to the media it
 * already had.
 */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { videoFrameToSampleFrame } from './timeline-time.ts';
import { trimMediaMapFrameInRuns, type TrimMediaRetainedRun } from './trim-media-plan.ts';
import type { TrimMediaSourceResult } from './trim-media-operation.ts';
import type { AudioEditorCommand } from './commands/protocol.ts';

export interface TrimMediaProjectEditRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly results: readonly TrimMediaSourceResult[];
	/** The digest of each trimmed copy, by source id, where one was computed. */
	readonly contentSha256?: Readonly<Record<string, string>>;
}

export interface TrimMediaProjectEdit {
	/** One batch, or null when no source was trimmed and there is nothing to do. */
	readonly command: AudioEditorCommand | null;
	readonly rewrittenSources: number;
	readonly remappedClips: number;
	readonly report: DeliveryReport;
}

export function createTrimMediaProjectEdit(
	request: TrimMediaProjectEditRequest,
): TrimMediaProjectEdit {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('A trim-media edit requires a project.');
	const draft = createDeliveryReport({
		format: 'trim-media', container: null, codec: null,
		sampleRate: null, channelCount: null, lossless: null,
	});
	const sources = new Map(asRecords(project.sources).map((source) => [String(source.id ?? ''), source]));
	const clips = [...asRecords(project.clips), ...asRecords(asRecord(project.projectBin)?.clips)];
	const commands: AudioEditorCommand[] = [];
	let remappedClips = 0;

	for (const result of request.results ?? []) {
		if (result.outcome !== 'trimmed' || !result.storageKey) continue;
		const source = sources.get(result.sourceId);
		if (!source) {
			addDeliveryReportItem(draft, {
				code: 'trim.rewrite-source-missing',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'source', id: result.sourceId },
				data: {},
				message: 'The project no longer contains this source, so the trimmed copy was not bound to it.',
			});
			continue;
		}
		const moves = remapReferences(source, clips, result.runs, draft);
		if (!moves) continue;
		commands.push(Object.freeze({
			type: 'source/rewrite-media',
			sourceId: result.sourceId,
			changes: rewriteChanges(source, result, request.contentSha256?.[result.sourceId]),
			clips: moves,
		}) as AudioEditorCommand);
		remappedClips += moves.length;
		addDeliveryReportItem(draft, {
			code: 'trim.source-rewritten',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'source', id: result.sourceId },
			data: { clips: moves.length, frameCount: result.writtenFrames, discardedFrames: result.discardedFrames },
			message: 'The source now reads from its trimmed copy, and every reference to it moved with it.',
		});
	}

	return Object.freeze({
		command: commands.length === 0
			? null
			: Object.freeze({ type: 'batch', commands: Object.freeze(commands) }) as AudioEditorCommand,
		rewrittenSources: commands.length,
		remappedClips,
		report: sealDeliveryReport(draft),
	});
}

type ClipMove = Readonly<{ clipId: string; sourceStartFrame: number }>;

/**
 * Where every reference to this source lands in the trimmed copy.
 *
 * Answers null when any one of them cannot be moved honestly, because a source
 * whose references are half-moved is worse than one that was not trimmed.
 */
function remapReferences(
	source: Readonly<Record<string, unknown>>,
	clips: readonly Readonly<Record<string, unknown>>[],
	runs: readonly TrimMediaRetainedRun[],
	draft: ReturnType<typeof createDeliveryReport>,
): readonly ClipMove[] | null {
	const sourceId = String(source.id ?? '');
	const video = source.kind === 'video';
	const moves: ClipMove[] = [];
	for (const clip of clips) {
		if (String(clip.sourceId ?? '') !== sourceId) continue;
		const clipId = String(clip.id ?? '');
		const startFrame = referenceStart(clip, video);
		const duration = referenceDuration(clip, video);
		const mapped = trimMediaMapFrameInRuns(runs, startFrame);
		const mappedLast = duration > 0 ? trimMediaMapFrameInRuns(runs, startFrame + duration - 1) : mapped;
		if (mapped === null || mappedLast === null || mappedLast - mapped !== Math.max(0, duration - 1)) {
			addDeliveryReportItem(draft, {
				code: 'trim.reference-unmappable',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'clip', id: clipId },
				data: { sourceId, startFrame, duration },
				message: 'This reference is not contiguous in the trimmed copy, so the source was left as it was.',
			});
			return null;
		}
		moves.push(Object.freeze({ clipId, sourceStartFrame: mapped }));
	}
	return Object.freeze(moves);
}

/** What the document is told about the rewritten media. */
function rewriteChanges(
	source: Readonly<Record<string, unknown>>,
	result: TrimMediaSourceResult,
	contentSha256: string | undefined,
): Readonly<Record<string, unknown>> {
	const frameCount = result.writtenFrames ?? result.retainedFrames;
	const lengths = source.kind === 'video'
		// A video source states its length twice and must state both: the plan
		// and the cut both work in pictures, so the sample-frame figure is
		// derived from the picture count the same way the normalizer derives it.
		? {
			sourceFrameCount: frameCount,
			sampleFrameCount: videoFrameToSampleFrame(
				frameCount,
				source.frameRate as never,
				Number(source.sampleRate ?? 48_000),
				'enclosingEnd',
			),
		}
		: { frameCount };
	return Object.freeze({
		storageKey: result.storageKey,
		...(result.byteLength === null ? {} : { byteLength: result.byteLength }),
		...(contentSha256 ? { contentSha256 } : {}),
		...lengths,
	});
}

/** A reference's in-point, in the domain its own source is measured in. */
function referenceStart(clip: Readonly<Record<string, unknown>>, video: boolean): number {
	const value = video ? clip.sourceInFrame ?? clip.sourceStartFrame : clip.sourceStartFrame;
	const frame = Number(value ?? 0);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('A reference in-point must be a frame index.');
	return frame;
}

function referenceDuration(clip: Readonly<Record<string, unknown>>, video: boolean): number {
	const explicit = Number(video ? clip.sourceFrameCount ?? clip.sourceDurationFrames : clip.sourceDurationFrames);
	if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
	const duration = Number(clip.durationFrames);
	return Number.isSafeInteger(duration) && duration > 0 ? duration : 0;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function asRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return (Array.isArray(value) ? value : [])
		.filter((entry): entry is Readonly<Record<string, unknown>> => Boolean(entry) && typeof entry === 'object');
}
