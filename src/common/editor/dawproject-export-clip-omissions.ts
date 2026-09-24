/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem } from './delivery-report.ts';
import {
	type DataRecord,
	type DawprojectExportContext,
	finite,
	records,
} from './dawproject-export-context.ts';

/** Report clip edits that DAWproject's clip vocabulary cannot reproduce. */
export function reportOmittedClipFeatures(
	clip: DataRecord,
	clipId: string,
	stretched: boolean,
	context: DawprojectExportContext,
): void {
	const features: string[] = [];
	if (finite(clip.gain, 1) !== 1) features.push('gain');
	if (records(clip.envelope).length > 0) features.push('envelope');
	if (finite(clip.fadeInFrames, 0) > 0 && finite(clip.fadeInShape, 1) !== 1) features.push('fadeInShape');
	if (finite(clip.fadeOutFrames, 0) > 0 && finite(clip.fadeOutShape, 1) !== 1) features.push('fadeOutShape');
	if (finite(clip.pitchCents, 0) !== 0) features.push('pitchCents');
	if (clip.reversed === true) features.push('reversed');
	if (clip.preserveFormants === true && stretched) features.push('preserveFormants');
	if (features.length === 0) return;
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.clip-features-omitted',
		disposition: 'omitted',
		severity: 'warning',
		scope: { kind: 'clip', id: clipId },
		data: { features },
		message: 'A DAWproject clip carries fade durations and warping but no fade curve shape, gain, envelope, pitch shift, reverse, or formant setting; the clip is written without them.',
	});
}
