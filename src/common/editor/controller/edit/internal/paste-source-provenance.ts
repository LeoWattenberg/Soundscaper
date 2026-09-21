/* SPDX-License-Identifier: AGPL-3.0-only */

import { deriveSourceProvenance } from '../../../source-provenance-derivation.ts';
import type { ControllerSource } from '../../track-audio/track-domain-types.ts';

/** Decorate a joined paste source with the inputs that materially contributed to it. */
export function deriveJoinedPasteSourceTemplate(
	existingSource: ControllerSource,
	pastedSource: ControllerSource,
	sampleRate: number,
): ControllerSource {
	const provenance = deriveSourceProvenance([existingSource, pastedSource]);
	return {
		...existingSource,
		sampleRate,
		...(provenance ? { provenance } : {}),
	};
}
