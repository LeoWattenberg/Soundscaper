/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionscaperDesktopDocumentUrl } from './motionscaper-desktop-contract.ts';

/** Native host inventory is checked against the handbook's publication authority. */
export const MOTIONSCAPER_HANDBOOK_LANGUAGES: readonly string[] = Object.freeze([
	'de', 'ar', 'cs', 'el', 'en-gb', 'es', 'fa',
	'fi', 'fr', 'gl', 'he', 'hi', 'hy', 'id', 'it', 'ja',
	'ko', 'nl', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'tr', 'uk', 'vi', 'zh-cn', 'zh-tw',
]);

/** The renderer names a destination; it never supplies a host-opened URL. */
export async function dispatchMotionscaperDocumentation(
	caller: Readonly<{ ownWindow: boolean; mainFrame: boolean; url: string }>, request: unknown,
	openExternal: (url: string) => Promise<void>,
): Promise<void> {
	if (!caller.ownWindow || !caller.mainFrame || !motionscaperDesktopDocumentUrl(caller.url)) throw new Error('Untrusted Motionscaper documentation caller.');
	if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('A Motionscaper documentation request is required.');
	const fields = Reflect.ownKeys(request); if (fields.some(field => field !== 'destination' && field !== 'locale')) throw new TypeError('Unexpected Motionscaper documentation field.');
	const destination: unknown = Reflect.get(request, 'destination'); const locale: unknown = Reflect.get(request, 'locale');
	if (destination !== 'manual' && destination !== 'tutorials') throw new RangeError('Choose the Motionscaper manual or tutorials.');
	if (locale !== undefined && (typeof locale !== 'string' || !/^[a-z]{2}(?:-[a-z]{2})?$/iu.test(locale))) throw new RangeError('The documentation locale is invalid.');
	const normalized = typeof locale === 'string' ? locale.toLowerCase() : '';
	const language = MOTIONSCAPER_HANDBOOK_LANGUAGES.includes(normalized) ? `${normalized}/` : '';
	await openExternal(`https://motionscaper.org/docs/${language}${destination === 'tutorials' ? 'first-project/' : ''}`);
}
