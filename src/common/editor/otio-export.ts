/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { type SequenceRationalRate } from './sequence-timecode.ts';

/**
 * OpenTimelineIO export.
 *
 * The milestone-3 exporter rules bind this profile harder than they bind the
 * EDL, because OTIO's own time model is the hazard:
 *
 * - **Rates are computed quotients, never literals.** `30000/1001` is emitted
 *   as the division, so the double is the closest representable value to the
 *   exact rate. A `29.97` literal in a file is a rate that has already lost.
 * - **Values are pre-rounded here.** `rescaled_to()` preserves fractional
 *   doubles and downstream consumers truncate toward zero, so a fractional
 *   `value` is a frame that silently disappears somewhere else. Every value
 *   this module writes is an integer in its own timebase.
 * - **One timebase per item.** Video items are counted in sequence frames at
 *   the sequence rate; audio items in samples at the sample rate. Mixing them
 *   inside one item is how a rounding error becomes permanent.
 * - **The rational rate rides metadata.** OTIO stores rate as a double and has
 *   no slot for `{num, den}`, so the exact rational is carried in our own
 *   namespace. A reader that wants exactness can find it; one that does not is
 *   no worse off than with any other OTIO file.
 *
 * Nesting is not flattened. This profile emits one stack of tracks, and a
 * project containing nested sequences reports them rather than inlining their
 * contents, because a silently flattened nest is indistinguishable from a
 * sequence that never had one.
 */

export const OTIO_METADATA_NAMESPACE = 'media.kw.soundscaper';

export interface OtioExportRequest {
	readonly project: Readonly<Record<string, unknown>>;
	readonly sequenceRate: SequenceRationalRate;
	/** Sequence frames the timeline starts at, from the sequence's start timecode. */
	readonly startFrameCount?: number;
	readonly title?: string;
}

export interface OtioExportResult {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/json';
	readonly document: Readonly<Record<string, unknown>>;
	readonly report: DeliveryReport;
}

type Draft = Parameters<typeof addDeliveryReportItem>[0];

interface TrackWalk {
	readonly id: string;
	readonly name: string;
	readonly kind: 'Video' | 'Audio';
	readonly timebase: number;
	readonly rateValue: number;
	readonly clips: readonly Readonly<Record<string, unknown>>[];
}

export function createOtioExport(request: OtioExportRequest): OtioExportResult {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('An OTIO export requires a project.');
	const rate = request?.sequenceRate;
	if (!rate || !Number.isSafeInteger(rate.num) || !Number.isSafeInteger(rate.den)
		|| rate.num <= 0 || rate.den <= 0) {
		throw new TypeError('An OTIO export requires an exact rational sequence rate.');
	}
	const sampleRate = Number(project.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
		throw new RangeError('An OTIO export requires a positive project sample rate.');
	}
	const title = String(request?.title ?? project.title ?? 'Timeline');
	const draft = createDeliveryReport({
		format: 'otio', container: 'OpenTimelineIO', codec: null,
		sampleRate, channelCount: null, lossless: null,
	});

	// The one place the exact rational becomes a double, computed rather than written.
	const sequenceRateValue = rate.num / rate.den;

	const clipById = new Map(
		asRecords(project.clips).map((clip) => [String(clip.id), clip]),
	);
	const sourceById = new Map(
		asRecords(project.sources).map((source) => [String(source.id), source]),
	);
	const tracks = asRecords(project.tracks);

	const walks: TrackWalk[] = [];
	for (const track of tracks) {
		const type = String(track.type ?? '');
		if (type !== 'video' && type !== 'audio') {
			if (asStrings(track.clipIds).length > 0) {
				addDeliveryReportItem(draft, {
					code: 'otio.track-kind-omitted',
					disposition: 'omitted',
					severity: 'warning',
					scope: { kind: 'track', id: String(track.id) },
					data: { type },
					message: 'The profile emits video and audio tracks; this kind has no OTIO track kind.',
				});
			}
			continue;
		}
		if (track.hidden === true || track.mute === true) {
			addDeliveryReportItem(draft, {
				code: 'otio.track-silent-omitted',
				disposition: 'omitted',
				severity: 'info',
				scope: { kind: 'track', id: String(track.id) },
				data: { type, hidden: track.hidden === true, mute: track.mute === true },
				message: 'A track that does not contribute to the render is not in the timeline either.',
			});
			continue;
		}
		const isVideo = type === 'video';
		walks.push({
			id: String(track.id),
			name: String(track.name ?? track.id),
			kind: isVideo ? 'Video' : 'Audio',
			// One timebase per item: sequence frames for picture, samples for sound.
			timebase: isVideo ? sequenceRateValue : sampleRate,
			rateValue: isVideo ? sequenceRateValue : sampleRate,
			clips: asStrings(track.clipIds)
				.map((clipId) => clipById.get(clipId))
				.filter((clip): clip is Readonly<Record<string, unknown>> => Boolean(clip))
				.sort((left, right) => (
					Number(left.timelineStartFrame ?? 0) - Number(right.timelineStartFrame ?? 0)
					|| String(left.id).localeCompare(String(right.id))
				)),
		});
	}

	reportNesting(project, draft);

	const children = walks.map((walk) => buildTrack(walk, {
		sampleRate, sequenceRate: rate, sourceById, draft,
	}));

	const document = {
		OTIO_SCHEMA: 'Timeline.1',
		name: title,
		global_start_time: rationalTime(
			nonNegativeInteger(request?.startFrameCount ?? 0, 'startFrameCount'),
			sequenceRateValue,
		),
		metadata: {
			[OTIO_METADATA_NAMESPACE]: {
				// OTIO has no rational-rate slot; a reader that wants exactness looks here.
				sequenceRate: { num: rate.num, den: rate.den },
				sampleRate,
				schema: 1,
			},
		},
		tracks: {
			OTIO_SCHEMA: 'Stack.1',
			name: 'tracks',
			children,
			metadata: {},
		},
	};

	addDeliveryReportItem(draft, {
		code: 'otio.tracks-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: {
			tracks: children.length,
			sequenceRate: `${rate.num}/${rate.den}`,
			sampleRate,
		},
	});

	return Object.freeze({
		text: `${JSON.stringify(document, null, '\t')}\n`,
		fileName: `${sanitizeFileName(title)}.otio`,
		mimeType: 'application/json' as const,
		document: Object.freeze(document),
		report: sealDeliveryReport(draft),
	});
}

function buildTrack(walk: TrackWalk, context: {
	sampleRate: number;
	sequenceRate: SequenceRationalRate;
	sourceById: Map<string, Readonly<Record<string, unknown>>>;
	draft: Draft;
}): Record<string, unknown> {
	const children: Record<string, unknown>[] = [];
	let position = 0;
	for (const clip of walk.clips) {
		const timelineStart = nonNegativeInteger(clip.timelineStartFrame ?? 0, 'clip.timelineStartFrame');
		const duration = positiveInteger(clip.durationFrames, 'clip.durationFrames');
		const start = toTimebase(timelineStart, walk, context);
		const end = toTimebase(timelineStart + duration, walk, context);
		if (end <= start) {
			// Shorter than one frame at this timebase, so it cannot be represented.
			// Dropping it silently would make the timeline disagree with the
			// project about how many clips exist, with nothing to point at.
			addDeliveryReportItem(context.draft, {
				code: 'otio.sub-frame-clip-omitted',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'clip', id: String(clip.id) },
				data: { durationFrames: duration, timebase: walk.kind },
				message: 'The clip is shorter than one frame at this timebase and has no representable duration.',
			});
			continue;
		}
		if (start > position) {
			children.push({
				OTIO_SCHEMA: 'Gap.1',
				name: '',
				source_range: timeRange(0, start - position, walk.rateValue),
				metadata: {},
			});
		}
		children.push(buildClip(clip, walk, context, end - start));
		position = end;
	}
	return {
		OTIO_SCHEMA: 'Track.1',
		name: walk.name,
		kind: walk.kind,
		children,
		metadata: { [OTIO_METADATA_NAMESPACE]: { trackId: walk.id } },
	};
}

function buildClip(
	clip: Readonly<Record<string, unknown>>,
	walk: TrackWalk,
	context: {
		sampleRate: number;
		sequenceRate: SequenceRationalRate;
		sourceById: Map<string, Readonly<Record<string, unknown>>>;
		draft: Draft;
	},
	durationInTimebase: number,
): Record<string, unknown> {
	const sourceId = String(clip.sourceId ?? '');
	const source = context.sourceById.get(sourceId);
	const sourceStart = toTimebase(
		nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame'),
		walk,
		context,
	);

	const speed = clip.speedRatio == null ? 1 : Number(clip.speedRatio);
	if (speed !== 1) {
		// The profile scope commits to no OTIO effects vocabulary, so a retimed
		// clip is emitted at its rendered duration and the change is named.
		addDeliveryReportItem(context.draft, {
			code: 'otio.speed-change-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { speedRatio: speed },
			message: 'The profile emits no time-effect vocabulary; the clip carries its rendered duration.',
		});
	}

	const target = source ? String(source.storageKey ?? source.id ?? sourceId) : '';
	if (!source) {
		addDeliveryReportItem(context.draft, {
			code: 'otio.media-reference-missing',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { sourceId },
			message: 'The clip references a source the project does not contain.',
		});
	} else {
		addDeliveryReportItem(context.draft, {
			code: 'otio.media-reference-converted',
			disposition: 'converted',
			severity: 'info',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { sourceId, target },
			message: 'Media is addressed by managed storage key; the target URL is not a filesystem path.',
		});
	}

	return {
		OTIO_SCHEMA: 'Clip.1',
		name: String(clip.title ?? source?.name ?? clip.id ?? ''),
		source_range: timeRange(sourceStart, durationInTimebase, walk.rateValue),
		media_reference: source
			? {
				OTIO_SCHEMA: 'ExternalReference.1',
				target_url: target,
				metadata: { [OTIO_METADATA_NAMESPACE]: { sourceId, addressing: 'managed-storage-key' } },
			}
			: { OTIO_SCHEMA: 'MissingReference.1', name: sourceId, metadata: {} },
		metadata: { [OTIO_METADATA_NAMESPACE]: { clipId: String(clip.id), speedRatio: speed } },
	};
}

/** Nested sequences are named, never inlined: a silent flatten is unrecoverable. */
function reportNesting(project: Readonly<Record<string, unknown>>, draft: Draft): void {
	const sequences = asRecords(project.sequences);
	if (sequences.length <= 1) return;
	addDeliveryReportItem(draft, {
		code: 'otio.additional-sequences-omitted',
		disposition: 'omitted',
		severity: 'warning',
		data: { sequences: sequences.length },
		message: 'The profile emits one stack; other sequences are not inlined into it.',
	});
}

/**
 * Sample frames to the track's own timebase. Video divides by the exact
 * rational rather than the double, so the frame index is the one the sequence
 * grid resolves to rather than one a floating-point rate drifted into.
 */
function toTimebase(sampleFrame: number, walk: TrackWalk, context: {
	sampleRate: number; sequenceRate: SequenceRationalRate;
}): number {
	if (walk.kind === 'Audio') return sampleFrame;
	return Math.floor((sampleFrame * context.sequenceRate.num) / (context.sampleRate * context.sequenceRate.den));
}

function rationalTime(value: number, rate: number): Record<string, unknown> {
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('An OTIO value must be a whole number in its own timebase.');
	}
	return { OTIO_SCHEMA: 'RationalTime.1', value, rate };
}

function timeRange(start: number, duration: number, rate: number): Record<string, unknown> {
	return {
		OTIO_SCHEMA: 'TimeRange.1',
		start_time: rationalTime(start, rate),
		duration: rationalTime(duration, rate),
	};
}

function asRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	return (Array.isArray(value) ? value : [])
		.filter((entry): entry is Readonly<Record<string, unknown>> => Boolean(entry) && typeof entry === 'object');
}

function asStrings(value: unknown): readonly string[] {
	return (Array.isArray(value) ? value : []).map((entry) => String(entry));
}

function nonNegativeInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return number;
}

function positiveInteger(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return number;
}

function sanitizeFileName(value: string): string {
	return value
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 64) || 'timeline';
}
