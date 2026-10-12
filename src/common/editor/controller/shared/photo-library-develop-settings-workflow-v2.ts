/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoLibraryDevelopSettingsWorkflowKernelV1, type PhotoDevelopSettingsWorkflowSnapshotForProfileV1 } from './internal/photo-library-develop-settings-workflow-kernel-v1.ts';
import type { ExecutePhotoDevelopV2 } from './photo-library-develop-workflow-v2.ts';
import type { PhotoDevelopSettingsSourceV2 } from './photo-library-develop-settings-intent-v2.ts';
import type { ImageDevelopSelectionV1 } from '../../imaging/image-develop-settings-contract-v1.ts';
export type { PhotoDevelopSettingsSourceV2 } from './photo-library-develop-settings-intent-v2.ts';
export type PhotoDevelopSettingsWorkflowSnapshotV2 = PhotoDevelopSettingsWorkflowSnapshotForProfileV1<'legacy2'>;

/** Permanent strict legacy settings/preset frontdoor on one shared lifecycle. */
export class PhotoLibraryDevelopSettingsWorkflowV2 extends PhotoLibraryDevelopSettingsWorkflowKernelV1<'legacy2'> {
	constructor(options: Readonly<{ execute: ExecutePhotoDevelopV2; now?: () => string; createId?: () => string }>) { super('legacy2', options); }
	listPresets(catalogId: string) { return this.listPresetsLegacy(catalogId); }
	savePreset(value: PhotoDevelopSettingsSourceV2, selection: ImageDevelopSelectionV1, name: string) { return this.savePresetLegacy(value, selection, name); }
	applyPreset(value: PhotoDevelopSettingsSourceV2, id: string, revision: number, label: string) { return this.applyPresetLegacy(value, id, revision, label); }
	renamePreset(catalogId: string, id: string, revision: number, name: string) { return this.renamePresetLegacy(catalogId, id, revision, name); }
	deletePreset(catalogId: string, id: string, revision: number) { return this.deletePresetLegacy(catalogId, id, revision); }
}
