/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoLibraryDevelopSettingsWorkflowKernelV1, type PhotoDevelopSettingsWorkflowSnapshotForProfileV1 } from './internal/photo-library-develop-settings-workflow-kernel-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from './photo-library-develop-workflow-current-v1.ts';
import type { PhotoDevelopSettingsSourceCurrentV1 } from './photo-library-develop-settings-intent-current-v1.ts';
import type { ImageDevelopSelectionV3 } from '../../imaging/image-develop-settings-contract-v3.ts';
export type { PhotoDevelopSettingsSourceCurrentV1 } from './photo-library-develop-settings-intent-current-v1.ts';
export type PhotoDevelopSettingsWorkflowSnapshotCurrentV1 = PhotoDevelopSettingsWorkflowSnapshotForProfileV1<'current3'>;

/** Current settings and presets borrow the actual selected native Session. */
export class PhotoLibraryDevelopSettingsWorkflowCurrentV1 extends PhotoLibraryDevelopSettingsWorkflowKernelV1<'current3'> {
	constructor(options: Readonly<{ execute: ExecutePhotoDevelopCurrentV1; now?: () => string; createId?: () => string }>) { super('current3', options); }
	listPresets(catalogId: string) { return this.listPresetsCurrent(catalogId); }
	savePreset(source: PhotoDevelopSettingsSourceCurrentV1, selection: ImageDevelopSelectionV3, name: string) { return this.savePresetCurrent(source, selection, name); }
	applyPreset(source: PhotoDevelopSettingsSourceCurrentV1, presetId: string, revision: number, label: string) { return this.applyPresetCurrent(source, presetId, revision, label); }
	renamePreset(catalogId: string, presetId: string, revision: number, name: string) { return this.renamePresetCurrent(catalogId, presetId, revision, name); }
	deletePreset(catalogId: string, presetId: string, revision: number) { return this.deletePresetCurrent(catalogId, presetId, revision); }
}
