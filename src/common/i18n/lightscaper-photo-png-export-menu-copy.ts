/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoPngExportMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'PNG exportieren…' : 'Export PNG…';
}
