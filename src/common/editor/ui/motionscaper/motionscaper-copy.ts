/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../../../i18n/video-effect-copy.js';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { localeLanguage } from '../../../i18n/locale.js';
import { bundledSiteCopyForLocale } from '../../../i18n/site-copy.js';
import { resolveMotionscaperCopy } from '../../../i18n/editor-motionscaper-copy.ts';
import { resolveMotionscaperSceneCopy } from '../../../i18n/editor-motionscaper-scene-copy.ts';
import { resolveMotionscaperAppearanceCopy } from '../../../i18n/editor-motionscaper-appearance-copy.ts';
import { resolveMotionscaperLinkCopy } from '../../../i18n/editor-motionscaper-link-copy.ts';
import { resolveMotionscaperAeCopy } from '../../../i18n/editor-motionscaper-ae-copy.ts';
import { resolveMotionscaperTrackingCopy } from '../../../i18n/editor-motionscaper-tracking-copy.ts';

/** Product command copy loads with its editor, outside every initial site graph. */
export function motionscaperCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return Object.freeze({ ...bundledSiteCopyForLocale(locale), ...resolveEditorCopyScope('editor', localeLanguage(locale) === 'de' ? VIDEO_EFFECT_COPY_BY_LOCALE.de : VIDEO_EFFECT_COPY_BY_LOCALE.en, overrides), ...resolveMotionscaperCopy(locale, overrides), ...resolveMotionscaperTrackingCopy(locale, overrides), ...resolveMotionscaperAppearanceCopy(locale, overrides), ...resolveMotionscaperSceneCopy(locale, overrides), ...resolveMotionscaperAeCopy(locale, overrides), ...resolveMotionscaperLinkCopy(locale, overrides) });
}
