/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
import { localeLanguage } from './locale.js';
const ENTRIES = [
	['motionscaperSendComposition', 'Send Composition to Framescaper', 'Komposition an Framescaper senden'],
	['motionscaperLinkDescription', 'In Framescaper 1.1, open File → Linked compositions and create a pairing URL. Connect here, then use the bridge window’s Connect button.', 'In Framescaper 1.1 unter Datei → Verknüpfte Kompositionen eine Verbindungs-URL erstellen. Hier verbinden und dann im Brückenfenster „Verbinden“ wählen.'],
	['motionscaperLinkSavedOnly', 'The last saved revision is sent. Save publishes later edits automatically while connected. Save Copy and unsaved edits do not publish updates.', 'Die zuletzt gespeicherte Revision wird gesendet. Speichern überträgt spätere Änderungen während der Verbindung automatisch. Kopien und ungespeicherte Änderungen werden nicht übertragen.'],
	['motionscaperLinkPairing', 'Framescaper pairing URL', 'Framescaper-Verbindungs-URL'],
	['motionscaperLinkConnect', 'Connect and Send Saved Revision', 'Verbinden und gespeicherte Revision senden'],
	['motionscaperLinkDisconnect', 'Disconnect', 'Verbindung trennen'],
	['motionscaperLinkIdle', 'Disconnected', 'Nicht verbunden'],
	['motionscaperLinkConnecting', 'Waiting for the bridge connection', 'Warten auf die Brückenverbindung'],
	['motionscaperLinkSending', 'Sending the saved revision and its media', 'Gespeicherte Revision und Medien werden gesendet'],
	['motionscaperLinkConnected', 'Connected — saved revisions update automatically', 'Verbunden — gespeicherte Revisionen werden automatisch übertragen'],
	['motionscaperLinkLastDigest', 'Last received saved revision', 'Zuletzt empfangene gespeicherte Revision'],
	['motionscaperLinkKeepOpen', 'Keep both editors and their bridge windows open. Closing this dialog keeps the connection active; opening another project disconnects it.', 'Beide Editoren und Brückenfenster geöffnet lassen. Das Schließen dieses Dialogs beendet die Verbindung nicht; das Öffnen eines anderen Projekts trennt sie.'],
] as const;
export const MOTIONSCAPER_LINK_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))), de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))) });
export function resolveMotionscaperLinkCopy(locale: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, string>> {
	return resolveEditorCopyScope('motionscaper-link', localeLanguage(locale) === 'de' ? MOTIONSCAPER_LINK_COPY_BY_LOCALE.de : MOTIONSCAPER_LINK_COPY_BY_LOCALE.en, overrides);
}
