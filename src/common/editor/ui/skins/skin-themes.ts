/* SPDX-License-Identifier: AGPL-3.0-only */
import { darkTheme, lightTheme, type ThemeTokens } from '@audacity-ui/tokens';
import type { SkinId } from '../../skin-preferences.ts';

export type SkinMode = 'light' | 'dark';
interface Palette {
	background: string;
	panel: string;
	control: string;
	text: string;
	muted: string;
	line: string;
	accent: string;
	stage: string;
}
interface SkinDefinition {
	name: string;
	font: string;
	light: Palette;
	dark: Palette;
}
export const SKINS: Record<Exclude<SkinId, 'default'>, SkinDefinition> = {
	sakura: {
		name: 'Sakura', font: '"Nunito Sans", ui-rounded, system-ui, sans-serif',
		light: { background: '#fff5f5', panel: '#f5dfe8', control: '#fffafb', text: '#38202f', muted: '#694653', line: '#9e647b', accent: '#ac316a', stage: '#382230' },
		dark: { background: '#291c2a', panel: '#392536', control: '#231824', text: '#ffeef5', muted: '#d6b2c4', line: '#ad7892', accent: '#ffaccd', stage: '#1b121d' },
	},
	lilac: {
		name: 'Lilac', font: 'Inter, system-ui, sans-serif',
		light: { background: '#f5f2fc', panel: '#e5dff3', control: '#fcfaff', text: '#292139', muted: '#5e506e', line: '#796991', accent: '#6943a8', stage: '#292137' },
		dark: { background: '#211d30', panel: '#302840', control: '#191621', text: '#f4edff', muted: '#c4b7d6', line: '#9782b5', accent: '#c2a1ff', stage: '#14111e' },
	},
	techno: {
		name: 'Techno', font: '"JetBrains Mono", ui-monospace, monospace',
		light: { background: '#edf7ff', panel: '#d5e8f7', control: '#f7fbff', text: '#09253e', muted: '#35556f', line: '#527c9d', accent: '#075dba', stage: '#091d32' },
		dark: { background: '#081321', panel: '#10243a', control: '#050d17', text: '#e1f4ff', muted: '#a0c5e1', line: '#4e90bc', accent: '#68caff', stage: '#030a13' },
	},
};

/** Mix opaque hex colors, retaining concrete tokens usable by canvas renderers. */
function mix(first: string, second: string, weight: number): string {
	return `#${[1, 3, 5].map((offset) => {
		const a = Number.parseInt(first.slice(offset, offset + 2), 16);
		const b = Number.parseInt(second.slice(offset, offset + 2), 16);
		return Math.round(a * (1 - weight) + b * weight).toString(16).padStart(2, '0');
	}).join('')}`;
}

function mapColors<Value>(value: Value, replacements: ReadonlyMap<string, string>): Value {
	if (typeof value === 'string') return (replacements.get(value.toLowerCase()) ?? value) as Value;
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, child]: [string, unknown]) => [key, mapColors(child, replacements)])) as Value;
	}
	return value;
}

const cache = new Map<string, ThemeTokens>();

export function resolveSkinTheme(skin: SkinId, mode: SkinMode, highContrast = false): ThemeTokens {
	const base = mode === 'dark' ? darkTheme : lightTheme;
	if (skin === 'default' || highContrast) return base;
	const key = `${skin}/${mode}`;
	const cached = cache.get(key);
	if (cached) return cached;
	const palette = SKINS[skin][mode];
	const replacements = new Map<string, string>();
	const replace = (from: string, to: string) => replacements.set(from.toLowerCase(), to);
	for (const [id, color] of Object.entries(base.background.surface)) {
		replace(color, id === 'default' ? palette.background : id === 'elevated' || id === 'inset' ? palette.panel : mix(palette.background, palette.panel, 0.5));
	}
	for (const color of [base.background.control.input.idle, base.background.control.input.focus]) replace(color, palette.control);
	for (const color of [base.border.default, base.border.onSurface, base.border.onElevated, base.border.divider]) replace(color, palette.line);
	replace(base.foreground.text.primary, palette.text);
	replace(base.foreground.text.secondary, palette.muted);
	replace(base.accent.primary, palette.accent);
	replace(base.background.canvas.default, palette.stage);
	const theme = mapColors(base, replacements);
	const lightAccent = skin === 'sakura' && mode === 'light'
		? '#ff9cc7'
		: mix(palette.accent, '#ffffff', mode === 'dark' ? 0 : 0.65);
	theme.accent.primary = palette.accent;
	theme.border.focus = palette.accent;
	theme.border.control = { radio: palette.line, checkbox: palette.line };
	theme.foreground.text.secondary = palette.muted;
	theme.foreground.text.link = palette.accent;
	theme.foreground.text.linkHover = palette.accent;
	theme.background.toolbar = palette.background;
	theme.background.dialog = { header: palette.background, body: palette.background, footer: palette.background };
	theme.background.menu.background = palette.background;
	theme.background.menu.item.hover = palette.panel;
	theme.background.menu.item.active = palette.panel;
	theme.background.control.button.primary = { idle: lightAccent, hover: mix(lightAccent, '#ffffff', 0.15), active: mix(lightAccent, '#ffffff', 0.3), disabled: palette.panel };
	theme.background.control.button.secondary = {
		idle: palette.panel, hover: mix(palette.panel, palette.background, 0.4),
		active: mix(palette.panel, palette.line, 0.15), disabled: palette.panel,
	};
	theme.background.trackHeader.idle = palette.panel;
	theme.background.trackHeader.hover = palette.panel;
	theme.background.trackHeader.selected = palette.background;
	theme.background.trackHeader.parent = mix(palette.panel, palette.line, 0.15);
	theme.background.canvas.grid.major = mix(palette.stage, palette.accent, 0.18);
	theme.background.canvas.grid.minor = mix(palette.stage, palette.accent, 0.1);
	// Checkbox uses the primary icon token in every state (including pressed).
	const checkboxFill = mode === 'dark' ? mix(palette.control, palette.accent, 0.18) : lightAccent;
	theme.background.control.checkbox = {
		...theme.background.control.checkbox,
		idle: palette.control, hover: mix(palette.control, palette.panel, 0.4),
		pressed: mix(palette.control, palette.panel, 0.7),
		checked: checkboxFill, checkedHover: mix(checkboxFill, palette.control, 0.15),
	};
	theme.background.control.radio.selected = lightAccent;
	theme.background.control.radio.selectedHover = mix(lightAccent, '#ffffff', 0.15);
	theme.background.control.toggle.on.idle = lightAccent;
	theme.background.control.toggle.on.hover = mix(lightAccent, '#ffffff', 0.15);
	// Keep the meter's signal and error semantics; skin color never changes their meaning.
	theme.semantic = base.semantic;
	theme.background.control.meter = base.background.control.meter;
	theme.audio = { ...theme.audio, envelope: base.audio.envelope, clip: { ...base.audio.clip } };
	for (const [id, clip] of Object.entries(base.audio.clip)) {
		if (!('header' in clip)) continue;
		const tint = skin === 'sakura' ? '#ffd3e4' : skin === 'lilac' ? '#d7c6f2' : '#8bd5ff';
		const header = mix(clip.header, tint, skin === 'techno' ? 0.24 : 0.32);
		const body = mix(header, '#ffffff', 0.2);
		theme.audio.clip[id as Exclude<keyof ThemeTokens['audio']['clip'], 'border'>] = {
			...clip, header, headerHover: mix(header, '#ffffff', 0.12), body,
			headerSelected: '#ffffff', headerSelectedHover: mix('#ffffff', tint, 0.1),
			waveform: '#152132', waveformSelected: '#152132',
			waveformRms: mix('#152132', body, 0.28), waveformRmsSelected: '#445065',
			timeSelectionBody: mix(body, '#ffffff', 0.4), timeSelectionHeader: mix(header, '#ffffff', 0.4),
			timeSelectionWaveform: '#152132', timeSelectionWaveformRms: '#445065',
		};
	}
	cache.set(key, theme);
	return theme;
}
