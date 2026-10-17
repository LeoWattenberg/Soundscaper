/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV2 } from './video-effect-parameter-v2.ts';

/** Explicit successor leaf. Each family still owns closed parameter admission;
 * existing numeric/curve leaves and their V1 consumers are unchanged. */
export interface VideoEffectLeafV2 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly enabled: boolean;
	readonly params: Readonly<Record<string, VideoEffectParameterV2>>;
}
