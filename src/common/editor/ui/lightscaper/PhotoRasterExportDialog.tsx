/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoRasterExportDialogKernelV1 from './PhotoRasterExportDialogKernelV1.tsx';
import type { PhotoRasterExportRequest } from '../../../../lightscaper/controller/photo-raster-export.ts';
import type { PhotoLibraryExportPresetsPortV1, PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { ReadPhotoExportSidecar } from '../../photo-library-session-port-v2.ts';
import type { ExecutePhotoDevelopCurrent } from './photo-library-workflow-develop.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../photo-library-develop-original-current-v1.ts';

export interface PhotoRasterExportDialogProps {
	readonly format: 'png' | 'jpeg';
	readonly encode: PhotoRasterExportRequest['encode'];
	readonly copy: PhotoRasterExportCopy;
	readonly locale: string;
	readonly photoId: string;
	readonly fileName: string;
	readonly execute: ExecutePhotoDevelopCurrent;
	readonly withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly captureSidecarReader?: () => ReadPhotoExportSidecar;
	readonly readMetadata?: PhotoRasterExportRequest['readMetadata'];
	readonly withGraphicFrame?: PhotoRasterExportRequest['withGraphicFrame'];
	readonly withTextFrame?: PhotoRasterExportRequest['withTextFrame'];
	readonly loadRenderer: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly preparationFailed: boolean;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
	readonly capturePresets?: () => PhotoLibraryExportPresetsPortV1['open'];
	readonly initialPreset?: PhotoRasterExportPresetV1;
	readonly onApplyPreset?: (preset: PhotoRasterExportPresetV1) => void;
	readonly visible?: boolean;
	readonly onHide?: () => void;
	readonly onClose: () => void;
}
export interface PhotoRasterExportCopy {
	readonly title: string; readonly description: string; readonly save: string; readonly close: string;
	readonly preparing: string; readonly working: string; readonly saved: string; readonly downloadStarted: string;
	readonly cancelled: string; readonly failed: string; readonly summary: string; readonly fileType: string;
	readonly outputSize: string; readonly originalSize: string; readonly fitSize: string; readonly longEdgeSize: string;
	readonly megapixelsSize: string; readonly percentageSize: string; readonly width: string; readonly height: string;
	readonly pixels: string; readonly megapixels: string; readonly percentage: string; readonly allowUpscale: string;
	readonly resample: string; readonly nearest: string; readonly bilinear: string; readonly filenameTemplate: string;
	readonly filenameHelp: string; readonly invalidSettings: string;
	readonly metadata: string; readonly stripMetadata: string; readonly captureMetadata: string; readonly metadataHelp: string; readonly metadataFailed: string;
	readonly sidecar: string; readonly sidecarHelp: string; readonly sidecarSaved: string; readonly sidecarPartial: string; readonly sidecarRetry: string;
	readonly outputSharpen: string; readonly sharpenAmount: string; readonly sharpenThreshold: string;
}
export interface PhotoRasterExportDialogPropsCurrentV1 extends Omit<PhotoRasterExportDialogProps, 'execute' | 'loadRenderer'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
	readonly loadRenderer: LoadPhotoLibraryDevelopProxyRuntimeCurrentV1;
	readonly withDerivedFrame?: PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'];
}
export default function PhotoRasterExportDialog(props: PhotoRasterExportDialogProps) {
	return <PhotoRasterExportDialogKernelV1 {...props} profile="legacy2" />;
}
export function PhotoRasterExportDialogCurrentV1(props: PhotoRasterExportDialogPropsCurrentV1) {
	return <PhotoRasterExportDialogKernelV1 {...props} profile="current3" />;
}
