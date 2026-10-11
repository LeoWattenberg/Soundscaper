/* SPDX-License-Identifier: AGPL-3.0-only */

import { bundledSiteCopyForLocale } from '../../../i18n/site-copy.js';
import { resolveMotionscaperCopy } from '../../../i18n/editor-motionscaper-copy.ts';
import { resolveMotionscaperTrackingCopy } from '../../../i18n/editor-motionscaper-tracking-copy.ts';

/** Product command copy loads with its editor, outside every initial site graph. */
export function motionscaperCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return Object.freeze({ ...bundledSiteCopyForLocale(locale), ...resolveMotionscaperCopy(locale, overrides), ...resolveMotionscaperTrackingCopy(locale, overrides) });
}
