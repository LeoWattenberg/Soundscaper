/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useRef, useState } from 'react';
import type { PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { PhotoRasterExportEntry } from './use-photo-raster-export-entry.ts';
import type { PhotoRasterExportDialogProps, PhotoRasterExportDialogPropsCurrentV1 } from './PhotoRasterExportDialog.tsx';
import type { PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
const PhotoPngExportDialog = lazy(() => import('./PhotoPngExportDialog.tsx'));
const PhotoJpegExportDialog = lazy(() => import('./PhotoJpegExportDialog.tsx'));
const PhotoRasterBatchExportDialog = lazy(() => import('./PhotoRasterBatchExportDialog.tsx'));
const CurrentPng = lazy(() => import('./PhotoPngExportDialog.tsx').then(module => ({ default: module.PhotoPngExportDialogCurrentV1 })));
const CurrentJpeg = lazy(() => import('./PhotoJpegExportDialog.tsx').then(module => ({ default: module.PhotoJpegExportDialogCurrentV1 })));
const CurrentBatch = lazy(() => import('./PhotoRasterBatchExportDialog.tsx').then(module => ({ default: module.PhotoRasterBatchExportDialogCurrentV1 })));
type Omitted = 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose' | 'visible' | 'onHide';
interface Presentation {
	readonly entry: PhotoRasterExportEntry;
	readonly captureJournal: () => PhotoLibraryExportJournalPort['open'];
	readonly workingLabel: string;
	readonly onClose: () => void; readonly onHide: () => void; readonly onSettled: () => void;
	readonly onPending?: () => void;
}
export type PhotoRasterExportSurfaceProps = Omit<PhotoRasterExportDialogProps, Omitted> & Presentation;
export type PhotoRasterExportSurfacePropsCurrentV1 = Omit<PhotoRasterExportDialogPropsCurrentV1, Omitted> & Presentation;
type Props = (PhotoRasterExportSurfaceProps & { readonly profile: 'legacy2' })
	| (PhotoRasterExportSurfacePropsCurrentV1 & { readonly profile: 'current3' });
function Surface(props: Props) {
	const latest = useRef(props); latest.current = props;
	const rendered = {}, presentation = useRef(rendered); presentation.current = rendered;
	const { entry, workingLabel, onHide, onSettled } = props;
	const [applied, setApplied] = useState<Readonly<{ preset: PhotoRasterExportPresetV1; serial: number }> | null>(null);
	if (entry.mode === 'batch') return <Suspense fallback={entry.visible ? <p role="status">{workingLabel}</p> : null}>
		{props.profile === 'current3' ? <CurrentBatch {...props} key={entry.key} selection={entry.selection} batchId={entry.key}
			visible={entry.visible} onHide={onHide} onSettled={onSettled} /> : <PhotoRasterBatchExportDialog {...props} key={entry.key} selection={entry.selection} batchId={entry.key}
			visible={entry.visible} onHide={onHide} onSettled={onSettled} />}
	</Suspense>;
	const key = `${entry.key}:${applied?.serial ?? 0}`;
	const shared = { photoId: entry.photoId, fileName: entry.fileName,
		visible: entry.visible, onHide, initialPreset: applied?.preset, onApplyPreset: (preset: PhotoRasterExportPresetV1) => {
			if (presentation.current !== rendered || latest.current !== props || latest.current.entry !== entry || !entry.visible) return;
			setApplied(previous => ({ preset, serial: (previous?.serial ?? 0) + 1 }));
		} };
	const format = applied?.preset.format ?? entry.format;
	const dialog = props.profile === 'current3'
		? format === 'png' ? <CurrentPng key={key} {...props} {...shared} /> : <CurrentJpeg key={key} {...props} {...shared} />
		: format === 'png' ? <PhotoPngExportDialog key={key} {...props} {...shared} /> : <PhotoJpegExportDialog key={key} {...props} {...shared} />;
	return <Suspense fallback={entry.visible ? <p role="status">{workingLabel}</p> : null}>{dialog}</Suspense>;
}
export default function PhotoRasterExportSurface(props: PhotoRasterExportSurfaceProps) {
	return <Surface {...props} profile="legacy2" />;
}
export function PhotoRasterExportSurfaceCurrentV1(props: PhotoRasterExportSurfacePropsCurrentV1) {
	return <Surface {...props} profile="current3" />;
}
