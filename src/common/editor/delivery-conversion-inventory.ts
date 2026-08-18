/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type LoudnessNormalizationDecision,
	loudnessDeliveryError,
} from './loudness-normalization.ts';
import {
	type DeliveryDisposition,
	type DeliveryReport,
	type DeliverySeverity,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { MEDIA_EXPORT_FORMATS, mediaExportFormatCarriesCues } from './media-export.js';
import type { DeliveryConformanceFinding } from './delivery-conformance.ts';
import { masteringSequenceDeliveryConversions } from './mastering-sequence-delivery.ts';

/**
 * What a delivery plan does to the material, derived from the plan itself.
 *
 * This is the machine side of "no hidden conversion". Because the inventory is
 * computed from the plan rather than described by whoever wrote the export
 * path, a report built through `createDeliveryReportForPlan` cannot omit a
 * conversion the plan performs — and `countUnreportedDeliveryConversions`
 * turns that into the number `delivery.unreportedConversions` gates at zero.
 *
 * A conversion is anything that makes the delivered bytes something other than
 * the rendered material: a rate change, a channel fold, quantization to an
 * integer sample format, dither, or a lossy codec. Preservation is recorded
 * too, so a report says what survived as well as what changed.
 */

export interface DeliverySourceCharacteristics {
	/** The rate the material was rendered at, which the plan's own rate is compared against. */
	readonly sampleRate: number;
}

export interface DeliveryConversion {
	readonly code: string;
	readonly disposition: DeliveryDisposition;
	readonly severity: DeliverySeverity;
	readonly data: Readonly<Record<string, unknown>>;
	/** What the conversion applies to, when it is narrower than the delivery. */
	readonly scope?: Readonly<Record<string, unknown>>;
	readonly message?: string;
}

interface AudioDeliveryPlan {
	readonly format?: unknown;
	readonly sampleRate?: unknown;
	readonly ditherMode?: unknown;
	readonly encoding?: unknown;
	readonly adm?: unknown;
	readonly markers?: unknown;
	readonly markerInterchangeReport?: unknown;
	readonly masteringSequence?: unknown;
}

/** Every conversion and preservation the plan implies, in a stable order. */
export function inventoryDeliveryConversions(
	plan: AudioDeliveryPlan,
	source: DeliverySourceCharacteristics,
): readonly DeliveryConversion[] {
	if (!isRecord(plan)) throw new TypeError('A delivery plan is required.');
	if (!isRecord(source) || !Number.isFinite(source.sampleRate) || Number(source.sampleRate) <= 0) {
		throw new TypeError('Delivery source characteristics require a positive sample rate.');
	}
	const encoding = isRecord(plan.encoding) ? plan.encoding : {};
	const descriptor = formatDescriptor(plan.format);
	const conversions: DeliveryConversion[] = [];

	const passthrough = admPassthroughMode(plan.adm);
	if (passthrough) {
		// Byte preservation is the whole contract; anything else here would be a defect.
		conversions.push({
			code: 'delivery.adm-passthrough',
			disposition: 'preserved',
			severity: 'info',
			data: { mode: passthrough },
		});
		return Object.freeze(conversions);
	}

	for (const conversion of authoredAdmConversions(plan.adm)) conversions.push(conversion);

	const outputRate = Number(plan.sampleRate);
	if (Number.isFinite(outputRate) && outputRate !== Number(source.sampleRate)) {
		conversions.push({
			code: 'delivery.resample',
			disposition: 'converted',
			severity: 'info',
			data: { fromSampleRate: Number(source.sampleRate), toSampleRate: outputRate },
		});
	}

	const mapping = isRecord(encoding.channelMapping) ? encoding.channelMapping : null;
	const inputChannelCount = numberOrNull(encoding.inputChannelCount);
	const outputChannelCount = numberOrNull(encoding.channelCount);
	const mappingMode = typeof mapping?.mode === 'string' ? mapping.mode : null;
	if ((mappingMode && mappingMode !== 'preserve')
		|| (inputChannelCount !== null && outputChannelCount !== null
			&& inputChannelCount !== outputChannelCount)) {
		conversions.push({
			code: 'delivery.channel-map',
			disposition: 'converted',
			severity: 'info',
			data: {
				mode: mappingMode,
				fromChannelCount: inputChannelCount,
				toChannelCount: outputChannelCount,
			},
		});
	}

	const sampleFormat = typeof encoding.sampleFormat === 'string' ? encoding.sampleFormat : null;
	if (sampleFormat && encoding.floatingPoint !== true) {
		conversions.push({
			code: 'delivery.quantize',
			disposition: 'converted',
			severity: 'info',
			data: { sampleFormat, bitDepth: numberOrNull(encoding.bitDepth) },
		});
	}

	const ditherMode = typeof plan.ditherMode === 'string' ? plan.ditherMode : null;
	if (ditherMode && ditherMode !== 'none') {
		conversions.push({
			code: 'delivery.dither',
			disposition: 'converted',
			severity: 'info',
			data: { mode: ditherMode },
		});
	}

	if (descriptor?.lossless === false) {
		conversions.push({
			code: 'delivery.lossy-encode',
			disposition: 'converted',
			severity: 'warning',
			data: { format: descriptor.id, codec: descriptor.codec ?? null },
		});
	} else if (descriptor && descriptor.lossless == null) {
		// Custom FFmpeg: we cannot prove losslessness, and claiming it would be a hidden conversion.
		conversions.push({
			code: 'delivery.unverified-encode',
			disposition: 'converted',
			severity: 'warning',
			data: { format: descriptor.id },
		});
	} else if (descriptor?.lossless === true) {
		conversions.push({
			code: 'delivery.lossless-encode',
			disposition: 'preserved',
			severity: 'info',
			data: { format: descriptor.id, codec: descriptor.codec ?? null },
		});
	}

	const markerCounts = interchangeCounts(plan.markerInterchangeReport);
	if (markerCounts && (markerCounts.converted > 0 || markerCounts.omitted > 0 || markerCounts.clipped > 0)) {
		conversions.push({
			code: 'delivery.marker-interchange',
			disposition: markerCounts.omitted > 0 ? 'omitted' : 'converted',
			severity: 'info',
			data: { ...markerCounts },
		});
	}

	// Markers survive selection and clipping only to be dropped by a writer that
	// has no chunk for them. That loss happens after the interchange report is
	// written, so without this the delivery reports markers it did not write.
	const plannedMarkers = Array.isArray(plan.markers) ? plan.markers.length : 0;
	const carriesCues = descriptor ? cueCapableFormat(descriptor.id) : false;
	if (plannedMarkers > 0 && !carriesCues) {
		conversions.push({
			code: 'delivery.markers-omitted',
			disposition: 'omitted',
			severity: 'warning',
			data: { markers: plannedMarkers, format: descriptor?.id ?? null },
			message: 'This format has no cue chunk, so the markers were not written into the delivery.',
		});
	}

	for (const conversion of masteringSequenceDeliveryConversions(plan.masteringSequence, carriesCues)) {
		conversions.push(conversion);
	}

	return Object.freeze(conversions);
}

/**
 * Build the sealed report for one delivered artifact. Every inventoried
 * conversion becomes an item, which is what makes hidden conversion structurally
 * impossible on this path.
 */
export function createDeliveryReportForPlan(
	plan: AudioDeliveryPlan,
	source: DeliverySourceCharacteristics,
	loudness?: LoudnessNormalizationDecision | null,
	conformance?: readonly DeliveryConformanceFinding[] | null,
): DeliveryReport {
	const descriptor = formatDescriptor(plan?.format);
	const encoding = isRecord(plan?.encoding) ? plan.encoding : {};
	const draft = createDeliveryReport({
		format: typeof plan?.format === 'string' ? plan.format : 'unknown',
		container: descriptor?.container ?? null,
		codec: descriptor?.codec ?? null,
		sampleRate: numberOrNull(plan?.sampleRate),
		channelCount: numberOrNull(encoding.channelCount),
		lossless: typeof descriptor?.lossless === 'boolean' ? descriptor.lossless : null,
	});
	for (const conversion of inventoryDeliveryConversions(plan, source)) {
		addDeliveryReportItem(draft, {
			code: conversion.code,
			disposition: conversion.disposition,
			severity: conversion.severity,
			data: conversion.data,
			...(conversion.scope ? { scope: conversion.scope } : {}),
			...(conversion.message ? { message: conversion.message } : {}),
		});
	}
	if (loudness) addDeliveryLoudnessItem(draft, loudness);
	// Conformance describes the file that was written rather than the plan that
	// wrote it, so it is passed in rather than inventoried: nothing derivable
	// from a plan could tell you whether the bytes agree with it.
	for (const finding of conformance ?? []) {
		addDeliveryReportItem(draft, {
			code: finding.code,
			disposition: finding.disposition,
			severity: finding.severity,
			data: finding.data,
			message: finding.message,
		});
	}
	return sealDeliveryReport(draft);
}

/**
 * Record what normalization did, including when it did nothing.
 *
 * Measured and post-normalization values are both carried so a reader never has
 * to work out which one they are looking at, and a delivery that ran no
 * normalization still reports its measured loudness — the report should say the
 * same kind of thing either way.
 *
 * Exported because the menu-reached loudness measurement produces the same
 * items without delivering anything: one place decides how a loudness decision
 * reads, so a measurement and a delivery never describe the same numbers
 * differently.
 */
export function addDeliveryLoudnessItem(draft: Parameters<typeof addDeliveryReportItem>[0], loudness: LoudnessNormalizationDecision): void {
	const error = loudnessDeliveryError(loudness);
	const data = {
		outcome: loudness.outcome,
		gainDb: loudness.gainDb,
		measuredLoudnessLufs: loudness.measuredLoudnessLufs,
		measuredTruePeakDb: loudness.measuredTruePeakDb,
		projectedLoudnessLufs: loudness.projectedLoudnessLufs,
		projectedTruePeakDb: loudness.projectedTruePeakDb,
		...(loudness.deliveredLoudnessLufs === null && loudness.deliveredTruePeakDb === null ? {} : {
			deliveredLoudnessLufs: loudness.deliveredLoudnessLufs,
			deliveredTruePeakDb: loudness.deliveredTruePeakDb,
			loudnessErrorLu: error.loudnessErrorLu,
			truePeakErrorDb: error.truePeakErrorDb,
		}),
		...(loudness.target ? { targetLufs: loudness.target.integratedLufs, ceilingDb: loudness.target.truePeakCeilingDb } : {}),
		...(loudness.targetShortfallLu ? { shortfallLu: loudness.targetShortfallLu } : {}),
	};
	if (error.withinTolerance === false) {
		// The delivered samples do not measure what the gain was supposed to
		// achieve. Nothing downstream can tell which value to trust, so the
		// disagreement itself is the finding.
		addDeliveryReportItem(draft, {
			code: 'delivery.loudness-delivered-mismatch',
			disposition: 'converted',
			severity: 'warning',
			data,
			message: 'The delivered file does not measure what normalization projected for it.',
		});
		return;
	}
	if (loudness.outcome === 'ceiling-limited') {
		// A delivery that did not reach its target is a warning, not a footnote:
		// the operator asked for a number and did not get it.
		addDeliveryReportItem(draft, {
			code: 'delivery.loudness-target-missed',
			disposition: 'converted',
			severity: 'warning',
			data,
			message: loudness.reason,
		});
		return;
	}
	// Keyed on the measurement rather than the outcome: a delivery that measured
	// nothing has nothing to report either way, and a loudness item holding null
	// where a number belongs reads as a value rather than as its absence.
	if (loudness.measuredLoudnessLufs === null) {
		addDeliveryReportItem(draft, {
			code: 'delivery.loudness-unmeasurable',
			disposition: 'missing',
			severity: 'warning',
			data,
			message: loudness.reason,
		});
		return;
	}
	addDeliveryReportItem(draft, {
		code: loudness.outcome === 'not-requested' ? 'delivery.loudness-measured' : 'delivery.loudness-normalized',
		disposition: loudness.outcome === 'not-requested' ? 'preserved' : 'converted',
		severity: 'info',
		data,
		message: loudness.reason,
	});
}

/**
 * How many conversions the plan performs that the report never mentions. The
 * delivery gate holds this at zero; a non-zero answer names a hidden conversion.
 */
export function countUnreportedDeliveryConversions(
	plan: AudioDeliveryPlan,
	source: DeliverySourceCharacteristics,
	report: { readonly items?: readonly { readonly code?: unknown }[] } | null | undefined,
): number {
	const reported = new Set<string>();
	for (const item of report?.items ?? []) {
		if (typeof item?.code === 'string') reported.add(item.code);
	}
	let unreported = 0;
	for (const conversion of inventoryDeliveryConversions(plan, source)) {
		if (conversion.disposition !== 'converted' && conversion.disposition !== 'omitted') continue;
		if (!reported.has(conversion.code)) unreported += 1;
	}
	return unreported;
}

function formatDescriptor(format: unknown): {
	id: string;
	container: string | null;
	codec: string | null;
	lossless: boolean | null;
} | null {
	if (typeof format !== 'string') return null;
	const descriptor = (MEDIA_EXPORT_FORMATS as Record<string, unknown>)[format];
	if (!isRecord(descriptor)) return null;
	return {
		id: typeof descriptor.id === 'string' ? descriptor.id : format,
		container: typeof descriptor.container === 'string' ? descriptor.container : null,
		codec: typeof descriptor.codec === 'string' ? descriptor.codec : null,
		lossless: typeof descriptor.lossless === 'boolean' ? descriptor.lossless : null,
	};
}

/**
 * What an authored ADM programme carried, said in the delivery's own vocabulary.
 *
 * A bed alone is the delivery that has always been available and reports
 * nothing extra. An immersive layout or a positioned object is new semantics, so
 * it is itemized: a reader that cannot resolve the file's own pack and channel
 * definitions, or that ignores objects, gets a different programme than the one
 * that was authored, and the report is where that is stated.
 */
function authoredAdmConversions(adm: unknown): readonly DeliveryConversion[] {
	if (!isRecord(adm)) return [];
	const metadata = isRecord(adm.metadata) ? adm.metadata : adm;
	if (metadata.mode !== 'authored') return [];
	const bed = isRecord(metadata.bed) ? metadata.bed : null;
	const layout = typeof bed?.layout === 'string' ? bed.layout : null;
	const objects = Array.isArray(metadata.objects) ? metadata.objects.length : 0;
	const conversions: DeliveryConversion[] = [];
	if (layout && !SHIPPED_ADM_BED_LAYOUTS.has(layout)) {
		conversions.push({
			code: 'delivery.adm-immersive-bed',
			disposition: 'preserved',
			severity: 'info',
			data: { layout },
			message: 'This bed layout is defined in the file itself rather than referenced from the common definitions, '
				+ 'so a reader that resolves only common-definition identifiers will not recognise it.',
		});
	}
	if (objects > 0) {
		conversions.push({
			code: 'delivery.adm-objects',
			disposition: 'preserved',
			severity: 'info',
			data: { objects, layout },
			message: 'Each object was delivered on its own channel with its authored position. '
				+ 'A reader that renders only the bed will play the programme without them.',
		});
	}
	return Object.freeze(conversions);
}

function admPassthroughMode(adm: unknown): string | null {
	if (!isRecord(adm)) return null;
	const metadata = isRecord(adm.metadata) ? adm.metadata : adm;
	return metadata.mode === 'passthrough' ? 'passthrough' : null;
}

const SHIPPED_ADM_BED_LAYOUTS: ReadonlySet<string> = new Set(['mono', 'stereo', '5.1']);

function cueCapableFormat(format: string): boolean {
	try {
		return mediaExportFormatCarriesCues(format);
	} catch {
		return false;
	}
}

function interchangeCounts(
	report: unknown,
): { converted: number; omitted: number; clipped: number; preserved: number } | null {
	if (!isRecord(report) || !isRecord(report.counts)) return null;
	const counts = report.counts;
	return {
		preserved: numberOrNull(counts.preserved) ?? 0,
		converted: numberOrNull(counts.converted) ?? 0,
		omitted: numberOrNull(counts.omitted) ?? 0,
		clipped: numberOrNull(counts.clipped) ?? 0,
	};
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
