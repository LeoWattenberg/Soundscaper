/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV3, type ImageDevelopStateV3 } from './image-develop-state-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { normalizeImageDevelopRepairSpotsV1 } from './image-develop-repair-spots-v1.ts';

/** Only an explicit edit promotes old recipes; empty repairs never downgrade process3. */
export function replaceImageDevelopRepairSpotsV1(developValue: unknown, repairsValue: unknown): Readonly<ImageDevelopStateV3> {
	const develop = normalizeImageDevelopStateCurrentV1(developValue);
	const repairs = normalizeImageDevelopRepairSpotsV1(repairsValue);
	return normalizeImageDevelopStateV3({ ...develop, processVersion: 3, repairs });
}
