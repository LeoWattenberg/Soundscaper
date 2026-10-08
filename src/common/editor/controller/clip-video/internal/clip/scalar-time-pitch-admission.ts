/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../../i18n/presentation-message.ts';
import type { ClipTransformClip, ClipTransformProject } from './clip-domain-types.ts';

/** Native linked-rate playback accepts multichannel sources. Independent pitch
 * and tempo use the scalar StaffPad cache, whose admitted width is mono/stereo. */
export function assertScalarTimePitchChange(
	project: ClipTransformProject,
	clip: ClipTransformClip,
	linked: boolean,
	pitchCents: number,
	speedRatio: number,
	copy: object,
): void {
	if (linked || (pitchCents === 0 && speedRatio === 1)) return;
	const source = project.sources.find(candidate => candidate.id === clip.sourceId);
	if (typeof source?.channelCount === 'number' && source.channelCount > 2) {
		throw createLocalizedError(RangeError, copy, 'clipIndependentTimePitchChannels');
	}
}
