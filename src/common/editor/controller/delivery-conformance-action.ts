/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectWavBlobPcm } from '../wav-import.js';
import { createDeliveryReportForPlan } from '../delivery-conversion-inventory.ts';
import { withDeliveredLoudness } from '../loudness-normalization.ts';
import type { DeliveryReport } from '../delivery-report.ts';
import {
	CONFORMANCE_READABLE_FORMATS,
	conformDeliveredAudio,
	deliveryConformanceUnverified,
	type DeliveryConformanceFinding,
	type DeliveryConformancePlan,
	type DeliveredByteSource,
} from '../delivery-conformance.ts';

/**
 * Running conformance on the delivery that just happened.
 *
 * This is not a verification mode: it runs on every delivery, from the bytes
 * that delivery produced, before anything is published. What it cannot reopen it
 * says it did not reopen — a delivery streamed straight to a destination is
 * reported unverified rather than assumed good, which keeps "we did not check"
 * and "we checked and it passed" different answers in the report.
 */

interface EncodedDelivery {
	readonly blob?: Blob | null;
	readonly bytes?: Uint8Array | null;
	readonly directDestination?: unknown;
	readonly deliveredLoudness?: Readonly<Record<string, number | null>> | null;
}

export async function conformDeliveredExport(
	plan: DeliveryConformancePlan,
	encoded: EncodedDelivery,
): Promise<readonly DeliveryConformanceFinding[]> {
	if (!CONFORMANCE_READABLE_FORMATS.includes(plan.format)) {
		return conformDeliveredAudio(plan, emptySource(), { inspect: inspectDelivered });
	}
	const source = deliveredByteSource(encoded);
	if (!source) {
		return Object.freeze([deliveryConformanceUnverified(
			plan.format,
			'it was streamed straight to its destination and never held as readable bytes',
		)]);
	}
	return conformDeliveredAudio(plan, source, {
		inspect: inspectDelivered,
		deliveredLoudness: encoded.deliveredLoudness ?? null,
	});
}

function deliveredByteSource(encoded: EncodedDelivery): DeliveredByteSource | null {
	if (encoded.bytes) {
		const bytes = encoded.bytes;
		return Object.freeze({
			size: bytes.byteLength,
			slice: (start: number, end: number) => Object.freeze({
				arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
			}),
		});
	}
	// A Blob already reads the way the inspector wants, including the temporary
	// file-backed ones a large delivery stages.
	if (encoded.blob) return encoded.blob as unknown as DeliveredByteSource;
	return null;
}

function emptySource(): DeliveredByteSource {
	return Object.freeze({
		size: 0,
		slice: () => Object.freeze({ arrayBuffer: async () => new ArrayBuffer(0) }),
	});
}

function inspectDelivered(source: DeliveredByteSource): Promise<Readonly<Record<string, unknown>>> {
	return inspectWavBlobPcm(source) as Promise<Readonly<Record<string, unknown>>>;
}

/**
 * The report a conformed delivery should now carry, or nothing to change.
 *
 * Neither the applied gain nor whether the bytes agree with the plan is
 * derivable from the plan alone, so a delivery that measured or checked itself
 * needs its report rebuilt rather than appended to — a sealed report's counts
 * have to keep agreeing with its items. Returning null when there is nothing to
 * add is what lets an ordinary delivery keep the report it was planned with.
 */
export function conformedDeliveryReport(options: Readonly<{
	plan: DeliveryConformancePlan;
	sampleRate: number;
	conformance: readonly DeliveryConformanceFinding[];
	loudness?: unknown;
	deliveredLoudness?: unknown;
}>): DeliveryReport | null {
	if (!options.loudness && options.conformance.length === 0) return null;
	return createDeliveryReportForPlan(
		options.plan as never,
		{ sampleRate: options.sampleRate },
		options.loudness
			? withDeliveredLoudness(options.loudness as never, options.deliveredLoudness as never)
			: null,
		options.conformance,
	);
}
