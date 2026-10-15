/* SPDX-License-Identifier: AGPL-3.0-only */
import { localeLanguage } from './locale.js';
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { loadTranslationCatalog } from './translation-catalog.js';

export const MOTION_LINK_BRIDGE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({ title: 'Composition Link', send: 'Connect to Framescaper', hint: 'Keep both editors and these bridge windows open while the composition transfers.', receiving: 'Connecting to the Framescaper project.', sending: 'Connecting to Motionscaper.', connected: 'Connected. Saved composition updates pass between the editors.', closed: 'The connection closed. Return to the editors to check the transfer result.', cancel: 'Cancel Connection', failed: 'The composition bridge could not connect.' }),
	de: Object.freeze({ title: 'Kompositionsverknüpfung', send: 'Mit Framescaper verbinden', hint: 'Lass beide Editoren und diese Verbindungsfenster während der Übertragung geöffnet.', receiving: 'Verbindung mit dem Framescaper-Projekt wird hergestellt.', sending: 'Verbindung mit Motionscaper wird hergestellt.', connected: 'Verbunden. Gespeicherte Kompositionsänderungen werden zwischen den Editoren übertragen.', closed: 'Die Verbindung wurde geschlossen. Prüfe das Ergebnis in den Editoren.', cancel: 'Verbindung abbrechen', failed: 'Die Kompositionsverbindung konnte nicht hergestellt werden.' }),
});

export type MotionLinkBridgeCopy = Readonly<Record<keyof typeof MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en, string>>;
export const MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY = Object.freeze(Object.fromEntries(
	Object.entries(MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en).map(([key, source]) => [`ui.motion-link-bridge.${key}`, source]),
));

export function resolveMotionLinkBridgeCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): MotionLinkBridgeCopy {
	const defaults: MotionLinkBridgeCopy = localeLanguage(locale) === 'de' ? MOTION_LINK_BRIDGE_COPY_BY_LOCALE.de : MOTION_LINK_BRIDGE_COPY_BY_LOCALE.en;
	return resolveEditorCopyScope('motion-link-bridge', defaults, overrides);
}

export async function loadMotionLinkBridgeCopy(locale: string, options: Readonly<{
	loaders?: Readonly<Record<string, () => Promise<unknown>>>;
}> = {}): Promise<MotionLinkBridgeCopy> {
	const entries = await loadTranslationCatalog(locale, { ...options, englishCopy: MOTION_LINK_BRIDGE_CANONICAL_ENGLISH_COPY });
	return resolveMotionLinkBridgeCopy(locale, entries ?? {});
}
