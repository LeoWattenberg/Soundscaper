/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';
import PhotoImportDialogV2, { type PhotoImportDialogPropsV2 } from './PhotoImportDialogV2.tsx';
import PhotoImportDialogCurrentV1 from './PhotoImportDialogCurrentV1.tsx';
import type { PhotoLibraryWorkflowKernelV1 } from './use-photo-library-workflow-kernel-v1.ts';

interface Props extends Omit<PhotoImportDialogPropsV2, 'onImport' | 'readDevelopPresets'> {
	readonly profile: 'legacy2' | 'current3';
	readonly onImport: PhotoLibraryWorkflowKernelV1['importFiles'];
	readonly readDevelopPresets: PhotoLibraryWorkflowKernelV1['readImportDevelopPresets'];
}
/** Keep the fixed import dialogs at the selected product generation boundary. */
export default function LightscaperPhotoImportSurfaceV1({ profile, readDevelopPresets, ...props }: Props) {
	const readLegacy = useCallback(async (options?: Readonly<{ signal?: AbortSignal }>) => {
		const snapshot = await readDevelopPresets(options);
		if (snapshot.schemaVersion !== 2) throw new RangeError('Unsupported legacy import preset snapshot.');
		return snapshot;
	}, [readDevelopPresets]);
	const readCurrent = useCallback(async (options?: Readonly<{ signal?: AbortSignal }>) => {
		const snapshot = await readDevelopPresets(options);
		if (snapshot.schemaVersion !== 3) throw new RangeError('Unsupported Current import preset snapshot.');
		return snapshot;
	}, [readDevelopPresets]);
	if (profile === 'current3') return <PhotoImportDialogCurrentV1 {...props} readDevelopPresets={readCurrent} />;
	if (profile === 'legacy2') return <PhotoImportDialogV2 {...props} readDevelopPresets={readLegacy} />;
	throw new TypeError('Unknown fixed import surface profile.');
}
