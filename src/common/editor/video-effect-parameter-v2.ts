/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV1 } from './video-curve-types-v1.ts';
import type { VideoCubeLutReferenceV1 } from './video-color-cube-lut-v27.ts';

/** Explicit successor vocabulary, not generic record admission. The owning
 * LUT profile alone may admit ref/null; legacy numeric/curve families and
 * their V1 leaf/state/preset contracts are unchanged until consumer opt-in. */
export type VideoEffectParameterV2 = VideoEffectParameterV1 | Readonly<VideoCubeLutReferenceV1> | null;
