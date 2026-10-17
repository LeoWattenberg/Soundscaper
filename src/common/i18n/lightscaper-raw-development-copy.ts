/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoDevelopRawDevelopmentCopy(locale: string) {
	return locale.toLowerCase().split('-')[0] === 'de' ? {
		menu: 'RAW-Quellverarbeitung', title: 'RAW-Quellverarbeitung', mode: 'Quellverarbeitung', canonical: 'Kanonisches Original',
		headroom: 'Linearer Spielraum', recovery: 'Lichter rekonstruieren', working: 'RAW-Quelle wird geprüft…',
		failed: 'Diese Quellverarbeitung ist für das aktuelle Original nicht verfügbar.', apply: 'Anwenden', close: 'Schließen',
	} : {
		menu: 'RAW source processing', title: 'RAW source processing', mode: 'Source processing', canonical: 'Canonical Original',
		headroom: 'Linear headroom', recovery: 'Highlight recovery', working: 'Checking RAW source…',
		failed: 'This source processing is unavailable for the current Original.', apply: 'Apply', close: 'Close',
	};
}
