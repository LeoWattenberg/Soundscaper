/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState } from 'react';
import { PixelPreviewPresentationV1, type PixelPreviewPresentationReaderV1,
	type PixelPreviewPresentationSnapshotV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';

export interface PhotoPreviewPresentationOptionsV1 {
	readonly readPreview: PixelPreviewPresentationReaderV1;
	readonly photoIds: readonly string[];
	readonly thumbnailsVisible: boolean;
	readonly fitScreenPhotoId: string | null;
}

/** React observes scalar state; the controller owns cancellation, staging and target backing. */
export function usePhotoPreviewPresentation(options: PhotoPreviewPresentationOptionsV1) {
	const owner = useRef<PixelPreviewPresentationV1 | null>(null);
	owner.current ??= new PixelPreviewPresentationV1();
	const controller = owner.current;
	const [snapshot, setSnapshot] = useState<Readonly<PixelPreviewPresentationSnapshotV1>>(() => controller.snapshot());
	const { readPreview, thumbnailsVisible, fitScreenPhotoId } = options;
	const ids = JSON.stringify(options.photoIds);
	useLayoutEffect(() => {
		const unsubscribe = controller.subscribe(setSnapshot);
		controller.setView({ readPreview, photoIds: JSON.parse(ids) as string[], thumbnailsVisible, fitScreenPhotoId });
		return () => {
			unsubscribe();
			// Pause reuses the same joined owner during StrictMode's effect replay.
			void controller.pause();
		};
	}, [controller, readPreview, ids, thumbnailsVisible, fitScreenPhotoId]);
	return { controller, snapshot };
}
