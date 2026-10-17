/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense } from 'react';
import type { PhotoLibraryWorkflowLegacyV2, PhotoLibraryWorkflowCurrentV1 } from './use-photo-library-workflow-kernel-v1.ts';
import type { usePhotoRasterExportEntry } from './use-photo-raster-export-entry.ts';
const LegacySurface = lazy(() => import('./PhotoRasterExportSurface.tsx'));
const CurrentSurface = lazy(() => import('./PhotoRasterExportSurface.tsx').then(module => ({ default: module.PhotoRasterExportSurfaceCurrentV1 })));
interface Props {
	readonly profile: 'legacy2' | 'current3';
	readonly library: PhotoLibraryWorkflowLegacyV2 | PhotoLibraryWorkflowCurrentV1;
	readonly raster: ReturnType<typeof usePhotoRasterExportEntry>;
	readonly locale: string; readonly workingLabel: string;
}
/** The fixed App profile selects the actual selected export capabilities. */
export default function LightscaperRasterExportSurfaceV1({ profile, library, raster, locale, workingLabel }: Props) {
	const entry = raster.entry;
	if (!entry) return null;
	const common = { entry, locale, workingLabel, withOriginalFrame: library.withOriginalFrame,
		readMetadata: library.readExportMetadata, captureSidecarReader: library.captureExportSidecarReader,
		saveRuntime: library.backupSaveRuntime, preparationFailed: library.error !== null,
		registerDestination: library.registerExportDestination, captureJournal: library.captureExportJournalOpener,
		capturePresets: library.captureExportPresetsOpener, onClose: raster.close, onHide: raster.hide, onSettled: raster.settled, onPending: raster.pending };
	if (profile === 'current3') {
		const current = library as PhotoLibraryWorkflowCurrentV1;
		return <Suspense fallback={<p role="status">{workingLabel}</p>}><CurrentSurface key={entry.key} {...common}
			execute={current.executeDevelop} withDerivedFrame={current.withDerivedFrame} loadRenderer={current.loadDevelopProxyRuntime} /></Suspense>;
	}
	if (profile !== 'legacy2') throw new TypeError('Unknown photo raster export surface profile.');
	const legacy = library as PhotoLibraryWorkflowLegacyV2;
	return <Suspense fallback={<p role="status">{workingLabel}</p>}><LegacySurface key={entry.key} {...common}
		execute={legacy.executeLegacyDevelop} loadRenderer={legacy.loadDevelopProxyRuntime} /></Suspense>;
}
