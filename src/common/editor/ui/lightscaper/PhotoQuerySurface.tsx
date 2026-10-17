/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useMemo } from 'react';
import type { LoadPhotoMetadataQueryRuntimeV2 } from '../../photo-library-query-port-v2.ts';
import PhotoQueryDialog, { type PhotoQueryDialogPropsV1 } from './PhotoQueryDialog.tsx';

type DialogProps = Omit<PhotoQueryDialogPropsV1, 'metadataColumns' | 'normalizeMetadataPredicate'>;
export interface PhotoQuerySurfaceProps extends DialogProps { readonly loadMetadataQueryRuntime: LoadPhotoMetadataQueryRuntimeV2 }

/** A product injects its pure predicate registry after the existing menu opens. */
export default function PhotoQuerySurface({ loadMetadataQueryRuntime, ...props }: PhotoQuerySurfaceProps) {
	const ReadyDialog = useMemo(() => lazy(async () => {
		const runtime = await loadMetadataQueryRuntime();
		return { default: (dialog: DialogProps) => <PhotoQueryDialog {...dialog} metadataColumns={runtime.columns}
			normalizeMetadataPredicate={runtime.normalizePredicate} /> };
	}), [loadMetadataQueryRuntime]);
	return <Suspense fallback={<p role="status">{props.copy.photoWorking}</p>}><ReadyDialog {...props} /></Suspense>;
}
