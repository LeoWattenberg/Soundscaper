export function normalizeBcp47Locale(candidate = 'en') {
	const value = String(candidate || '').trim().replaceAll('_', '-');
	if (!value) return 'en';
	try {
		return Intl.getCanonicalLocales(value)[0] || 'en';
	} catch {
		return 'en';
	}
}

export function localeLanguage(candidate = 'en') {
	return new Intl.Locale(normalizeBcp47Locale(candidate)).language;
}

export function localizedValue(value, locale = 'en') {
	if (!value || typeof value !== 'object') return String(value ?? '');
	const normalizedLocale = normalizeBcp47Locale(locale);
	for (const key of [normalizedLocale, localeLanguage(normalizedLocale), 'en']) {
		if (!Object.hasOwn(value, key)) continue;
		const candidate = value[key];
		if (typeof candidate === 'string') return candidate;
	}
	return String(value ?? '');
}
