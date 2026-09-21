/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { FREESOUND_ATTRIBUTION_ENGLISH_COPY } from '../../src/common/i18n/freesound-attribution-copy.js';

const freesoundAttribution = Object.fromEntries(Object.entries(FREESOUND_ATTRIBUTION_ENGLISH_COPY)
	.map(([key, value]) => [`ui.freesoundAttribution.${key}`, value]));

/** Build-time inventory includes copy owned by lazy surfaces without bundling it eagerly. */
export const EDITOR_COPY_AUDIT_INVENTORY = Object.freeze({
	...EDITOR_ENGLISH_COPY,
	...freesoundAttribution,
});
