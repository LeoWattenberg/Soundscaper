/**
 * Locale identities known to the Audacity 4 Qt translation artifact.
 *
 * `audacityCode` is the exact suffix used by `audacity_<code>.ts`. `locale` is
 * the canonical BCP-47 route and manifest key used by Soundscaper. Keep the
 * full upstream set here even though only audited locales are placed in
 * `ROUTE_LOCALES`.
 */
export const AUDACITY_LOCALE_SUPERSET = deepFreeze([
	{ locale: 'af', audacityCode: 'af', nativeName: 'Afrikaans', direction: 'ltr' },
	{ locale: 'ar', audacityCode: 'ar', nativeName: 'العربية', direction: 'rtl' },
	{ locale: 'be', audacityCode: 'be', nativeName: 'Беларуская', direction: 'ltr' },
	{ locale: 'bg', audacityCode: 'bg', nativeName: 'Български', direction: 'ltr' },
	{ locale: 'bn', audacityCode: 'bn', nativeName: 'বাংলা', direction: 'ltr' },
	{ locale: 'bs', audacityCode: 'bs', nativeName: 'Bosanski', direction: 'ltr' },
	{ locale: 'ca', audacityCode: 'ca', nativeName: 'Català', direction: 'ltr' },
	{ locale: 'ca-ES-valencia', audacityCode: 'ca@valencia', nativeName: 'Valencià', direction: 'ltr' },
	{ locale: 'co', audacityCode: 'co', nativeName: 'Corsu', direction: 'ltr' },
	{ locale: 'cs', audacityCode: 'cs', nativeName: 'Čeština', direction: 'ltr' },
	{ locale: 'cy', audacityCode: 'cy', nativeName: 'Cymraeg', direction: 'ltr' },
	{ locale: 'da', audacityCode: 'da', nativeName: 'Dansk', direction: 'ltr' },
	{ locale: 'de', audacityCode: 'de', nativeName: 'Deutsch', direction: 'ltr' },
	{ locale: 'el', audacityCode: 'el', nativeName: 'Ελληνικά', direction: 'ltr' },
	{ locale: 'en', audacityCode: 'en', nativeName: 'English', direction: 'ltr' },
	{ locale: 'en-GB', audacityCode: 'en_GB', nativeName: 'English (UK)', direction: 'ltr' },
	{ locale: 'es', audacityCode: 'es', nativeName: 'Español', direction: 'ltr' },
	{ locale: 'et', audacityCode: 'et', nativeName: 'Eesti', direction: 'ltr' },
	{ locale: 'eu', audacityCode: 'eu', nativeName: 'Euskara', direction: 'ltr' },
	{ locale: 'fa', audacityCode: 'fa', nativeName: 'فارسی', direction: 'rtl' },
	{ locale: 'fi', audacityCode: 'fi', nativeName: 'Suomi', direction: 'ltr' },
	{ locale: 'fr', audacityCode: 'fr', nativeName: 'Français', direction: 'ltr' },
	{ locale: 'ga', audacityCode: 'ga', nativeName: 'Gaeilge', direction: 'ltr' },
	{ locale: 'gl', audacityCode: 'gl', nativeName: 'Galego', direction: 'ltr' },
	{ locale: 'he', audacityCode: 'he', nativeName: 'עברית', direction: 'rtl' },
	{ locale: 'hi', audacityCode: 'hi', nativeName: 'हिन्दी', direction: 'ltr' },
	{ locale: 'hr', audacityCode: 'hr', nativeName: 'Hrvatski', direction: 'ltr' },
	{ locale: 'hu', audacityCode: 'hu', nativeName: 'Magyar', direction: 'ltr' },
	{ locale: 'hy', audacityCode: 'hy', nativeName: 'Հայերեն', direction: 'ltr' },
	{ locale: 'id', audacityCode: 'id', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
	{ locale: 'it', audacityCode: 'it', nativeName: 'Italiano', direction: 'ltr' },
	{ locale: 'ja', audacityCode: 'ja', nativeName: '日本語', direction: 'ltr' },
	{ locale: 'ka', audacityCode: 'ka', nativeName: 'ქართული', direction: 'ltr' },
	{ locale: 'km', audacityCode: 'km', nativeName: 'ខ្មែរ', direction: 'ltr' },
	{ locale: 'ko', audacityCode: 'ko', nativeName: '한국어', direction: 'ltr' },
	{ locale: 'lt', audacityCode: 'lt', nativeName: 'Lietuvių', direction: 'ltr' },
	{ locale: 'mk', audacityCode: 'mk', nativeName: 'Македонски', direction: 'ltr' },
	{ locale: 'mr', audacityCode: 'mr', nativeName: 'मराठी', direction: 'ltr' },
	{ locale: 'my', audacityCode: 'my', nativeName: 'မြန်မာ', direction: 'ltr' },
	{ locale: 'nb', audacityCode: 'nb', nativeName: 'Norsk bokmål', direction: 'ltr' },
	{ locale: 'nl', audacityCode: 'nl', nativeName: 'Nederlands', direction: 'ltr' },
	{ locale: 'oc', audacityCode: 'oc', nativeName: 'Occitan', direction: 'ltr' },
	{ locale: 'pl', audacityCode: 'pl', nativeName: 'Polski', direction: 'ltr' },
	{ locale: 'pt-BR', audacityCode: 'pt_BR', nativeName: 'Português (Brasil)', direction: 'ltr' },
	{ locale: 'pt-PT', audacityCode: 'pt_PT', nativeName: 'Português (Portugal)', direction: 'ltr' },
	{ locale: 'ro', audacityCode: 'ro', nativeName: 'Română', direction: 'ltr' },
	{ locale: 'ru', audacityCode: 'ru', nativeName: 'Русский', direction: 'ltr' },
	{ locale: 'sk', audacityCode: 'sk', nativeName: 'Slovenčina', direction: 'ltr' },
	{ locale: 'sl', audacityCode: 'sl', nativeName: 'Slovenščina', direction: 'ltr' },
	{ locale: 'sr-Latn-BA', audacityCode: 'sr', nativeName: 'Srpski (latinica)', direction: 'ltr' },
	{ locale: 'sr-Cyrl-RS', audacityCode: 'sr_RS', nativeName: 'Српски', direction: 'ltr' },
	{ locale: 'sv', audacityCode: 'sv', nativeName: 'Svenska', direction: 'ltr' },
	{ locale: 'ta', audacityCode: 'ta', nativeName: 'தமிழ்', direction: 'ltr' },
	{ locale: 'tg', audacityCode: 'tg', nativeName: 'Тоҷикӣ', direction: 'ltr' },
	{ locale: 'tr', audacityCode: 'tr', nativeName: 'Türkçe', direction: 'ltr' },
	{ locale: 'uk', audacityCode: 'uk', nativeName: 'Українська', direction: 'ltr' },
	{ locale: 'vi', audacityCode: 'vi', nativeName: 'Tiếng Việt', direction: 'ltr' },
	{ locale: 'zh-CN', audacityCode: 'zh_CN', nativeName: '简体中文', direction: 'ltr' },
	{ locale: 'zh-TW', audacityCode: 'zh_TW', nativeName: '繁體中文（台灣）', direction: 'ltr' },
]);

/** Bundled catalogs that are available even when the R2 manifest is offline. */
export const DEFAULT_LOCALE_TAGS = Object.freeze(['en', 'de']);

/**
 * Locales whose mapping coverage has passed the release threshold and whose
 * standalone/embed routes are included in this Pages deployment.
 *
 * This list is generated from the checked-in Qt mapping audit. A newly
 * eligible upstream locale remains pending until this list is updated and a
 * normal static deployment publishes its route.
 */
export const COMMITTED_LOCALE_TAGS = Object.freeze([
	'en',
	'de',
	'ar',
	'en-GB',
	'es',
	'fi',
	'fr',
	'gl',
	'hy',
	'ja',
	'ko',
	'pl',
	'ro',
	'ru',
	'tr',
	'uk',
	'zh-CN',
]);

export const AUDACITY_TO_BCP47 = deepFreeze(Object.fromEntries(
	AUDACITY_LOCALE_SUPERSET.map(({ audacityCode, locale }) => [audacityCode, locale]),
));

export const LOCALE_BY_TAG = deepFreeze(Object.fromEntries(
	AUDACITY_LOCALE_SUPERSET.map((descriptor) => [descriptor.locale, descriptor]),
));

export const ROUTE_LOCALES = deepFreeze(COMMITTED_LOCALE_TAGS.map((locale) => {
	const descriptor = LOCALE_BY_TAG[locale];
	if (!descriptor) throw new Error(`Unknown committed locale: ${locale}`);
	return descriptor;
}));

export function canonicalLocale(candidate = 'en') {
	const input = String(candidate || '').trim();
	if (!input) return 'en';
	if (AUDACITY_TO_BCP47[input]) return AUDACITY_TO_BCP47[input];
	try {
		return Intl.getCanonicalLocales(input.replaceAll('_', '-'))[0] || 'en';
	} catch {
		return 'en';
	}
}

export function getLocaleDescriptor(candidate = 'en') {
	return LOCALE_BY_TAG[canonicalLocale(candidate)] || null;
}

export function getStaticLocalePaths() {
	return ROUTE_LOCALES.map(({ locale }) => ({
		params: { locale },
		props: { locale },
	}));
}

export function localePath(candidate, { embedded = false } = {}) {
	const descriptor = getLocaleDescriptor(candidate);
	if (!descriptor || !COMMITTED_LOCALE_TAGS.includes(descriptor.locale)) throw new RangeError(`Locale has no committed route: ${candidate}`);
	return `${embedded ? '/embed' : ''}/${descriptor.locale}/`;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
