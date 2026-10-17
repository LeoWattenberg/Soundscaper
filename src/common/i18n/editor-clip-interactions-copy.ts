/* SPDX-License-Identifier: AGPL-3.0-only */

export const CLIP_INTERACTIONS_COPY_BY_LOCALE = {
	en: {
		apply: 'Apply', custom: 'Custom', increaseValue: 'Increase value', decreaseValue: 'Decrease value',
		secondsUnit: 's', fades: 'Fades', editFadeIn: 'Edit fade-in', editFadeOut: 'Edit fade-out',
		removeFadeIn: 'Remove fade-in', removeFadeOut: 'Remove fade-out',
		fadeInLength: 'Fade-in length', fadeOutLength: 'Fade-out length',
		fadeInShape: 'Fade-in shape', fadeOutShape: 'Fade-out shape',
	},
	de: {
		apply: 'Anwenden', custom: 'Benutzerdefiniert', increaseValue: 'Wert erhöhen', decreaseValue: 'Wert verringern',
		secondsUnit: 's', fades: 'Blenden', editFadeIn: 'Einblendung bearbeiten', editFadeOut: 'Ausblendung bearbeiten',
		removeFadeIn: 'Einblendung entfernen', removeFadeOut: 'Ausblendung entfernen',
		fadeInLength: 'Einblendlänge', fadeOutLength: 'Ausblendlänge',
		fadeInShape: 'Einblendkurve', fadeOutShape: 'Ausblendkurve',
	},
} as const;

export function clipInteractionCopy(copy: Readonly<Record<string, string>>) {
	return Object.fromEntries(Object.entries(CLIP_INTERACTIONS_COPY_BY_LOCALE.en).map(([key, fallback]) => [key, copy[`ui.clipInteractions.${key}`] ?? fallback])) as Record<keyof typeof CLIP_INTERACTIONS_COPY_BY_LOCALE.en, string>;
}
