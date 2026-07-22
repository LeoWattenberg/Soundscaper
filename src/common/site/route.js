import { getLocaleDescriptor } from '../i18n/locales.js';

const DESKTOP_PRODUCT_ID = typeof __SCAPE_PRODUCT__ === 'string' && __SCAPE_PRODUCT__ === 'framescaper'
	? 'framescaper'
	: 'soundscaper';

export async function resolveApplicationRoute(scope = globalThis) {
	const desktop = scope.scapeDesktop?.v1;
	if (desktop) {
		const environment = await desktop.getEnvironment();
		return createRoute(DESKTOP_PRODUCT_ID, environment?.locale, true, true);
	}
	if (scope.location?.pathname === '/') scope.location.replace('/en/');

	const segments = String(scope.location?.pathname || '/')
		.split('/')
		.filter(Boolean);
	const productId = segments[0] === 'framescaper' ? 'framescaper' : 'soundscaper';
	if (productId === 'framescaper') segments.shift();
	const embedded = segments[0] === 'embed';
	if (embedded) segments.shift();
	return createRoute(productId, segments[0] || 'en', embedded, false);
}

function createRoute(productId, locale, embedded, desktop) {
	const descriptor = getLocaleDescriptor(locale) || getLocaleDescriptor('en');
	return Object.freeze({
		productId,
		locale: descriptor.locale,
		direction: descriptor.direction,
		embedded,
		desktop,
	});
}
