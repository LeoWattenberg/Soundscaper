/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoRasterExportDialog, { PhotoRasterExportDialogCurrentV1, type PhotoRasterExportDialogProps, type PhotoRasterExportDialogPropsCurrentV1 } from './PhotoRasterExportDialog.tsx';
import { encodePixelFrameJpegV1 } from '../../imaging/pixel-frame-jpeg-v1.ts';
import { photoJpegExportCopy } from '../../../i18n/lightscaper-photo-jpeg-export-copy.ts';

export type PhotoJpegExportDialogProps = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy'>;
export type PhotoJpegExportDialogPropsCurrentV1 = Omit<PhotoRasterExportDialogPropsCurrentV1, 'format' | 'encode' | 'copy'>;
export default function PhotoJpegExportDialog(props: PhotoJpegExportDialogProps) {
	return <PhotoRasterExportDialog {...props} format="jpeg" encode={(frame, options) => encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 })}
		copy={photoJpegExportCopy(props.locale)} />;
}
export function PhotoJpegExportDialogCurrentV1(props: PhotoJpegExportDialogPropsCurrentV1) {
	return <PhotoRasterExportDialogCurrentV1 {...props} format="jpeg" encode={(frame, options) => encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 })}
		copy={photoJpegExportCopy(props.locale)} />;
}
