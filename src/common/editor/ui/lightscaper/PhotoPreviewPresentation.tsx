/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useCallback, type ReactNode } from 'react';
import type { PhotoLibraryPreviewTierV1 } from '../../photo-library-session-port-v1.ts';
import type { PixelPreviewPresentationV1, PixelPreviewPresentationSnapshotV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import { usePhotoPreviewPresentation, type PhotoPreviewPresentationOptionsV1 } from './use-photo-preview-presentation.ts';
import './photo-preview.css';

export interface PhotoPreviewPresentationViewV1 {
	readonly renderThumbnail: (photoId: string, label: string) => ReactNode;
	readonly renderLoupe: (label: string) => ReactNode;
	readonly renderFitScreen: (photoId: string, label: string) => ReactNode;
	readonly snapshot: Readonly<PixelPreviewPresentationSnapshotV1>;
}

export interface PhotoPreviewPresentationPropsV1 extends PhotoPreviewPresentationOptionsV1 {
	readonly children: (view: PhotoPreviewPresentationViewV1) => ReactNode;
}

function PreviewCanvas(props: Readonly<{ photoId: string; tier: PhotoLibraryPreviewTierV1; label: string;
	controller: PixelPreviewPresentationV1; pending: boolean; compare?: boolean }>) {
	const { photoId, tier, controller, compare } = props;
	const attach = useCallback((canvas: HTMLCanvasElement | null) => {
		if (compare) controller.attachCompare(photoId, canvas); else controller.attach(photoId, tier, canvas);
	}, [controller, photoId, tier, compare]);
	return <canvas ref={attach} width={0} height={0} className={`lightscaper-preview lightscaper-preview-${tier}`}
		role="img" aria-label={props.label} aria-busy={props.pending} />;
}

/** Lazily mounted by the View-menu owner; no session or original body enters this layer. */
export default function PhotoPreviewPresentation(props: PhotoPreviewPresentationPropsV1) {
	const { controller, snapshot } = usePhotoPreviewPresentation(props);
	const comparing = props.comparePhotoIds != null;
	const pending = (id: string, tier: PhotoLibraryPreviewTierV1) => snapshot.targets.find(target => target.photoId === id && target.tier === tier)?.status === 'pending';
	return props.children({ snapshot,
		renderThumbnail: (photoId, label) => !comparing && props.thumbnailsVisible && props.photoIds.includes(photoId)
			? <PreviewCanvas key={`thumbnail:${photoId}`} photoId={photoId} tier="thumbnail" label={label}
				controller={controller} pending={pending(photoId, 'thumbnail')} /> : null,
		renderLoupe: label => !comparing && props.fitScreenPhotoId !== null
			? <PreviewCanvas key={`fit-screen:${props.fitScreenPhotoId}`} photoId={props.fitScreenPhotoId} tier="fit-screen" label={label}
				controller={controller} pending={pending(props.fitScreenPhotoId, 'fit-screen')} /> : null,
		renderFitScreen: (photoId, label) => props.comparePhotoIds?.includes(photoId)
			? <PreviewCanvas key={`compare:${photoId}`} photoId={photoId} tier="fit-screen" label={label}
				controller={controller} pending={pending(photoId, 'fit-screen')} compare /> : null,
	});
}
