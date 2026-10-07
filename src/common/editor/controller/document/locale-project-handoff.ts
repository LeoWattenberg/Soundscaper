/* SPDX-License-Identifier: AGPL-3.0-only */

export const LOCALE_PROJECT_HANDOFF_SETTING = 'locale-navigation-project';
const HANDOFF_LIFETIME_MS = 5 * 60 * 1_000;

interface HandoffStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface LocaleProjectHandoffResources {
	readonly storage: () => HandoffStorage | null | undefined;
	readonly location: () => Readonly<{ href: string; pathname: string }> | undefined;
	readonly now: () => number;
}

/** Carry the current document across an interface-language reload in this tab. */
export function rememberLocaleProjectHandoff(resources: LocaleProjectHandoffResources, productId: string, projectId: unknown, destination: string): void {
	if (typeof projectId !== 'string' || !projectId) return;
	const storage = tabStorage(resources);
	const href = resources.location()?.href;
	if (!storage || !href) return;
	const pathname = new URL(destination, href).pathname;
	const key = productId === 'soundscaper' ? LOCALE_PROJECT_HANDOFF_SETTING
		: `${productId}:${LOCALE_PROJECT_HANDOFF_SETTING}`;
	storage.setItem(key, JSON.stringify({ projectId, pathname, expiresAt: resources.now() + HANDOFF_LIFETIME_MS }));
}

/** The handoff affects this one navigation, never the saved next-session policy. */
export function consumeLocaleProjectHandoff(resources: LocaleProjectHandoffResources, key: string): string | null {
	const storage = tabStorage(resources);
	if (!storage) return null;
	const encoded = storage.getItem(key);
	if (encoded === null) return null;
	storage.removeItem(key);
	try {
		const value: unknown = JSON.parse(encoded);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		const request = value as Readonly<Record<string, unknown>>;
		return typeof request.projectId === 'string' && request.projectId.length > 0
			&& request.pathname === resources.location()?.pathname
			&& typeof request.expiresAt === 'number' && request.expiresAt >= resources.now()
			? request.projectId : null;
	} catch { return null; }
}

function tabStorage(resources: LocaleProjectHandoffResources): HandoffStorage | null {
	try { return resources.storage() ?? null; }
	catch { return null; }
}
