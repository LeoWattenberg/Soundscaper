/* SPDX-License-Identifier: AGPL-3.0-only */
import { collectCubeLutProjectResourcesForProfileV1 } from './internal/video-cube-lut-project-references-kernel-v1.ts';

/** Current scalar custody closes every declared recipe input, including unused bodies. */
export function collectFramescaperImageProjectResourcesCurrentV1(value: unknown) {
	return collectCubeLutProjectResourcesForProfileV1('current3', value);
}
export function collectCubeLutProfileProjectReferencesCurrentV1(value: unknown) {
	return collectFramescaperImageProjectResourcesCurrentV1(value).luts;
}
