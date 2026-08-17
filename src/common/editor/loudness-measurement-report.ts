/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryLoudnessItem } from './delivery-conversion-inventory.ts';
import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import { computeLoudnessNormalization } from './loudness-normalization.ts';

/**
 * Measuring the loudness of a mix or a selection, on demand.
 *
 * `measureBextLoudness` has existed since broadcast delivery landed but could
 * only ever be reached as a BEXT capture flag, which meant the only way to learn
 * a mix's loudness was to deliver it as a Broadcast WAV. This gives it a
 * surface: measure what is selected, or the whole mix when nothing is, and say
 * the answer in the delivery report vocabulary.
 *
 * **It renders through the same offline render an analysis uses**, so the
 * numbers describe the mix as it would be delivered rather than as a second
 * render path imagines it. Nothing here writes a file and nothing here applies
 * a gain — a measurement that quietly changed the project would be the worst
 * possible behaviour for a command whose entire job is to tell the truth about
 * what is already there.
 *
 * The result is a sealed report rather than a bespoke result type because the
 * report is the surface an operator already reads for delivery facts. Its
 * subject says `loudness-measurement`, so nothing mistakes it for a delivery
 * that happened.
 */

export interface LoudnessMeasurementRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * Which range a measurement is about.
 *
 * A selection is what the operator is looking at, so it wins when there is one;
 * otherwise the answer is about the whole mix. An empty selection is not a
 * selection — measuring nothing because a stray click collapsed the range would
 * answer a question nobody asked.
 */
export function loudnessMeasurementScope(
	selection: LoudnessMeasurementRange | null | undefined,
): 'project' | 'selection' {
	return selection && selection.endFrame > selection.startFrame ? 'selection' : 'project';
}

/** The measurement as a sealed report, built from the same items a delivery uses. */
export function createLoudnessMeasurementReport(request: Readonly<{
	measurement: Parameters<typeof computeLoudnessNormalization>[0];
	sampleRate: number;
	channelCount: number;
	range: LoudnessMeasurementRange;
	scope: 'project' | 'selection';
}>): DeliveryReport {
	const draft = createDeliveryReport({
		format: 'loudness-measurement',
		container: null,
		codec: null,
		sampleRate: request.sampleRate,
		channelCount: request.channelCount,
		lossless: null,
	});
	addDeliveryReportItem(draft, {
		code: 'loudness.measured-range',
		disposition: 'preserved',
		severity: 'info',
		data: {
			scope: request.scope,
			startFrame: request.range.startFrame,
			endFrame: request.range.endFrame,
			durationFrames: request.range.endFrame - request.range.startFrame,
		},
		message: request.scope === 'selection'
			? 'The selection was measured; the rest of the project was not.'
			: 'The whole mix was measured.',
	});
	// No target, so the decision reports the measurement unchanged. Measuring
	// must never propose a gain: what a delivery would do about the number is
	// the delivery's decision to make and to report.
	addDeliveryLoudnessItem(draft, computeLoudnessNormalization(request.measurement, null));
	return sealDeliveryReport(draft);
}
