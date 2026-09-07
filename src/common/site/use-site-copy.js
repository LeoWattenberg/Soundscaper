/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';

import { SITE_COPY_BY_LOCALE, bundledSiteCopyForLocale } from '../i18n/site-copy.js';
import { loadTranslationCatalog, translationCatalogLocale } from '../i18n/translation-catalog.js';

/**
 * The site's own copy for a locale. The first paint uses the bundled English
 * or German, because the shell never waits on a chunk to draw; for a locale a
 * translation catalog serves, that catalog's site strings replace them once
 * its chunk has arrived. A chunk that never arrives leaves the bundled copy
 * in place. The editor resolves its own, complete catalog separately in its
 * bootstrap.
 */
export function useSiteCopy(locale) {
	const bundled = bundledSiteCopyForLocale(locale);
	const [translated, setTranslated] = useState({ locale: null, entries: null });
	useEffect(() => {
		if (!translationCatalogLocale(locale)) return undefined;
		let active = true;
		loadTranslationCatalog(locale, { englishCopy: SITE_COPY_BY_LOCALE.en })
			.then((entries) => {
				if (active && entries && Object.keys(entries).length) setTranslated({ locale, entries });
			})
			.catch(() => {
				// The bundled copy stays; the editor bootstrap reports its own catalog failures.
			});
		return () => { active = false; };
	}, [locale]);
	return useMemo(
		() => (translated.locale === locale ? Object.freeze({ ...bundled, ...translated.entries }) : bundled),
		[bundled, locale, translated],
	);
}
