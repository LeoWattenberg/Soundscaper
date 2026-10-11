/* SPDX-License-Identifier: AGPL-3.0-only */

import MotionscaperShell from '../common/editor/ui/motionscaper/MotionscaperShell.tsx';
import { motionscaperCopy } from '../common/editor/ui/motionscaper/motionscaper-copy.ts';
import { useEffect, useMemo, useState } from 'react';
import { MOTIONSCAPER_CANONICAL_ENGLISH_COPY } from '../common/i18n/editor-motionscaper-copy.ts';
import { loadTranslationCatalog, translationCatalogLocale } from '../common/i18n/translation-catalog.js';

export interface MotionscaperBootstrapProps {
	readonly locale: string;
	readonly fallbackCopy: Readonly<Record<string, string>>;
}

/** Independent product shell with the committed translation catalog's owned labels. */
export default function MotionscaperBootstrap({ locale, fallbackCopy }: MotionscaperBootstrapProps) {
	const [translated, setTranslated] = useState<Readonly<{ locale: string; entries: Readonly<Record<string, unknown>> }> | null>(null);
	useEffect(() => {
		if (!translationCatalogLocale(locale)) return;
		let active = true;
		void loadTranslationCatalog(locale, { englishCopy: MOTIONSCAPER_CANONICAL_ENGLISH_COPY }).then((entries) => {
			if (active && entries) setTranslated({ locale, entries });
		}).catch(() => undefined);
		return () => { active = false; };
	}, [locale]);
	const copy = useMemo(() => ({ ...motionscaperCopy(locale, translated?.locale === locale ? translated.entries : {}), ...fallbackCopy }),
		[locale, fallbackCopy, translated]);
	return <MotionscaperShell locale={locale} copy={copy} />;
}
