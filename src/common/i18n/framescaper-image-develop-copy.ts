/* SPDX-License-Identifier: AGPL-3.0-only */

const EN = Object.freeze({ repairs: 'Repair spots…', masks: 'Manage image masks…' });
const DE: Readonly<Record<keyof typeof EN, string>> = Object.freeze({ repairs: 'Reparaturpunkte…', masks: 'Bildmasken verwalten…' });
export function framescaperImageDevelopCopy(locale: string): Readonly<Record<keyof typeof EN, string>> {
	return locale.toLowerCase().split('-')[0] === 'de' ? DE : EN;
}
