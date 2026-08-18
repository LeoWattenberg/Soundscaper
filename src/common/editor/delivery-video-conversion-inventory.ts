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
	readonly inputs?: unknown;
}

export interface VideoDeliverySourceCharacteristics {
	/** Whether any delivered source carried subtitle or data streams. */
	readonly hasNonMediaStreams?: boolean;
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

	const captions = isRecord(plan.captions) ? plan.captions : null;
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

	// The encoder always passes `-dn`, and passes `-sn` for every delivery that
	// carries no caption track of its own, so the stripped set depends on that
	// one decision and nothing else.
	const strippedStreams = captions?.mux === true ? 'data' : 'subtitle, data';
	conversions.push({
		code: 'delivery.streams-stripped',
		disposition: 'omitted',
		severity: source.hasNonMediaStreams ? 'warning' : 'info',
		data: { streams: strippedStreams, carriedBySource: Boolean(source.hasNonMediaStreams) },
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
