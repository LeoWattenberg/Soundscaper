export function withBase(href: string): string {
	if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) {
		return href;
	}

	const base = import.meta.env.BASE_URL.replace(/\/$/, '');

	if (!base || href.startsWith(`${base}/`)) {
		return href;
	}

	return `${base}${href.startsWith('/') ? href : `/${href}`}`;
}
