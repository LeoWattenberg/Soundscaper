/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoRasterBatchExportDialogKernelV1 from './PhotoRasterBatchExportDialogKernelV1.tsx';
import type { PhotoRasterBatchSelection } from '../../../../lightscaper/controller/photo-raster-export-batch-selection.ts';
import type { PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
import type { PhotoRasterExportDialogProps, PhotoRasterExportDialogPropsCurrentV1 } from './PhotoRasterExportDialog.tsx';

type Ports = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose' | 'withTextFrame'>;
export interface PhotoRasterBatchExportDialogProps extends Ports {
	readonly selection: readonly Readonly<PhotoRasterBatchSelection>[]; readonly batchId: string;
	readonly captureJournal: () => PhotoLibraryExportJournalPort['open'];
	readonly visible: boolean; readonly onHide: () => void; readonly onSettled: () => void;
}
export interface PhotoRasterBatchExportDialogPropsCurrentV1 extends Omit<PhotoRasterBatchExportDialogProps, 'execute' | 'loadRenderer'> {
	readonly onPending?: () => void;
	readonly execute: PhotoRasterExportDialogPropsCurrentV1['execute'];
	readonly loadRenderer: PhotoRasterExportDialogPropsCurrentV1['loadRenderer'];
}
export default function PhotoRasterBatchExportDialog(props: PhotoRasterBatchExportDialogProps) {
	return <PhotoRasterBatchExportDialogKernelV1 {...props} profile="legacy2" />;
}
export function PhotoRasterBatchExportDialogCurrentV1(props: PhotoRasterBatchExportDialogPropsCurrentV1) {
	return <PhotoRasterBatchExportDialogKernelV1 {...props} profile="current3" />;
}
