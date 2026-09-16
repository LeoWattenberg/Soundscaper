/* SPDX-License-Identifier: AGPL-3.0-only */

import { COMMITTED_LOCALE_TAGS } from '../../../i18n/locales.js';
import { acceptableTranslation } from '../../../i18n/translation-catalog.js';
import { isTranslatableMessageKey } from '../../../i18n/translation-scope.ts';
import { formatPresentationMessage, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';

export interface PresentationLocalizationSnapshot {
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly revision: number;
}

export interface PresentationLocalizationPort {
	readonly publishedCopy: Readonly<Record<string, string>>;
	getSnapshot(): PresentationLocalizationSnapshot;
	subscribe(listener: () => void): () => void;
	applyPreview(locale: string, translations: Readonly<Record<string, string>>): void;
	resetPreview(): void;
}

// Associations contain immutable published defaults, never global locale state.
const publishedCopies = new WeakMap<object, object>();

export function publishedCopyFor<Copy extends object>(copy: Copy): Copy {
	return (publishedCopies.get(copy) ?? copy) as Copy;
}

/** Keep narrow service ports live rather than capturing individual strings. */
export function selectPresentationCopy<Copy extends object, Key extends keyof Copy>(
	copy: Copy, keys: readonly Key[],
): Readonly<Pick<Copy, Key>> {
	const selected = Object.create(null) as Pick<Copy, Key>;
	const published = Object.create(null) as Pick<Copy, Key>;
	for (const key of keys) {
		Object.defineProperty(selected, key, { enumerable: true, get: () => copy[key] });
		published[key] = publishedCopyFor(copy)[key];
	}
	Object.freeze(selected);
	publishedCopies.set(selected, Object.freeze(published));
	return selected;
}

/** A session owns presentation changes independently of its audio lifetime. */
export function createPresentationLocalization<Copy extends Readonly<Record<string, string>>>(options: Readonly<{
	locale: string;
	publishedCopy: Copy;
	englishCopy: Readonly<Record<string, string>>;
}>) {
	const publishedCopy = Object.freeze({ ...options.publishedCopy });
	const listeners = new Set<() => void>();
	let disposed = false;
	let snapshot: PresentationLocalizationSnapshot = Object.freeze({ locale: options.locale, copy: publishedCopy, revision: 0 });
	const copy = newCatalogFacade();
	publishedCopies.set(copy, publishedCopy);

	function newCatalogFacade(): Readonly<Copy> {
		const facade: Record<string, string> = Object.create(null) as Record<string, string>;
		for (const key of new Set([...Object.keys(options.englishCopy), ...Object.keys(publishedCopy)])) {
			Object.defineProperty(facade, key, { enumerable: true, get: () => snapshot.copy[key] });
		}
		return Object.freeze(facade) as Readonly<Copy>;
	}

	function publish(locale: string, nextCopy: Readonly<Record<string, string>>): void {
		if (disposed) throw new Error('Presentation localization is disposed.');
		publishedCopies.set(nextCopy, publishedCopy);
		snapshot = Object.freeze({ locale, copy: nextCopy, revision: snapshot.revision + 1 });
		for (const listener of [...listeners]) listener();
	}

	const port: PresentationLocalizationPort = Object.freeze({
		publishedCopy,
		getSnapshot: () => snapshot,
		subscribe(listener: () => void): () => void {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		applyPreview(locale: string, translations: Readonly<Record<string, string>>): void {
			if (!COMMITTED_LOCALE_TAGS.includes(locale) || locale === 'en') throw new Error('Preview needs an existing translation locale.');
			for (const [key, translation] of Object.entries(translations)) {
				if (!Object.hasOwn(options.englishCopy, key) || (isTranslatableMessageKey(key)
					? !acceptableTranslation(options.englishCopy[key], translation) : translation !== publishedCopy[key])) {
					throw new Error(`Invalid translation preview: ${key}.`);
				}
			}
			publish(locale, Object.freeze({ ...publishedCopy, ...translations }));
		},
		resetPreview: () => { if (!disposed && snapshot.copy !== publishedCopy) publish(options.locale, publishedCopy); },
	});
	return Object.freeze({
		port, copy,
		formatMessage: (message: LocalizedPresentationMessage) => formatPresentationMessage(snapshot.copy, message),
		dispose(): void {
			if (disposed) return;
			if (snapshot.copy !== publishedCopy) publish(options.locale, publishedCopy);
			disposed = true;
			listeners.clear();
		},
	});
}
