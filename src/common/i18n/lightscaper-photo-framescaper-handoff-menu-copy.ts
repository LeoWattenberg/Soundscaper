/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoFramescaperHandoffMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'Bearbeitbare Framescaper-Kopie herunterladen…' : 'Download editable Framescaper copy…';
}

export function photoFramescaperReceiveMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'Bearbeitbares Framescaper-Foto importieren…' : 'Import editable Framescaper photo…';
}

export function photoFramescaperCollectionHandoffMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'Sammlung als Framescaper-Sequenz herunterladen…' : 'Download collection as Framescaper sequence…';
}
