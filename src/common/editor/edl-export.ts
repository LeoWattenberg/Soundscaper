/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type SequenceRationalRate,
	formatSequenceTimecode,
	isSequenceDropFrameRate,
	sequenceTimecodeFromFrameCount,
} from './sequence-timecode.ts';
import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';

/**
 * CMX3600 EDL export.
 *
 * The profile scope is deliberately narrow and everything outside it is
 * reported rather than approximated, per the milestone-3 exporter rules: an
 * EDL that silently drops a speed change is worse than one that says it did.
 *
 * In scope: video and audio cut events, reel names, source and record
 * timecode, drop/non-drop signalling, and clip-name comments.
 *
 * Out of scope and itemized as omissions when present: transitions (only cuts
 * are emitted), speed changes (no M2 motion records), effects, and any track
 * beyond the flattened event list the caller supplies.
 *
 * Every timecode is produced by the shared sequence-timecode module, so a
 * label an EDL carries is the same label the editor shows. Rates stay exact
 * rationals throughout; no decimal literal is ever emitted or compared.
 */

export const EDL_REEL_LENGTH = 8;

export type EdlTrackKind = 'V' | 'A' | 'A2' | 'B';

export interface EdlEvent {
	/** Source reel/tape identity. Longer names are truncated and reported. */
	readonly reel: string;
	readonly trackKind: EdlTrackKind;
	readonly sourceInFrames: number;
	readonly sourceOutFrames: number;
	readonly recordInFrames: number;
	readonly recordOutFrames: number;
	readonly clipName?: string;
	/** Anything other than 1 cannot be expressed as a cut and is reported. */
	readonly speedRatio?: number;
	/** Present when the edit carried a transition the EDL cannot express. */
	readonly transition?: string | null;
}

export interface EdlExportRequest {
	readonly title: string;
	readonly rate: SequenceRationalRate;
	/**
	 * The sequence's drop-frame flag, not something inferred from the rate.
	 * Drop frame is a labelling rule the sequence owns; the rate only decides
	 * whether it is legal at all.
	 */
	readonly dropFrame?: boolean;
	readonly events: readonly EdlEvent[];
}

export interface EdlExportResult {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'text/plain';
	readonly report: DeliveryReport;
}

export function createEdlExport(request: EdlExportRequest): EdlExportResult {
	const title = String(request?.title ?? '').trim() || 'UNTITLED';
	const rate = request?.rate;
	if (!rate || !Number.isFinite(rate.num) || !Number.isFinite(rate.den) || rate.den <= 0) {
		throw new TypeError('An EDL export requires an exact rational sequence rate.');
	}
	const events = Array.isArray(request?.events) ? request.events : [];
	const dropFrame = Boolean(request?.dropFrame);
	if (dropFrame && !isSequenceDropFrameRate(rate)) {
		throw new RangeError(`Drop frame is illegal at ${rate.num}/${rate.den}.`);
	}
	const draft = createDeliveryReport({
		format: 'edl',
		container: 'CMX3600',
		codec: null,
		sampleRate: null,
		channelCount: null,
		lossless: null,
	});

	const lines = [
		`TITLE: ${sanitizeTitle(title)}`,
		`FCM: ${dropFrame ? 'DROP FRAME' : 'NON-DROP FRAME'}`,
	];

	let emitted = 0;
	for (const [index, event] of events.entries()) {
		const reel = normalizeReel(event?.reel, index, draft);
		const number = String(emitted + 1).padStart(3, '0');
		lines.push([
			number,
			reel.padEnd(EDL_REEL_LENGTH, ' '),
			trackKind(event?.trackKind),
			'C',
			'       ',
			timecode(event?.sourceInFrames, rate, dropFrame, `event ${index} source in`),
			timecode(event?.sourceOutFrames, rate, dropFrame, `event ${index} source out`),
			timecode(event?.recordInFrames, rate, dropFrame, `event ${index} record in`),
			timecode(event?.recordOutFrames, rate, dropFrame, `event ${index} record out`),
		].join(' '));
		const clipName = String(event?.clipName ?? '').trim();
		if (clipName) lines.push(`* FROM CLIP NAME: ${clipName}`);

		if (event?.transition) {
			addDeliveryReportItem(draft, {
				code: 'edl.transition-omitted',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'event', index },
				data: { transition: String(event.transition) },
				message: 'Only cuts are emitted; the transition was dropped.',
			});
		}
		if (event?.speedRatio != null && Number(event.speedRatio) !== 1) {
			addDeliveryReportItem(draft, {
				code: 'edl.speed-change-omitted',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'event', index },
				data: { speedRatio: Number(event.speedRatio) },
				message: 'The profile emits no motion records, so the event plays at unity speed.',
			});
		}
		emitted += 1;
	}

	addDeliveryReportItem(draft, {
		code: 'edl.events-preserved',
		disposition: 'preserved',
		severity: 'info',
		data: { events: emitted, dropFrame, rate: `${rate.num}/${rate.den}` },
	});

	return Object.freeze({
		text: `${lines.join('\n')}\n`,
		fileName: `${sanitizeFileName(title)}.edl`,
		mimeType: 'text/plain' as const,
		report: sealDeliveryReport(draft),
	});
}

function timecode(
	frames: unknown,
	rate: SequenceRationalRate,
	dropFrame: boolean,
	label: string,
): string {
	if (!Number.isSafeInteger(frames) || Number(frames) < 0) {
		throw new RangeError(`EDL ${label} must be a non-negative frame count.`);
	}
	return formatSequenceTimecode(
		sequenceTimecodeFromFrameCount(Number(frames), rate, dropFrame),
		rate,
		dropFrame,
	);
}

function trackKind(value: unknown): EdlTrackKind {
	return value === 'A' || value === 'A2' || value === 'B' ? value : 'V';
}

function normalizeReel(
	value: unknown,
	index: number,
	draft: Parameters<typeof addDeliveryReportItem>[0],
): string {
	const raw = String(value ?? '').trim().toUpperCase().replaceAll(/[^A-Z0-9_]+/gu, '_');
	const reel = raw || `REEL${index + 1}`;
	if (reel.length <= EDL_REEL_LENGTH) return reel;
	const truncated = reel.slice(0, EDL_REEL_LENGTH);
	addDeliveryReportItem(draft, {
		code: 'edl.reel-truncated',
		disposition: 'converted',
		severity: 'info',
		scope: { kind: 'event', index },
		data: { from: reel, to: truncated },
		message: `CMX3600 reels are ${EDL_REEL_LENGTH} characters.`,
	});
	return truncated;
}

function sanitizeTitle(value: string): string {
	return value.replaceAll(/[\r\n]+/gu, ' ').slice(0, 70);
}

function sanitizeFileName(value: string): string {
	return value
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 64) || 'sequence';
}
