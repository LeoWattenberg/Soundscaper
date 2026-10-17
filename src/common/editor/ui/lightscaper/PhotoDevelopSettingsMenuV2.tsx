/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopSettingsMenuKernelV1 from './PhotoDevelopSettingsMenuKernelV1.tsx';
import type { PhotoDevelopResolutionV1 } from '../../photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryDevelopSettingsWorkflowV2, PhotoDevelopSettingsSourceV2, PhotoDevelopSettingsWorkflowSnapshotV2 } from '../../controller/shared/photo-library-develop-settings-workflow-v2.ts';

export interface PhotoDevelopSettingsMenuPropsV2 {
	readonly locale: string; readonly owner: PhotoLibraryDevelopSettingsWorkflowV2; readonly snapshot: PhotoDevelopSettingsWorkflowSnapshotV2;
	readonly source: PhotoDevelopSettingsSourceV2; readonly selectedIds: readonly string[]; readonly disabled: boolean; readonly dirty: boolean;
	readonly isCurrent: () => boolean; readonly onChanged: () => Promise<unknown>;
	readonly resolution?: Readonly<{ value: PhotoDevelopResolutionV1; fullAvailable: boolean; onChange: (value: PhotoDevelopResolutionV1) => void }>;
	readonly repairs?: Readonly<{ available: boolean; onOpen: () => void }>;
	readonly localAdjustments?: Readonly<{ onOpen: (kind: 'linear-gradient' | 'radial-gradient' | 'luminance-range' | 'color-range' | 'brush' | 'masks') => void }>;
}
/** Permanent legacy settings and presets use the same presentation loop. */
export default function PhotoDevelopSettingsMenuV2(props: PhotoDevelopSettingsMenuPropsV2) {
	return <PhotoDevelopSettingsMenuKernelV1 {...props} profile="legacy2" />;
}
