/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoFramescaperHandoffMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'Bearbeitbare Framescaper-Kopie herunterladen…' : 'Download editable Framescaper copy…';
}
