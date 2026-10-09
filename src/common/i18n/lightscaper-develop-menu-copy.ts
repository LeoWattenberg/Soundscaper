/* SPDX-License-Identifier: AGPL-3.0-only */

export function photoDevelopMenuLabel(locale: string): string { return locale.toLowerCase().split('-')[0] === 'de' ? 'Entwickeln…' : 'Develop…'; }
