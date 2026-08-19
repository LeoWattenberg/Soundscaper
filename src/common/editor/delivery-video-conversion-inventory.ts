/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { type DeliveryConversion } from './delivery-conversion-inventory.ts';
import { VIDEO_EXPORT_FORMATS } from './video-export.js';

/**
 * What a video delivery plan does to the material.
 *
 * The video path is a separate inventory from the audio one because a video
 * plan describes a canvas and a codec pair rather than a sample format, but it
 * speaks the same report vocabulary so one renderer shows either.
 *
 * The stream-stripping item matters most here. Every video export passes `-dn`,
 * and every export that carries no caption track of its own also passes `-sn`,
 * so any subtitle or data stream a source carried is dropped. That has always
 * happened and had never been said out loud, which is precisely what the
 * delivery gate treats as a hidden omission.
 */

interface VideoDeliveryPlan {
	readonly format?: unknown;
	readonly canvas?: unknown;
	readonly codecs?: unknown;
	readonly captions?: unknown;
	readonly filterPlan?: unknown;
	readonly inputs?: unknown;
}

export interface VideoDeliverySourceCharacteristics {
	/** Whether any delivered source carried subtitle or data streams. */
	readonly hasNonMediaStreams?: boolean;
	/** The delivery target this export resolved to, when one was chosen. */
	readonly deliveryTargetId?: string | null;
	/** The target it stood in for, when that one could not be delivered. */
	readonly degradedFrom?: string | null;
	/** Which encoder produced the picture. */
	readonly videoEncoder?: 'ffmpeg' | 'webcodecs';
	/** The codec string the browser's encoder was configured with. */
	readonly videoEncoderCodec?: string | null;
	/** Why the browser's encoder was not used, when it was not. */
	readonly videoEncoderReason?: string | null;
}

export function inventoryVideoDeliveryConversions(
	plan: VideoDeliveryPlan,
	source: VideoDeliverySourceCharacteristics = {},
): readonly DeliveryConversion[] {
	if (!isRecord(plan)) throw new TypeError('A video delivery plan is required.');
	const descriptor = formatDescriptor(plan.format);
	const canvas = isRecord(plan.canvas) ? plan.canvas : {};
	const codecs = isRecord(plan.codecs) ? plan.codecs : {};
	const conversions: DeliveryConversion[] = [];

	if (descriptor) {
		// Both shipping video formats are lossy; neither can be delivered as a copy.
		conversions.push({
			code: 'delivery.video-transcode',
			disposition: 'converted',
			severity: 'warning',
			data: {
				format: descriptor.id,
				codec: typeof codecs.video === 'string' ? codecs.video : descriptor.videoCodec,
				pixelFormat: typeof canvas.pixelFormat === 'string' ? canvas.pixelFormat : null,
			},
		});
	}

	if (codecs.audio != null) {
		conversions.push({
			code: 'delivery.audio-transcode',
			disposition: 'converted',
			severity: 'warning',
			data: { codec: String(codecs.audio) },
		});
	} else if (Array.isArray(plan.inputs)
		&& plan.inputs.some((input) => isRecord(input) && input.kind === 'staged-audio-mix')) {
		conversions.push({
			code: 'delivery.audio-omitted',
			disposition: 'omitted',
			severity: 'warning',
			data: {},
		});
	}

	const width = numberOrNull(canvas.width);
	const height = numberOrNull(canvas.height);
	const frameRate = numberOrNull(canvas.frameRate);
	if (width !== null && height !== null) {
		conversions.push({
			code: 'delivery.canvas',
			disposition: 'converted',
			severity: 'info',
			data: { width, height, frameRate },
		});
	}

	const plan_ = plan as Readonly<Record<string, unknown>>;
	if (source.deliveryTargetId) {
		conversions.push({
			code: 'delivery.target',
			disposition: source.degradedFrom ? 'converted' : 'preserved',
			// A delivery that is not the one asked for is a warning even when the
			// substitute is good, because the asking is what went unanswered.
			severity: source.degradedFrom ? 'warning' : 'info',
			data: {
				target: source.deliveryTargetId,
				...(source.degradedFrom ? { requested: source.degradedFrom } : {}),
			},
		});
	}
	if (source.videoEncoder) {
		// Stated on every delivery, not only the accelerated ones: "which encoder
		// ran" is unanswerable after the fact from the file alone, and a
		// fallback with no reason is the reporting gap this milestone closes.
		conversions.push({
			code: 'delivery.encoder',
			disposition: 'preserved',
			severity: 'info',
			data: {
				encoder: source.videoEncoder,
				codec: source.videoEncoderCodec ?? null,
				reason: source.videoEncoderReason ?? null,
			},
		});
	}
	const captions = isRecord(plan_.captions) ? plan_.captions : null;
	if (captions) {
		if (captions.mux === true) {
			conversions.push({
				code: 'delivery.captions-muxed',
				disposition: 'converted',
				severity: 'info',
				data: {
					codec: String(captions.subtitleCodec ?? ''),
					trackId: String(captions.trackId ?? ''),
					cueCount: numberOrNull(captions.cueCount) ?? 0,
				},
			});
		}
		if (captions.burnIn === true) {
			const stage = isRecord(plan.filterPlan) && isRecord(plan.filterPlan.burnIn)
				? plan.filterPlan.burnIn
				: null;
			conversions.push({
				code: 'delivery.captions-burned',
				disposition: 'converted',
				// Burning in is irreversible in the delivered picture, which is a
				// stronger claim than muxing and reads as one.
				severity: 'warning',
				data: {
					trackId: String(captions.trackId ?? ''),
					cueCount: Array.isArray(stage?.cues) ? stage.cues.length : 0,
					fontSizePx: numberOrNull(stage?.fontSizePx) ?? 0,
				},
			});
			if (burnedCuesOverlap(stage)) {
				conversions.push({
					code: 'delivery.captions-overlapping',
					disposition: 'converted',
					severity: 'warning',
					data: { trackId: String(captions.trackId ?? '') },
				});
			}
		}
		if (captions.sidecarFormat != null) {
			conversions.push({
				code: 'delivery.captions-sidecar',
				disposition: 'converted',
				severity: 'info',
				data: {
					format: String(captions.sidecarFormat),
					trackId: String(captions.trackId ?? ''),
					cueCount: numberOrNull(captions.cueCount) ?? 0,
				},
			});
		}
	} else if (descriptor) {
		// A delivery that carries no captions is the norm rather than a fault, but
		// the container could have carried them, so the report says so rather than
		// leaving the reader to infer it from silence.
		conversions.push({
			code: 'delivery.captions-omitted',
			disposition: 'omitted',
			severity: 'info',
			data: { containerCanCarry: Boolean(subtitleCodec(descriptor.id)) },
		});
	}

	// Every command this product emits names its output streams with an explicit
	// `-map`, which turns automatic stream selection off: nothing from a source
	// input reaches the output except what the filter graph produced. A source's
	// own subtitle and data streams are therefore dropped by every delivery,
	// whether or not `-sn` is passed. Reading the stripped set off `-sn` told a
	// caption-carrying delivery it had kept the source's subtitles, which is the
	// hidden omission this report exists to prevent.
	conversions.push({
		code: 'delivery.streams-stripped',
		disposition: 'omitted',
		severity: source.hasNonMediaStreams ? 'warning' : 'info',
		data: { streams: 'subtitle, data', carriedBySource: Boolean(source.hasNonMediaStreams) },
	});

	return Object.freeze(conversions);
}

export function createVideoDeliveryReportForPlan(
	plan: VideoDeliveryPlan,
	source: VideoDeliverySourceCharacteristics = {},
): DeliveryReport {
	const descriptor = formatDescriptor(plan?.format);
	const canvas = isRecord(plan?.canvas) ? plan.canvas : {};
	const draft = createDeliveryReport({
		format: typeof plan?.format === 'string' ? plan.format : 'unknown',
		container: descriptor?.container ?? null,
		codec: descriptor?.videoCodec ?? null,
		sampleRate: numberOrNull(canvas.frameRate),
		channelCount: null,
		lossless: false,
	});
	for (const conversion of inventoryVideoDeliveryConversions(plan, source)) {
		addDeliveryReportItem(draft, {
			code: conversion.code,
			disposition: conversion.disposition,
			severity: conversion.severity,
			data: conversion.data,
		});
	}
	return sealDeliveryReport(draft);
}

/**
 * Whether two burned cues are on screen together, which draws one over the
 * other. Label tracks may legitimately overlap; a burned delivery cannot show
 * both, so the report says so rather than the picture quietly saying it.
 */
function burnedCuesOverlap(stage: Readonly<Record<string, unknown>> | null): boolean {
	const cues = Array.isArray(stage?.cues) ? [...(stage.cues as Record<string, unknown>[])] : [];
	cues.sort((left, right) => Number(left.startSeconds) - Number(right.startSeconds));
	return cues.some((cue, index) => index > 0 && Number(cue.startSeconds) < Number(cues[index - 1]!.endSeconds));
}

function subtitleCodec(format: string): string | null {
	const descriptor = (VIDEO_EXPORT_FORMATS as Record<string, unknown>)[format];
	if (!isRecord(descriptor)) return null;
	return typeof descriptor.subtitleCodec === 'string' ? descriptor.subtitleCodec : null;
}

function formatDescriptor(format: unknown): {
	id: string;
	container: string | null;
	videoCodec: string | null;
} | null {
	if (typeof format !== 'string') return null;
	const descriptor = (VIDEO_EXPORT_FORMATS as Record<string, unknown>)[format];
	if (!isRecord(descriptor)) return null;
	return {
		id: typeof descriptor.id === 'string' ? descriptor.id : format,
		container: typeof descriptor.container === 'string' ? descriptor.container : null,
		videoCodec: typeof descriptor.videoCodec === 'string' ? descriptor.videoCodec : null,
	};
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
