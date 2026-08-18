/* SPDX-License-Identifier: AGPL-3.0-only */

import { sameBextMetadata } from './adm-riff-passthrough.ts';
import type { DeliveryDisposition, DeliverySeverity } from './delivery-report.ts';

/**
 * Reopening a delivered master and checking it against the plan that made it.
 *
 * **Conformance reads produced bytes back; it never trusts the writer.** Every
 * value below comes from the ordinary WAV reader — the same one that imports a
 * file somebody else wrote — so a writer that got its own header wrong cannot
 * agree with itself into a pass. That is the whole point: a delivery is correct
 * when the file says so, not when the encoder does.
 *
 * A failure here is a failed delivery, not a footnote. The findings are reported
 * either way, so a delivery that conformed says which checks it passed rather
 * than saying nothing at all.
 */

export interface DeliveryConformanceFinding {
	readonly code: string;
	readonly disposition: DeliveryDisposition;
	readonly severity: DeliverySeverity;
	readonly data: Readonly<Record<string, unknown>>;
	readonly message: string;
}

export class DeliveryConformanceError extends Error {
	readonly findings: readonly DeliveryConformanceFinding[];

	constructor(findings: readonly DeliveryConformanceFinding[]) {
		super(findings.find((finding) => finding.severity === 'error')?.message
			?? 'The delivered file does not conform to its plan.');
		this.name = 'DeliveryConformanceError';
		this.findings = Object.freeze([...findings]);
	}
}

/** The bytes a delivery produced, as the reader needs to see them. */
export interface DeliveredByteSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface DeliveryConformancePlan {
	readonly format: string;
	readonly outputFrames: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly encoding?: Readonly<Record<string, unknown>>;
	readonly bext?: Readonly<Record<string, unknown>> | null;
	readonly markers?: readonly Readonly<{ sampleOffset: number }>[];
	readonly adm?: unknown;
}

export interface DeliveryConformanceOptions {
	/** The reader that reopens the produced bytes; injected so nothing here owns format knowledge. */
	readonly inspect: (
		source: DeliveredByteSource,
	) => Promise<Readonly<Record<string, unknown>>>;
	/** Loudness measured from the delivery, when it was captured. */
	readonly deliveredLoudness?: Readonly<Record<string, number | null>> | null;
}

/** Formats whose containers this can reopen. Anything else is reported unverified, never assumed good. */
export const CONFORMANCE_READABLE_FORMATS: readonly string[] = Object.freeze(['wav', 'bwf', 'bw64']);

/** Reopen the delivery and compare it with the plan. Never throws on a mismatch — it reports one. */
export async function conformDeliveredAudio(
	plan: DeliveryConformancePlan,
	source: DeliveredByteSource,
	options: DeliveryConformanceOptions,
): Promise<readonly DeliveryConformanceFinding[]> {
	if (!CONFORMANCE_READABLE_FORMATS.includes(plan.format)) {
		return Object.freeze([unverified(plan.format, 'this delivery format has no reader that could reopen it')]);
	}
	let descriptor: Readonly<Record<string, unknown>>;
	try {
		descriptor = await options.inspect(source);
	} catch (error) {
		// A master that cannot be reopened at all is the most severe outcome
		// there is: nothing downstream can read what was just written.
		return Object.freeze([{
			code: 'delivery.conformance-unreadable',
			disposition: 'missing',
			severity: 'error',
			data: { format: plan.format, reason: message(error) },
			message: `The delivered file could not be reopened: ${message(error)}`,
		}]);
	}

	const findings: DeliveryConformanceFinding[] = [
		compare('delivery.conformance-duration', 'outputFrames', plan.outputFrames, descriptor.frameCount, {
			errorSamples: errorMagnitude(plan.outputFrames, descriptor.frameCount),
		}),
		compare('delivery.conformance-channel-count', 'channelCount', plan.channelCount, descriptor.channelCount),
		compare('delivery.conformance-sample-rate', 'sampleRate', plan.sampleRate, descriptor.sampleRate),
	];
	const sampleFormat = plan.encoding?.sampleFormat;
	if (typeof sampleFormat === 'string') {
		findings.push(compare('delivery.conformance-sample-format', 'sampleFormat', sampleFormat, descriptor.sampleFormat));
	}
	findings.push(channelMapFinding(descriptor));
	if (plan.bext) findings.push(bextFinding(plan.bext, descriptor.bext));
	const plannedMarkers = plan.markers ?? [];
	if (plannedMarkers.length > 0) findings.push(markerFinding(plannedMarkers, descriptor.markers));
	if (plan.format === 'bw64') findings.push(admFinding(descriptor.adm));
	if (options.deliveredLoudness) {
		findings.push(loudnessFinding(options.deliveredLoudness, descriptor.bext));
	}
	return Object.freeze(findings);
}

/** Turn a conformance failure into a failed delivery. Warnings and passes go through. */
export function assertDeliveryConformance(
	findings: readonly DeliveryConformanceFinding[],
): void {
	if (findings.some((finding) => finding.severity === 'error')) {
		throw new DeliveryConformanceError(findings);
	}
}

function compare(
	code: string,
	field: string,
	expected: unknown,
	actual: unknown,
	extra: Readonly<Record<string, unknown>> = {},
): DeliveryConformanceFinding {
	const conformed = expected === actual;
	return Object.freeze({
		code,
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ field, expected, actual, ...extra }),
		message: conformed
			? `The delivered ${field} is ${String(actual)}, as planned.`
			: `The delivered ${field} is ${String(actual)}, not the planned ${String(expected)}.`,
	});
}

function errorMagnitude(expected: unknown, actual: unknown): number | null {
	return typeof expected === 'number' && typeof actual === 'number' ? Math.abs(expected - actual) : null;
}

/**
 * The channel map has to describe exactly the channels the file declares.
 *
 * A mask naming more or fewer speakers than there are channels is a file that
 * plays back into the wrong outputs — silently, which is why it is checked
 * rather than assumed from the channel count that produced it.
 */
function channelMapFinding(descriptor: Readonly<Record<string, unknown>>): DeliveryConformanceFinding {
	const mask = Number(descriptor.channelMask ?? 0);
	const channelCount = Number(descriptor.channelCount ?? 0);
	const named = popcount(mask);
	const conformed = mask === 0 || named === channelCount;
	return Object.freeze({
		code: 'delivery.conformance-channel-map',
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ channelMask: mask, namedChannels: named, channelCount, channelMapErrors: conformed ? 0 : 1 }),
		message: conformed
			? 'The delivered channel map names exactly the channels the file carries.'
			: `The delivered channel map names ${named} channels for a ${channelCount}-channel file.`,
	});
}

function bextFinding(
	planned: Readonly<Record<string, unknown>>,
	actual: unknown,
): DeliveryConformanceFinding {
	// Compared through the same equality the passthrough contract uses, so
	// "the same BEXT" means one thing product-wide.
	const conformed = Boolean(actual) && sameBextMetadata(planned as never, actual as never);
	return Object.freeze({
		code: 'delivery.conformance-bext',
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ present: Boolean(actual) }),
		message: conformed
			? 'The broadcast metadata reopened as it was written.'
			: actual
				? 'The broadcast metadata in the delivered file differs from the metadata the plan wrote.'
				: 'The delivered file carries no broadcast metadata, though the plan wrote some.',
	});
}

function markerFinding(
	planned: readonly Readonly<{ sampleOffset: number }>[],
	actual: unknown,
): DeliveryConformanceFinding {
	const markers = Array.isArray(actual) ? actual as readonly Readonly<{ sampleOffset?: unknown }>[] : [];
	const conformed = markers.length === planned.length
		&& planned.every((marker, index) => markers[index]?.sampleOffset === marker.sampleOffset);
	return Object.freeze({
		code: 'delivery.conformance-markers',
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ expected: planned.length, actual: markers.length }),
		message: conformed
			? 'Every cue reopened at the sample it was written at.'
			: 'The cues in the delivered file are not the cues the plan wrote.',
	});
}

function admFinding(actual: unknown): DeliveryConformanceFinding {
	const conformed = Boolean(actual);
	return Object.freeze({
		code: 'delivery.conformance-adm',
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ present: conformed }),
		message: conformed
			? 'The ADM metadata reopened from the delivered file.'
			: 'The delivered BW64 file carries no readable ADM metadata.',
	});
}

/**
 * The loudness stamped in the file has to be the loudness that was measured.
 *
 * A file whose BEXT claims a different number from the one the report carries
 * sends every downstream check to the wrong value, so the disagreement is the
 * finding — this does not pick a winner.
 */
function loudnessFinding(
	delivered: Readonly<Record<string, number | null>>,
	actual: unknown,
): DeliveryConformanceFinding {
	const stamped = (actual ?? {}) as Readonly<Record<string, unknown>>;
	const fields = ['loudnessValue', 'loudnessRange', 'maxTruePeakLevel', 'maxMomentaryLoudness', 'maxShortTermLoudness'];
	const mismatched = fields.filter((field) => (
		delivered[field] !== undefined && delivered[field] !== null && stamped[field] !== delivered[field]
	));
	const conformed = Boolean(actual) && mismatched.length === 0;
	return Object.freeze({
		code: 'delivery.conformance-loudness',
		disposition: conformed ? 'preserved' : 'missing',
		severity: conformed ? 'info' : 'error',
		data: Object.freeze({ mismatched: Object.freeze(mismatched), measured: delivered }),
		message: conformed
			? 'The loudness stamped in the delivered file is the loudness that was measured.'
			: 'The loudness stamped in the delivered file is not the loudness that was measured.',
	});
}

function unverified(format: string, reason: string): DeliveryConformanceFinding {
	return Object.freeze({
		code: 'delivery.conformance-unverified',
		disposition: 'omitted',
		severity: 'warning',
		data: Object.freeze({ format, reason }),
		message: `The delivered file was not reopened and checked, because ${reason}.`,
	});
}

/** Exported so the export path can report an unverified delivery without inventing a second vocabulary. */
export function deliveryConformanceUnverified(
	format: string,
	reason: string,
): DeliveryConformanceFinding {
	return unverified(format, reason);
}

function popcount(value: number): number {
	let bits = value >>> 0;
	let count = 0;
	while (bits) {
		count += bits & 1;
		bits >>>= 1;
	}
	return count;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
