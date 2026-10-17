/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageBrushMaskAuthoringOptionsV1, ImageBrushMaskAuthoringOwnerV1 } from '../../controller/shared/image-brush-mask-authoring-v1.ts';
import { PhotoLibraryBrushMaskAuthoringV1, preparePhotoLibraryBrushMaskAcknowledgementV1 } from '../../controller/shared/photo-library-brush-mask-authoring-v1.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1, PhotoLibraryDevelopMaskRasterAcknowledgementV1 } from '../../photo-library-develop-mask-raster-port-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../../imaging/image-develop-state-current-v1.ts';
import type { PhotoDevelopMaskOverlaySelectionV1 } from './PhotoDevelopGradientDialogV1.tsx';
import ImageBrushMaskEditorV1 from '../dialogs/ImageBrushMaskEditorV1.tsx';

export interface PhotoDevelopBrushMaskDialogPropsV1 {
	readonly port: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly locale: string;
	readonly disabled?: boolean;
	readonly isCurrent: () => boolean;
	readonly onApply: (value: ImageDevelopStateCurrentV1, overlay: Readonly<PhotoDevelopMaskOverlaySelectionV1> | null) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
function createAuthoring(options: ImageBrushMaskAuthoringOptionsV1<PhotoLibraryDevelopMaskRasterAcknowledgementV1>): ImageBrushMaskAuthoringOwnerV1<PhotoLibraryDevelopMaskRasterAcknowledgementV1> {
	return new PhotoLibraryBrushMaskAuthoringV1({ port: options.port, isCurrent: options.isCurrent, signal: options.signal });
}
/** Permanent Photo entry point keeps its strict owner and post-Apply overlay. */
export default function PhotoDevelopBrushMaskDialogV1(props: PhotoDevelopBrushMaskDialogPropsV1) {
	return <ImageBrushMaskEditorV1 {...props} createAuthoring={createAuthoring} prepareAcknowledgement={preparePhotoLibraryBrushMaskAcknowledgementV1}
		onApply={(value, choice) => { Reflect.apply(props.onApply, props, [value, choice]); }}
		onClose={() => { Reflect.apply(props.onClose, props, []); }} />;
}
