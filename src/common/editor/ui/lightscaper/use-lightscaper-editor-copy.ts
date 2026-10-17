/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';
import { LIGHTSCAPER_EDITOR_COPY_BY_LOCALE, bundledLightscaperEditorCopyForLocale, type LightscaperEditorCopyV1 } from '../../../i18n/lightscaper-editor-copy.ts';
import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import { SITE_COPY_BY_LOCALE } from '../../../i18n/site-copy.js';
import { loadTranslationCatalog, translationCatalogLocale } from '../../../i18n/translation-catalog.js';

export type LightscaperCopyCatalogLoadersV1 = Readonly<Record<string, () => Promise<unknown>>>;
export type LightscaperEditorUiCopyV1 = LightscaperEditorCopyV1 & Readonly<{
	lightscaperTitle: string; lightscaperMetaDescription: string; photoEditor: string; workspacePhoto: string;
}>;

function brandCopy(copy: typeof SITE_COPY_BY_LOCALE.en) {
	return { lightscaperTitle: copy.lightscaperTitle, lightscaperMetaDescription: copy.lightscaperMetaDescription,
		photoEditor: copy.photoEditor, workspacePhoto: copy.workspacePhoto };
}
const ENGLISH: LightscaperEditorUiCopyV1 = Object.freeze({ ...brandCopy(SITE_COPY_BY_LOCALE.en), ...LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.en });
const GERMAN: LightscaperEditorUiCopyV1 = Object.freeze({ ...brandCopy(SITE_COPY_BY_LOCALE.de), ...LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.de });

/** The lazy photo editor requests only its own flat keys from published catalogs. */
export function useLightscaperEditorCopy(locale: string, options: Readonly<{ loaders?: LightscaperCopyCatalogLoadersV1 }> = {}): LightscaperEditorUiCopyV1 {
	const { loaders } = options;
	const bundled = bundledLightscaperEditorCopyForLocale(locale) === LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.de ? GERMAN : ENGLISH;
	const [translated, setTranslated] = useState<Readonly<{
		locale: string | null; loaders: LightscaperCopyCatalogLoadersV1 | undefined; entries: Readonly<Partial<LightscaperEditorUiCopyV1>> | null;
	}>>({ locale: null, loaders: undefined, entries: null });
	useEffect(() => {
		if (loaders ? !Object.hasOwn(loaders, normalizeBcp47Locale(locale)) : !translationCatalogLocale(locale)) return undefined;
		let active = true;
		void loadTranslationCatalog(locale, { englishCopy: ENGLISH, loaders }).then(entries => {
			if (active && entries && Object.keys(entries).length) setTranslated({ locale, loaders, entries });
		}).catch(() => {
			// A missing locale chunk leaves the bundled photo copy available.
		});
		return () => { active = false; };
	}, [locale, loaders]);
	return useMemo(() => translated.locale === locale && translated.loaders === loaders
		? Object.freeze({ ...bundled, ...translated.entries }) : bundled, [bundled, locale, loaders, translated]);
}
