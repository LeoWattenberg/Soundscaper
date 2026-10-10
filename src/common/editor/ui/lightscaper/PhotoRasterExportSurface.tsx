/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense } from 'react';
import type { PhotoRasterExportEntry } from './use-photo-raster-export-entry.ts';
import type { PhotoRasterExportDialogProps } from './PhotoRasterExportDialog.tsx';
const PhotoPngExportDialog = lazy(() => import('./PhotoPngExportDialog.tsx'));
const PhotoJpegExportDialog = lazy(() => import('./PhotoJpegExportDialog.tsx'));
const PhotoRasterBatchExportDialog = lazy(() => import('./PhotoRasterBatchExportDialog.tsx'));
type Ports = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose'>;
export default function PhotoRasterExportSurface(props: Ports & {
	readonly entry: PhotoRasterExportEntry;
	readonly workingLabel: string;
	readonly onClose: () => void; readonly onHide: () => void; readonly onSettled: () => void;
}) {
	const { entry, workingLabel, onHide, onSettled, ...ports } = props;
	if (entry.mode === 'batch') return <Suspense fallback={entry.visible ? <p role="status">{workingLabel}</p> : null}>
		<PhotoRasterBatchExportDialog {...ports} key={entry.key} selection={entry.selection} batchId={entry.key}
			visible={entry.visible} onHide={onHide} onSettled={onSettled} />
	</Suspense>;
	const Dialog = entry.format === 'png' ? PhotoPngExportDialog : PhotoJpegExportDialog;
	return <Suspense fallback={<p role="status">{workingLabel}</p>}><Dialog {...ports} key={entry.key} photoId={entry.photoId} fileName={entry.fileName} /></Suspense>;
}
