/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoLibraryDevelopWorkflowKernelV1, type PhotoDevelopExecutionContextForProfileV1,
	type ExecutePhotoDevelopForProfileV1, type PhotoDevelopWorkflowSnapshotForProfileV1 } from './internal/photo-library-develop-workflow-kernel-v1.ts';

export type PhotoDevelopExecutionContextV2 = PhotoDevelopExecutionContextForProfileV1<'legacy2'>;
export type ExecutePhotoDevelopV2 = ExecutePhotoDevelopForProfileV1<'legacy2'>;
export type PhotoDevelopWorkflowSnapshotV2 = PhotoDevelopWorkflowSnapshotForProfileV1<'legacy2'>;
/** Permanent strict process1/2 owner under the shared scalar coordinator. */
export class PhotoLibraryDevelopWorkflowV2 extends PhotoLibraryDevelopWorkflowKernelV1<'legacy2'> {
	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV2; now?: () => string }>) { super('legacy2', options); }
}
