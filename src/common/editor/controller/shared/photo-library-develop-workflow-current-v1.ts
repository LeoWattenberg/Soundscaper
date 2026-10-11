/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectParameterV2 } from '../../video-effect-parameter-v2.ts';
import type { VideoEffectLeafV2 } from '../../video-effect-leaf-v2.ts';
import { PhotoLibraryDevelopWorkflowKernelV1, type PhotoDevelopExecutionContextForProfileV1,
	type ExecutePhotoDevelopForProfileV1, type PhotoDevelopWorkflowSnapshotForProfileV1 } from './internal/photo-library-develop-workflow-kernel-v1.ts';

export type PhotoDevelopExecutionContextCurrentV1 = PhotoDevelopExecutionContextForProfileV1<'current3'>;
export type ExecutePhotoDevelopCurrentV1 = ExecutePhotoDevelopForProfileV1<'current3'>;
export type PhotoDevelopWorkflowSnapshotCurrentV1 = PhotoDevelopWorkflowSnapshotForProfileV1<'current3'>;
/** The existing effects editors need only this scalar gesture capability. */
export interface PhotoDevelopEffectsAuthoringPortV1 {
	snapshot(): Readonly<{ draft: Readonly<{ effects: readonly VideoEffectLeafV2[] }> | null }>;
	setEffects(value: readonly VideoEffectLeafV2[]): void;
	beginGesture(): void;
	previewEffect(id: string, params: Readonly<Record<string, VideoEffectParameterV2>>): void;
	commitGesture(): void;
	cancelGesture(): void;
}
/** Current scalar edits retain complete repair metadata under the existing writer. */
export class PhotoLibraryDevelopWorkflowCurrentV1 extends PhotoLibraryDevelopWorkflowKernelV1<'current3'> implements PhotoDevelopEffectsAuthoringPortV1 {
	constructor(options: Readonly<{ execute: ExecutePhotoDevelopCurrentV1; now?: () => string }>) { super('current3', options); }
}
