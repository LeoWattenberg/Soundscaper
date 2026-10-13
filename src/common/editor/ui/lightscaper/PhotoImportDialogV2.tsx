/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportGestureReceiptV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoImportOptionsCopyV1 } from './PhotoImportOptions.tsx';
import type { PhotoImportPresetControlsPropsV1, PhotoImportPresetCopyV1 } from './PhotoImportPresetControls.tsx';
import type { PhotoImportKeywordOptionsPropsV1, PhotoImportKeywordCopyV1 } from './PhotoImportKeywordOptions.tsx';
import type { PhotoImportDevelopPresetsPropsV2 } from './PhotoImportDevelopPresetsV2.tsx';
import type { PhotoLibraryImportGestureOptionsV2 } from './photo-library-workflow-import-v2.ts';

import PhotoImportDialogKernelV1 from './internal/PhotoImportDialogKernelV1.tsx';

export interface PhotoImportDialogPropsV2 {
	readonly locale?: string;
	readonly title: string;
	readonly filesLabel: string;
	readonly importLabel: string;
	readonly cancelLabel: string;
	readonly failureLabel: string;
	readonly busy: boolean;
	readonly error: string | null;
	readonly copy: PhotoImportOptionsCopyV1 & PhotoImportPresetCopyV1 & PhotoImportKeywordCopyV1;
	readonly readPresets: PhotoImportPresetControlsPropsV1['readPresets'];
	readonly readDevelopPresets?: PhotoImportDevelopPresetsPropsV2['readPresets'];
	readonly applyPreset: PhotoImportPresetControlsPropsV1['applyPreset'];
	readonly createId: PhotoImportPresetControlsPropsV1['createId'];
	readonly readDefinitions: PhotoImportKeywordOptionsPropsV1['readDefinitions'];
	readonly readDefinition: PhotoImportKeywordOptionsPropsV1['readDefinition'];
	readonly definitionReader: PhotoImportKeywordOptionsPropsV1['definitionReader'];
	readonly onClose: () => void;
	readonly onImport: (files: readonly File[], options?: PhotoLibraryImportGestureOptionsV2) => Promise<PhotoLibraryImportGestureReceiptV1>;
}
/** The permanent V2 dialog captures only schema2 Develop import identities. */
export default function PhotoImportDialogV2(props: PhotoImportDialogPropsV2) {
	return <PhotoImportDialogKernelV1 {...props} profile="legacy2" />;
}
