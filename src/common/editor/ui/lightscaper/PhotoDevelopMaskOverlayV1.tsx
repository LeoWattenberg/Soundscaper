/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RefObject } from 'react';
import type { PhotoDevelopPresentationSnapshotV2 } from '../../controller/shared/photo-library-develop-presentation-v2.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../../i18n/lightscaper-develop-local-adjustments-copy.ts';

export interface PhotoDevelopMaskOverlayPropsV1 {
	readonly canvasRef: RefObject<HTMLCanvasElement | null>;
	readonly state: PhotoDevelopPresentationSnapshotV2['status'];
	readonly locale: string;
}
/** The presentation owner paints and retires this target with the After image. */
export default function PhotoDevelopMaskOverlayV1(props: PhotoDevelopMaskOverlayPropsV1) {
	const text = photoDevelopLocalAdjustmentsCopy(props.locale);
	return <canvas ref={props.canvasRef} width={0} height={0} role="img" aria-label={text.maskOverlay} data-photo-develop-mask-overlay data-state={props.state}
		className="lightscaper-develop-mask-overlay" hidden={props.state !== 'ready'} />;
}
