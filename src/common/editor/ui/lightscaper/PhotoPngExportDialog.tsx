/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoRasterExportDialog, { PhotoRasterExportDialogCurrentV1, type PhotoRasterExportDialogProps, type PhotoRasterExportDialogPropsCurrentV1 } from './PhotoRasterExportDialog.tsx';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';
import { photoPngExportCopy } from '../../../i18n/lightscaper-photo-png-export-copy.ts';
import { encodePhotoPngCurrentV1 } from './photo-png-export-encoder-current-v1.ts';

export type PhotoPngExportDialogProps = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy'>;
export type PhotoPngExportDialogPropsCurrentV1 = Omit<PhotoRasterExportDialogPropsCurrentV1, 'format' | 'encode' | 'copy'>;
export default function PhotoPngExportDialog(props: PhotoPngExportDialogProps) {
	return <PhotoRasterExportDialog {...props} format="png" encode={encodePixelFramePngV1} copy={photoPngExportCopy(props.locale)} />;
}
export function PhotoPngExportDialogCurrentV1(props: PhotoPngExportDialogPropsCurrentV1) {
	return <PhotoRasterExportDialogCurrentV1 {...props} format="png" encode={encodePhotoPngCurrentV1} copy={photoPngExportCopy(props.locale)} />;
}
