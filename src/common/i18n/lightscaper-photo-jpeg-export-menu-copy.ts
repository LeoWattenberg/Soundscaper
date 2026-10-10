/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoJpegExportMenuLabel(locale: string): string {
	return locale.toLowerCase().split('-')[0] === 'de' ? 'JPEG exportieren…' : 'Export JPEG…';
}
