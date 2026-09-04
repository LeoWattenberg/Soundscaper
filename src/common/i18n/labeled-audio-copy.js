/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the Edit > Labeled audio submenu ported from Audacity 3.
 *
 * The rows keep Audacity's short wording because the submenu already supplies
 * the context. They live behind their own seam for the same reason the
 * play-at-speed and export rows do: the main catalog sits at a maintainability
 * ceiling that a whole submenu should not push up.
 */
const LABELED_AUDIO_COPY_ENTRIES = Object.freeze([
	['labeledAudio', 'Labeled audio', 'Beschriftetes Audio'],
	['labeledCut', 'Cut', 'Ausschneiden'],
	['labeledDelete', 'Delete', 'Löschen'],
	['labeledCutLeaveGap', 'Cut and leave gap', 'Ausschneiden und Lücke behalten'],
	['labeledDeleteLeaveGap', 'Delete and leave gap', 'Löschen und Lücke behalten'],
	['labeledSilence', 'Silence audio', 'Audio durch Stille ersetzen'],
	['labeledCopy', 'Copy', 'Kopieren'],
	['labeledSplit', 'Split', 'Teilen'],
	['labeledJoin', 'Join', 'Verbinden'],
	['labeledDisjoin', 'Detach at silences', 'An stillen Bereichen trennen'],
	[
		'labeledAudioRequired',
		'Select a time range that contains at least one whole label.',
		'Wählen Sie einen Zeitbereich, der mindestens eine vollständige Beschriftung enthält.',
	],
]);

export const LABELED_AUDIO_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABELED_AUDIO_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(LABELED_AUDIO_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
