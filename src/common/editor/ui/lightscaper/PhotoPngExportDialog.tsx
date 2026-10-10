/* SPDX-License-Identifier: AGPL-3.0-only */

import PhotoRasterExportDialog, { type PhotoRasterExportDialogProps } from './PhotoRasterExportDialog.tsx';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';
import { photoPngExportCopy } from '../../../i18n/lightscaper-photo-png-export-copy.ts';

export type PhotoPngExportDialogProps = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy'>;
export default function PhotoPngExportDialog(props: PhotoPngExportDialogProps) {
	return <PhotoRasterExportDialog {...props} format="png" encode={encodePixelFramePngV1} copy={photoPngExportCopy(props.locale)} />;
}
