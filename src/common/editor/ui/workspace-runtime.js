import { useEffect, useState } from 'react';

import { normalizeBcp47Locale } from '../../i18n/locale.js';

export function useMediaQuery(query) {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, [query]);
	return matches;
}

// Matching the manual host on a substring would also route a link whose path or
// query merely mentions it, so the host is compared after the URL is parsed.
const DESKTOP_MANUAL_HOST = 'support.audacityteam.org';

function externalUrlHostname(href) {
	try {
		return new URL(href).hostname.toLowerCase();
	} catch {
		return '';
	}
}

export function desktopExternalDestination(url) {
	const href = String(url);
	if (href.startsWith('mailto:')) return 'support';
	if (/\/privacy\/de\/$/u.test(href)) return 'privacy-de';
	if (/\/privacy\/en\/$/u.test(href)) return 'privacy-en';
	if (externalUrlHostname(href) === DESKTOP_MANUAL_HOST) return 'manual';
	return 'homepage';
}

export function isDesktopTextEditingElement(element, action) {
	if (!element || element.disabled || (element.readOnly && !['copy', 'selectAll'].includes(action))) return false;
	if (element.isContentEditable) return true;
	if (typeof HTMLTextAreaElement === 'function' && element instanceof HTMLTextAreaElement) return true;
	if (typeof HTMLInputElement !== 'function' || !(element instanceof HTMLInputElement)) return false;
	return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

export function formatDate(value, locale) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(normalizeBcp47Locale(locale));
}

export function formatDateTimeLocalInput(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 19);
}
