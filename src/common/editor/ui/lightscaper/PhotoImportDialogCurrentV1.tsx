/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportGestureReceiptV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoImportDialogPropsV2 } from './PhotoImportDialogV2.tsx';
import type { PhotoImportDevelopPresetsPropsCurrentV1 } from './PhotoImportDevelopPresetsCurrentV1.tsx';
import type { PhotoLibraryImportGestureOptionsCurrentV1 } from './photo-library-workflow-import-current-v1.ts';
import PhotoImportDialogKernelV1 from './internal/PhotoImportDialogKernelV1.tsx';

export interface PhotoImportDialogPropsCurrentV1 extends Omit<PhotoImportDialogPropsV2, 'readDevelopPresets' | 'onImport'> {
	readonly readDevelopPresets?: PhotoImportDevelopPresetsPropsCurrentV1['readPresets'];
	readonly onImport: (files: readonly File[], options?: PhotoLibraryImportGestureOptionsCurrentV1) => Promise<PhotoLibraryImportGestureReceiptV1>;
}
/** Current preset choices share the existing opted-in File/Import dialog. */
export default function PhotoImportDialogCurrentV1(props: PhotoImportDialogPropsCurrentV1) {
	return <PhotoImportDialogKernelV1 {...props} profile="current3" />;
}
