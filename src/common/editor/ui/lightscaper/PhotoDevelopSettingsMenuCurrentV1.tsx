/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopSettingsMenuKernelV1 from './PhotoDevelopSettingsMenuKernelV1.tsx';
import type { PhotoDevelopSettingsMenuPropsV2 } from './PhotoDevelopSettingsMenuV2.tsx';
import type { PhotoLibraryDevelopSettingsWorkflowCurrentV1, PhotoDevelopSettingsSourceCurrentV1, PhotoDevelopSettingsWorkflowSnapshotCurrentV1 } from '../../controller/shared/photo-library-develop-settings-workflow-current-v1.ts';

export interface PhotoDevelopSettingsMenuPropsCurrentV1 extends Omit<PhotoDevelopSettingsMenuPropsV2, 'owner' | 'snapshot' | 'source'> {
	readonly owner: PhotoLibraryDevelopSettingsWorkflowCurrentV1;
	readonly snapshot: PhotoDevelopSettingsWorkflowSnapshotCurrentV1;
	readonly source: PhotoDevelopSettingsSourceCurrentV1;
	readonly withWritePreviewRetirement: (run: () => Promise<unknown>, isCurrent: () => boolean) => Promise<unknown>;
	readonly rawDevelopment?: Readonly<{ onOpen: () => void }>;
	readonly softProof?: Readonly<{ onOpen: () => void }>;
}
/** Explicit menu activation for complete Current settings; no legacy preset cap. */
export default function PhotoDevelopSettingsMenuCurrentV1(props: PhotoDevelopSettingsMenuPropsCurrentV1) {
	return <PhotoDevelopSettingsMenuKernelV1 {...props} profile="current3" />;
}
