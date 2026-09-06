/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';

import { loadMachineCatalog, machineCatalogLocale } from '../i18n/machine-catalog.js';
import { SITE_COPY_BY_LOCALE, bundledSiteCopyForLocale } from '../i18n/site-copy.js';

/**
 * The site's own copy for a locale. The first paint uses the bundled English
 * or German, because the shell never waits on a chunk to draw; for a locale a
 * machine catalog serves, that catalog's site strings replace them once its
 * chunk has arrived. A chunk that never arrives leaves the bundled copy in
 * place. The editor resolves its own, complete catalog separately in its
 * bootstrap, Audacity's reviewed strings included.
 */
export function useSiteCopy(locale) {
	const bundled = bundledSiteCopyForLocale(locale);
	const [machine, setMachine] = useState({ locale: null, entries: null });
	useEffect(() => {
		if (!machineCatalogLocale(locale)) return undefined;
		let active = true;
		loadMachineCatalog(locale, { englishCopy: SITE_COPY_BY_LOCALE.en })
			.then((entries) => {
				if (active && entries && Object.keys(entries).length) setMachine({ locale, entries });
			})
			.catch(() => {
				// The bundled copy stays; the editor bootstrap reports its own catalog failures.
			});
		return () => { active = false; };
	}, [locale]);
	return useMemo(
		() => (machine.locale === locale ? Object.freeze({ ...bundled, ...machine.entries }) : bundled),
		[bundled, locale, machine],
	);
}
