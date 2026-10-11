/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useRef, useState } from 'react';
import type { PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { PhotoRasterExportEntry } from './use-photo-raster-export-entry.ts';
import type { PhotoRasterExportDialogProps } from './PhotoRasterExportDialog.tsx';
import type { PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
const PhotoPngExportDialog = lazy(() => import('./PhotoPngExportDialog.tsx'));
const PhotoJpegExportDialog = lazy(() => import('./PhotoJpegExportDialog.tsx'));
const PhotoRasterBatchExportDialog = lazy(() => import('./PhotoRasterBatchExportDialog.tsx'));
type Ports = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose' | 'visible' | 'onHide'>;
export default function PhotoRasterExportSurface(props: Ports & {
	readonly entry: PhotoRasterExportEntry;
	readonly captureJournal: () => PhotoLibraryExportJournalPort['open'];
	readonly workingLabel: string;
	readonly onClose: () => void; readonly onHide: () => void; readonly onSettled: () => void;
}) {
	const latest = useRef(props); latest.current = props;
	const rendered = {}, presentation = useRef(rendered); presentation.current = rendered;
	const { entry, workingLabel, onHide, onSettled, ...ports } = props;
	const [applied, setApplied] = useState<Readonly<{ preset: PhotoRasterExportPresetV1; serial: number }> | null>(null);
	if (entry.mode === 'batch') return <Suspense fallback={entry.visible ? <p role="status">{workingLabel}</p> : null}>
		<PhotoRasterBatchExportDialog {...ports} key={entry.key} selection={entry.selection} batchId={entry.key}
			visible={entry.visible} onHide={onHide} onSettled={onSettled} />
	</Suspense>;
	const Dialog = (applied?.preset.format ?? entry.format) === 'png' ? PhotoPngExportDialog : PhotoJpegExportDialog;
	return <Suspense fallback={entry.visible ? <p role="status">{workingLabel}</p> : null}><Dialog {...ports} key={`${entry.key}:${applied?.serial ?? 0}`} photoId={entry.photoId} fileName={entry.fileName}
		visible={entry.visible} onHide={onHide} initialPreset={applied?.preset} onApplyPreset={preset => {
			if (presentation.current !== rendered || latest.current !== props || latest.current.entry !== entry || !entry.visible) return;
			setApplied(previous => ({ preset, serial: (previous?.serial ?? 0) + 1 }));
		}} /></Suspense>;
}
