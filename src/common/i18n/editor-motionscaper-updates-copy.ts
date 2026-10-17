/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperCheckUpdates', 'Check for Updates', 'Nach Updates suchen'],
	['motionscaperUpdatesTitle', 'Motionscaper Updates', 'Motionscaper-Updates'],
	['motionscaperUpdatesCurrent', 'This is the latest available Motionscaper version.', 'Dies ist die neueste verfügbare Motionscaper-Version.'],
	['motionscaperUpdatesAvailable', 'Motionscaper {version} is available.', 'Motionscaper {version} ist verfügbar.'],
	['motionscaperUpdatesFailed', 'Could not check for Motionscaper updates. Try again from Help.', 'Motionscaper-Updates konnten nicht geprüft werden. Über Hilfe erneut versuchen.'],
	['motionscaperUpdatesViewRelease', 'View Release', 'Release ansehen'],
	['motionscaperUpdatesClose', 'Close', 'Schließen'],
] as const;
export const MOTIONSCAPER_UPDATES_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperUpdatesCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-updates', localeLanguage(locale) === 'de' ? MOTIONSCAPER_UPDATES_COPY_BY_LOCALE.de : MOTIONSCAPER_UPDATES_COPY_BY_LOCALE.en, overrides);
}
