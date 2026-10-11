/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoDevelopWorkspaceKernelV1 from './PhotoDevelopWorkspaceKernelV1.tsx';
import type { PhotoDevelopPreviewPropsV2 } from './PhotoDevelopPreviewV2.tsx';
import type { usePhotoDevelopSettingsV2 } from './use-photo-develop-settings-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../../photo-library-cube-lut-port-v1.ts';
export interface PhotoDevelopWorkspacePropsV2 extends Omit<PhotoDevelopPreviewPropsV2, 'develop' | 'messages' | 'maskOverlay' | 'maskOverlayMode' | 'isCurrent'> {
	readonly generation: unknown;
	readonly label: string;
	readonly execute: ExecutePhotoDevelopV2;
	readonly onClose: () => void;
	readonly beforeOpen?: Promise<void>;
	readonly registerDemandRetirement?: (retire: () => Promise<void>) => () => void;
	readonly catalogId?: string;
	readonly selectedIds?: readonly string[];
	readonly settings?: ReturnType<typeof usePhotoDevelopSettingsV2>;
	readonly importCubeLut?: PhotoLibraryCubeLutPortV1['importFile'];
}
export default function PhotoDevelopWorkspaceV2(props: PhotoDevelopWorkspacePropsV2) {
	return <PhotoDevelopWorkspaceKernelV1 {...props} profile="legacy2" />;
}
