/* SPDX-License-Identifier: AGPL-3.0-only */
import { collectCubeLutProjectResourcesForProfileV1 } from './internal/video-cube-lut-project-references-kernel-v1.ts';

/** Permanent Source1/2 scalar collector; no successor source admission is inherited. */
export function collectCubeLutProfileProjectReferencesV1(value: unknown) {
	return collectCubeLutProjectResourcesForProfileV1('legacy2', value).luts;
}
