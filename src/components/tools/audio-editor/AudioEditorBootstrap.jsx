import { useEffect, useState } from 'react';

import { resolveCatalog } from '../../../i18n/runtime.js';
import AudioEditorApp from './AudioEditorApp.jsx';

export default function AudioEditorBootstrap({ locale, fallbackCopy }) {
	const [copy, setCopy] = useState(() => locale === 'en' ? fallbackCopy : null);

	useEffect(() => {
		if (copy) return undefined;
		const controller = new AbortController();
		resolveCatalog(locale, { signal: controller.signal }).then((resolvedCopy) => {
			if (!controller.signal.aborted) setCopy(resolvedCopy);
		});
		return () => controller.abort();
	}, [copy, locale]);

	if (!copy) {
		return <div role="status" aria-live="polite">{fallbackCopy.loading}</div>;
	}
	return <AudioEditorApp locale={locale} copy={copy} />;
}
