/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../src/common/i18n/freesound-attribution-copy.js';
import { FRAMESCAPER_NATIVE_DELIVERY_ENGLISH_COPY } from '../../src/common/i18n/framescaper-native-delivery-copy.ts';
import { FRAMESCAPER_SUCCESSOR_ENGLISH_COPY } from '../../src/common/i18n/framescaper-successor-copy.ts';
import { AUDIOCOM_COPY_BY_LOCALE } from '../../src/common/i18n/audiocom-copy.ts';

const freesoundAttribution = Object.fromEntries(Object.entries(FREESOUND_ATTRIBUTION_ENGLISH_COPY)
	.map(([key, value]) => [`ui.freesoundAttribution.${key}`, value]));
const framescaperSuccessor = Object.fromEntries(Object.entries(FRAMESCAPER_SUCCESSOR_ENGLISH_COPY)
	.map(([key, value]) => [`ui.framescaperSuccessor.${key}`, value]));

/** Build-time inventory includes copy owned by lazy surfaces without bundling it eagerly. */
export const EDITOR_COPY_AUDIT_INVENTORY = Object.freeze({
	...EDITOR_ENGLISH_COPY,
	...freesoundAttribution,
	...framescaperSuccessor,
	...Object.fromEntries(Object.entries(FRAMESCAPER_NATIVE_DELIVERY_ENGLISH_COPY).map(([key, value]) => [`ui.framescaperNativeDelivery.${key}`, value])),
	...Object.fromEntries(Object.entries(AUDIOCOM_COPY_BY_LOCALE.en).map(([key, value]) => [`ui.audiocom.${key}`, value])),
});
