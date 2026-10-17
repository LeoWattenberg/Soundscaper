/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from './motion-asset.ts';
import type { MotionComposition } from './motion-composition.ts';
import type { MotionAeProjectCustody } from './motion-ae-project-custody.ts';

export interface MotionscaperProject {
	readonly schemaFamily: 'motionscaper'; readonly schemaVersion: 1;
	readonly id: string; readonly title: string; readonly revision: number; readonly sampleRate: number;
	readonly primaryCompositionId: string; readonly compositions: readonly MotionComposition[];
	readonly assets: readonly MotionAsset[];
	readonly interchangeCustody?: MotionAeProjectCustody;
}
