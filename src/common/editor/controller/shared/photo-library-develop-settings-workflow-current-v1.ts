/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoLibraryDevelopSettingsWorkflowKernelV1, type PhotoDevelopSettingsWorkflowSnapshotForProfileV1 } from './internal/photo-library-develop-settings-workflow-kernel-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from './photo-library-develop-workflow-current-v1.ts';
export type { PhotoDevelopSettingsSourceCurrentV1 } from './photo-library-develop-settings-intent-current-v1.ts';
export type PhotoDevelopSettingsWorkflowSnapshotCurrentV1 = PhotoDevelopSettingsWorkflowSnapshotForProfileV1<'current3'>;

/** Current settings preserve selected packet identity; presets remain separate. */
export class PhotoLibraryDevelopSettingsWorkflowCurrentV1 extends PhotoLibraryDevelopSettingsWorkflowKernelV1<'current3'> {
	constructor(options: Readonly<{ execute: ExecutePhotoDevelopCurrentV1; now?: () => string }>) { super('current3', options); }
}
