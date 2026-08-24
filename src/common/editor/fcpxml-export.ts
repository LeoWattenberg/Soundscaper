/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { type SequenceRationalRate } from './sequence-timecode.ts';
import { sequenceFrameAtSample } from './sequence-frame-navigation.ts';
import {
	interchangeClipTimeEffect,
	reportInterchangeAnnotationOmission,
	reportInterchangeCaptionTrackOmission,
} from './interchange-omission-inventory.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';

/**
 * FCPXML export.
 *
 * FCPXML is the one profile in the family whose native time model is already
 * rational, which makes it the one where losing exactness would be entirely
 * self-inflicted. Every time attribute is written as FCPXML's own `N/Ds` form
 * (or `Ns` when the rational reduces to a whole second) and never as decimal
 * seconds — `0.033367s` is a frame boundary that has already stopped being a
 * frame boundary.
 *
 * Durations are whole multiples of the format's `frameDuration`, which is how
 * FCP itself expresses a frame count. A duration that is not such a multiple
 * would be a clip that starts mid-frame, so this module counts frames and
 * multiplies, rather than converting seconds and hoping the result lands.
 *
 * Resources are deduplicated by stable source identity rather than by path
 * string, because two references to the same media under different paths are
 * one asset, and treating them as two is how a relink fixes only half a
 * timeline.
 */

export const FCPXML_VERSION = '1.10';

export interface FcpxmlExportRequest {
	readonly project: Readonly<Record<string, unknown>>;
	/** Sequence whose timed-text omissions belong to this delivered timeline. */
	readonly sequenceId?: string;
	readonly sequenceRate: SequenceRationalRate;
	readonly dropFrame?: boolean;
	/** Sequence frames the timeline starts at, from the sequence's start timecode. */
	readonly startFrameCount?: number;
	readonly title?: string;
}

export interface FcpxmlExportResult {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/xml';
	readonly report: DeliveryReport;
}

type Draft = Parameters<typeof addDeliveryReportItem>[0];

interface AssetResource {
	readonly id: string;
	readonly sourceId: string;
	readonly name: string;
	readonly src: string;
	readonly hasVideo: boolean;
	readonly hasAudio: boolean;
}

export function createFcpxmlExport(request: FcpxmlExportRequest): FcpxmlExportResult {
	const project = request?.project;
	if (!project || typeof project !== 'object') throw new TypeError('An FCPXML export requires a project.');
	const rate = request?.sequenceRate;
	if (!rate || !Number.isSafeInteger(rate.num) || !Number.isSafeInteger(rate.den)
		|| rate.num <= 0 || rate.den <= 0) {
		throw new TypeError('An FCPXML export requires an exact rational sequence rate.');
	}
	const sampleRate = Number(project.sampleRate);
	if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
		throw new RangeError('An FCPXML export requires a positive project sample rate.');
	}
	const dropFrame = Boolean(request?.dropFrame);
	const title = String(request?.title ?? project.title ?? 'Timeline');
	const draft = createDeliveryReport({
		format: 'fcpxml', container: `FCPXML ${FCPXML_VERSION}`, codec: null,
		sampleRate, channelCount: null, lossless: null,
	});

	const clipById = new Map(asRecords(project.clips).map((clip) => [String(clip.id), clip]));
	const sourceById = new Map(asRecords(project.sources).map((source) => [String(source.id), source]));

	// Resources are keyed by source identity, so the same media referenced twice
	// is one asset and a relink reaches every use of it.
	const assets = new Map<string, AssetResource>();
	const assetIdFor = (sourceId: string): string | null => {
		const source = sourceById.get(sourceId);
		if (!source) return null;
		const existing = assets.get(sourceId);
		if (existing) return existing.id;
		const id = `r${assets.size + 2}`;
		assets.set(sourceId, {
			id,
			sourceId,
			name: String(source.name ?? sourceId),
			src: String(source.storageKey ?? source.id ?? sourceId),
			hasVideo: source.kind === 'video',
			hasAudio: source.kind === 'audio' || source.hasAudio === true,
		});
		return id;
	};

	const spine: string[] = [];
	let sequenceEndFrames = 0;
	let spineTrackId: string | null = null;
	let videoLane = 0;
	let audioLane = 0;
	const visibility = createInterchangeVisibility(asRecords(project.tracks) as never, project);
	reportInterchangeAnnotationOmission(draft, project, 'fcpxml');
	reportInterchangeCaptionTrackOmission(draft, project, 'fcpxml', request.sequenceId);
	for (const track of asRecords(project.tracks)) {
		const type = String(track.type ?? '');
		if (type !== 'video' && type !== 'audio') continue;
		if (!visibility.contributes(track as never)) {
			addDeliveryReportItem(draft, {
				code: 'fcpxml.track-silent-omitted',
				disposition: 'omitted',
				severity: 'info',
				scope: { kind: 'track', id: String(track.id) },
				data: { type, reason: visibility.reason(track as never) },
				message: 'A track that does not contribute to the render is not in the sequence either.',
			});
			continue;
		}
		if (asStrings(track.clipIds).length === 0) continue;
		// Lane 0 is the spine itself and holds the first contributing video
		// track. Everything simultaneous with it is a connected clip: further
		// video above at 1, 2, …, audio below at -1, -2, …. Without lanes they
		// would all share offset="0s" in a sequential spine, which is not a
		// second track but a malformed first one.
		let lane = 0;
		if (type === 'video' && spineTrackId === null) spineTrackId = String(track.id);
		else if (type === 'video') lane = (videoLane += 1);
		else lane = -(audioLane += 1);

		// clipIds carries authoring order, not time order, and a spine is serial.
		// The other two exporters sort; this one must too, or a track authored
		// out of order emits descending offsets in a sequential container.
		const ordered = asStrings(track.clipIds)
			.map((clipId) => clipById.get(clipId))
			.filter((clip): clip is Readonly<Record<string, unknown>> => Boolean(clip))
			.sort((left, right) => (
				Number(left.timelineStartFrame ?? 0) - Number(right.timelineStartFrame ?? 0)
				|| String(left.id).localeCompare(String(right.id))
			));
		for (const clip of ordered) {
			const emitted = buildClip(clip, {
				rate, sampleRate, type, assetIdFor, draft, lane,
			});
			if (!emitted) continue;
			spine.push(emitted.xml);
			sequenceEndFrames = Math.max(sequenceEndFrames, emitted.endFrames);
		}
	}

	const startFrames = nonNegativeInteger(request?.startFrameCount ?? 0, 'startFrameCount');
	const resources = [
		`\t\t<format id="r1" name="${escapeXml(formatName(rate))}"`
			+ ` frameDuration="${frameDurationAttribute(rate)}"/>`,
		// `asset` is declared `(media-rep+, metadata?)` and carries no `src` of its
		// own — the location lives on `media-rep`. Emitting src on the asset
		// produces a document Final Cut rejects outright, which a lenient reader
		// will happily accept and thereby hide.
		...[...assets.values()].flatMap((asset) => [
			`\t\t<asset id="${asset.id}" name="${escapeXml(asset.name)}"`
			+ ` hasVideo="${asset.hasVideo ? 1 : 0}" hasAudio="${asset.hasAudio ? 1 : 0}"`
			+ `${asset.hasVideo ? ' format="r1"' : ''}>`,
			`\t\t\t<media-rep kind="original-media" src="${escapeXml(asset.src)}"/>`,
			'\t\t</asset>',
		]),
	];

	addDeliveryReportItem(draft, {
		code: 'fcpxml.resources-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: {
			assets: assets.size,
			clips: spine.length,
			sequenceRate: `${rate.num}/${rate.den}`,
			tcFormat: dropFrame ? 'DF' : 'NDF',
		},
	});
	if (assets.size > 0) {
		addDeliveryReportItem(draft, {
			code: 'fcpxml.media-reference-converted',
			disposition: 'converted',
			severity: 'info',
			data: { addressing: 'managed-storage-key' },
			message: 'Media is addressed by managed storage key; src is not a filesystem path.',
		});
	}

	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE fcpxml>',
		`<fcpxml version="${FCPXML_VERSION}">`,
		'\t<resources>',
		...resources,
		'\t</resources>',
		'\t<library>',
		`\t\t<event name="${escapeXml(title)}">`,
		`\t\t\t<project name="${escapeXml(title)}">`,
		`\t\t\t\t<sequence format="r1" duration="${frameTime(sequenceEndFrames, rate)}"`
			+ ` tcStart="${frameTime(startFrames, rate)}" tcFormat="${dropFrame ? 'DF' : 'NDF'}">`,
		'\t\t\t\t\t<spine>',
		...spine,
		'\t\t\t\t\t</spine>',
		'\t\t\t\t</sequence>',
		'\t\t\t</project>',
		'\t\t</event>',
		'\t</library>',
		'</fcpxml>',
	];

	return Object.freeze({
		text: `${lines.join('\n')}\n`,
		fileName: `${sanitizeFileName(title)}.fcpxml`,
		mimeType: 'application/xml' as const,
		report: sealDeliveryReport(draft),
	});
}

function buildClip(clip: Readonly<Record<string, unknown>>, context: {
	rate: SequenceRationalRate;
	sampleRate: number;
	type: string;
	assetIdFor: (sourceId: string) => string | null;
	draft: Draft;
	lane: number;
}): { xml: string; endFrames: number } | null {
	const timelineStart = nonNegativeInteger(clip.timelineStartFrame ?? 0, 'clip.timelineStartFrame');
	const duration = positiveInteger(clip.durationFrames, 'clip.durationFrames');
	const offsetFrames = toFrames(timelineStart, context.rate, context.sampleRate);
	const endFrames = toFrames(timelineStart + duration, context.rate, context.sampleRate);
	if (endFrames <= offsetFrames) {
		addDeliveryReportItem(context.draft, {
			code: 'fcpxml.sub-frame-clip-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { durationFrames: duration },
			message: 'The clip is shorter than one frame at the sequence rate and cannot be placed.',
		});
		return null;
	}
	const sourceId = String(clip.sourceId ?? '');
	const ref = context.assetIdFor(sourceId);
	if (!ref) {
		addDeliveryReportItem(context.draft, {
			code: 'fcpxml.media-reference-missing',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { sourceId },
			message: 'The clip references a source the project does not contain, so no asset could be written.',
		});
		return null;
	}
	// Whichever authority states the retime: the legacy scalar, an audio warp map,
	// or a video retime curve. Reading only the scalar wrote a source range that
	// claimed media a warped clip never uses, and reported nothing.
	const timeEffect = interchangeClipTimeEffect(clip);
	if (timeEffect) {
		addDeliveryReportItem(context.draft, {
			code: 'fcpxml.speed-change-omitted',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'clip', id: String(clip.id) },
			data: { kind: timeEffect.kind, ...timeEffect.data },
			message: 'The profile emits no timeMap; the clip carries its rendered duration.',
		});
	}
	const startFrames = toFrames(
		nonNegativeInteger(clip.sourceStartFrame ?? 0, 'clip.sourceStartFrame'),
		context.rate,
		context.sampleRate,
	);
	// `asset-clip` declares audioRole and videoRole; a bare `role` attribute is
	// not in the DTD at all. One default per track kind; no vocabulary invented.
	const role = context.type === 'video' ? 'videoRole="video"' : 'audioRole="dialogue"';
	const xml = `\t\t\t\t\t\t<asset-clip ref="${ref}" name="${escapeXml(String(clip.title ?? clip.id ?? ''))}"`
		+ (context.lane === 0 ? '' : ` lane="${context.lane}"`)
		+ ` offset="${frameTime(offsetFrames, context.rate)}"`
		+ ` start="${frameTime(startFrames, context.rate)}"`
		+ ` duration="${frameTime(endFrames - offsetFrames, context.rate)}"`
		+ ` ${role}/>`;
	return { xml, endFrames };
}

/**
 * A frame count as an FCPXML time attribute: `frames * den / num` seconds,
 * reduced, and written as whole seconds when the rational allows. Never a
 * decimal — that is the one thing this format makes easy to get right and easy
 * to throw away.
 */
export function frameTime(frames: number, rate: SequenceRationalRate): string {
	if (!Number.isSafeInteger(frames) || frames < 0) {
		throw new RangeError('An FCPXML time must be a non-negative whole frame count.');
	}
	if (frames === 0) return '0s';
	const numerator = frames * rate.den;
	const divisor = gcd(numerator, rate.num);
	const reducedNumerator = numerator / divisor;
	const reducedDenominator = rate.num / divisor;
	return reducedDenominator === 1 ? `${reducedNumerator}s` : `${reducedNumerator}/${reducedDenominator}s`;
}

/** The duration of exactly one frame, which every other duration is a multiple of. */
export function frameDurationAttribute(rate: SequenceRationalRate): string {
	const divisor = gcd(rate.den, rate.num);
	return `${rate.den / divisor}/${rate.num / divisor}s`;
}

function formatName(rate: SequenceRationalRate): string {
	// Named from the exact rational, so a format resource cannot claim a rate
	// the timeline is not actually at.
	return `SoundscaperFormat${rate.num}_${rate.den}`;
}

/**
 * Sample frames to sequence frames through the shared navigation, not by
 * flooring the exact quotient. `point` rounding can move a boundary either way
 * against the quotient, so the two disagree on roughly one boundary in five
 * thousand — enough for an FCPXML file to place a cut one frame from where the
 * EDL of the same project places it.
 */
function toFrames(sampleFrame: number, rate: SequenceRationalRate, sampleRate: number): number {
	return sequenceFrameAtSample(sampleFrame, rate, sampleRate);
}

function gcd(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b) {
		const next = a % b;
		a = b;
		b = next;
	}
	return a || 1;
}

function escapeXml(value: string): string {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
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
