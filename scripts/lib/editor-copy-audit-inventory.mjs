/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../src/common/i18n/freesound-attribution-copy.js';
import { photoRawPreviewSourceCopy } from '../../src/common/i18n/lightscaper-photo-raw-preview-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoDevelopSoftProofCopy } from '../../src/common/i18n/lightscaper-develop-soft-proof-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { photoRasterProfileCopy } from '../../src/common/i18n/lightscaper-photo-raster-profile-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoExportPresetsCopy } from '../../src/common/i18n/lightscaper-photo-export-presets-copy.ts';
import { imageExportGraphicCopy } from '../../src/common/i18n/image-export-graphic-copy.ts';
import { imageExportTextCopy } from '../../src/common/i18n/image-export-text-copy.ts';
import { imageHdrMergeCopy } from '../../src/common/i18n/image-hdr-merge-copy.ts';
import { photoFramescaperHandoffCopy, photoFramescaperReceiveCopy, photoFramescaperCollectionHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel, photoFramescaperCollectionHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { AUDIOCOM_COPY_BY_LOCALE } from '../../src/common/i18n/audiocom-copy.ts';

const freesoundAttribution = Object.fromEntries(Object.entries(FREESOUND_ATTRIBUTION_ENGLISH_COPY)
	.map(([key, value]) => [`ui.freesoundAttribution.${key}`, value]));
const photoJpegExport = Object.fromEntries(Object.entries(photoJpegExportCopy('en'))
	.map(([key, value]) => [`ui.photoJpegExport.${key}`, value]));
const photoPngExport = Object.fromEntries(Object.entries(photoPngExportCopy('en'))
	.map(([key, value]) => [`ui.photoPngExport.${key}`, value]));
const imageExportGraphic = Object.fromEntries(Object.entries(imageExportGraphicCopy('en'))
	.map(([key, value]) => [`ui.imageExportGraphic.${key}`, value]));
const imageExportText = Object.fromEntries(Object.entries(imageExportTextCopy('en')).map(([key, value]) => [`ui.imageExportText.${key}`, value]));

const photoBatchMenu = Object.fromEntries(Object.entries(photoBatchExportMenuCopy('en')).map(([key, value]) => [`ui.photoBatchExportMenu.${key}`, value]));
const photoBatchExport = Object.fromEntries(Object.entries(photoBatchExportCopy('en')).map(([key, value]) => [`ui.photoBatchExport.${key}`, value]));

const photoExportPresets = Object.fromEntries(Object.entries(photoExportPresetsCopy('en')).map(([key, value]) => [`ui.photoExportPresets.${key}`, value]));
const photoFramescaperHandoff = Object.fromEntries(Object.entries(photoFramescaperHandoffCopy('en')).map(([key, value]) => [`ui.photoFramescaperHandoff.${key}`, value]));
const photoFramescaperReceive = Object.fromEntries(Object.entries(photoFramescaperReceiveCopy('en')).map(([key, value]) => [`ui.photoFramescaperReceive.${key}`, value]));
const photoFramescaperCollectionHandoff = Object.fromEntries(Object.entries(photoFramescaperCollectionHandoffCopy('en')).map(([key, value]) => [`ui.photoFramescaperCollectionHandoff.${key}`, value]));

/** Build-time inventory includes copy owned by lazy surfaces without bundling it eagerly. */
export const EDITOR_COPY_AUDIT_INVENTORY = Object.freeze({
	...EDITOR_ENGLISH_COPY,
	...freesoundAttribution,
	...photoBatchMenu,
	...photoBatchExport,
	...photoPngExport,
	...Object.fromEntries(Object.entries(photoDevelopSoftProofCopy('en')).map(([key, value]) => [`ui.photoDevelopSoftProof.${key}`, value])),
	...Object.fromEntries(Object.entries(photoDevelopPreviewRendererCopy('en')).map(([key, value]) => [`ui.photoDevelopPreviewRenderer.${key}`, value])),
	...Object.fromEntries(Object.entries(photoRasterProfileCopy('en')).map(([key, value]) => [`ui.photoRasterProfile.${key}`, value])),
	...photoJpegExport,
	...imageExportGraphic,
	...imageExportText,
	...Object.fromEntries(Object.entries(imageHdrMergeCopy('en')).map(([key, value]) => [`ui.imageHdrMerge.${key}`, value])),
	...photoExportPresets,
	...Object.fromEntries(Object.entries(photoRawPreviewSourceCopy('en')).map(([key, value]) => [`ui.photoRawPreviewSource.${key}`, value])),
	...photoFramescaperHandoff,
	...photoFramescaperReceive,
	...photoFramescaperCollectionHandoff,
	'ui.photoFramescaperHandoffMenu.download': photoFramescaperHandoffMenuLabel('en'),
	'ui.photoFramescaperHandoffMenu.receive': photoFramescaperReceiveMenuLabel('en'),
	'ui.photoFramescaperHandoffMenu.collection': photoFramescaperCollectionHandoffMenuLabel('en'),
	...Object.fromEntries(Object.entries(AUDIOCOM_COPY_BY_LOCALE.en).map(([key, value]) => [`ui.audiocom.${key}`, value])),
});
