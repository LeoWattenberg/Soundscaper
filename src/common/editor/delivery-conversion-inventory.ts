/* SPDX-License-Identifier: AGPL-3.0-only */

import { type LoudnessNormalizationDecision } from './loudness-normalization.ts';
import {
	type DeliveryDisposition,
	type DeliveryReport,
	type DeliverySeverity,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { MEDIA_EXPORT_FORMATS } from './media-export.js';

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
}

interface AudioDeliveryPlan {
	readonly format?: unknown;
	readonly sampleRate?: unknown;
	readonly ditherMode?: unknown;
	readonly encoding?: unknown;
	readonly adm?: unknown;
	readonly markerInterchangeReport?: unknown;
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
		});
	}
	if (loudness) addLoudnessItem(draft, loudness);
	return sealDeliveryReport(draft);
}

/**
 * Record what normalization did, including when it did nothing.
 *
 * Measured and post-normalization values are both carried so a reader never has
 * to work out which one they are looking at, and a delivery that ran no
 * normalization still reports its measured loudness — the report should say the
 * same kind of thing either way.
 */
function addLoudnessItem(draft: Parameters<typeof addDeliveryReportItem>[0], loudness: LoudnessNormalizationDecision): void {
	const data = {
		outcome: loudness.outcome,
		gainDb: loudness.gainDb,
		measuredLoudnessLufs: loudness.measuredLoudnessLufs,
		measuredTruePeakDb: loudness.measuredTruePeakDb,
		projectedLoudnessLufs: loudness.projectedLoudnessLufs,
		projectedTruePeakDb: loudness.projectedTruePeakDb,
		...(loudness.target ? { targetLufs: loudness.target.integratedLufs, ceilingDb: loudness.target.truePeakCeilingDb } : {}),
		...(loudness.targetShortfallLu ? { shortfallLu: loudness.targetShortfallLu } : {}),
	};
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
	if (loudness.outcome === 'unmeasurable') {
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

function admPassthroughMode(adm: unknown): string | null {
	if (!isRecord(adm)) return null;
	const metadata = isRecord(adm.metadata) ? adm.metadata : adm;
	return metadata.mode === 'passthrough' ? 'passthrough' : null;
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
