/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_DEFINITIONS,
	AUDACITY_EFFECT_SOURCE,
	AUDACITY_EFFECT_UPSTREAM_FILES,
	AUDACITY_STAFFPAD_SOURCE,
} from '../../audacity-effects/manifest.js';
import { AUDIO_EFFECT_DEFINITIONS } from '../../effects.js';
import { getNyquistPlugin } from '../../nyquist/plugin-registry.js';
import { REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE } from '../../reviewed-effects/selection-effect-contract.ts';
import { UTILITY_GAIN_MANIFEST } from '../../reviewed-effects/utility-gain-package.ts';
import { EFFECT_MENU_GROUPS } from '../application-menu-model.js';
import { safeEffectLabel } from './effect-helpers.ts';

export type EffectAboutFieldKey =
	| 'format' | 'author' | 'version' | 'license' | 'installPath' | 'category'
	| 'source' | 'identifier' | 'copyright' | 'compatibility' | 'latency';

export interface EffectAboutMetadata {
	readonly title: string;
	readonly fields: readonly Readonly<{ key: EffectAboutFieldKey; value: string }>[];
}

export interface EffectAboutSubject {
	readonly type?: string;
	readonly context?: Readonly<{
		readonly format?: string;
		readonly stablePluginId?: string;
	}> | null;
	readonly missing?: Readonly<{ readonly name?: unknown; readonly nativeId?: unknown }>;
}

/** Extra native fields must come from an admitted descriptor, not project state. */
export interface NativePluginAboutDescriptor {
	readonly name?: string;
	readonly vendor?: string;
	readonly version?: string;
	readonly format?: string;
	readonly kind?: string;
	readonly classification?: string;
	readonly compatibility?: string;
	readonly latencyFrames?: number | null;
	readonly installPath?: string;
	readonly installations?: readonly Readonly<{
		readonly version: string;
		readonly selected: boolean;
	}>[];
}

export interface EffectAboutOptions {
	readonly nativePlugin?: NativePluginAboutDescriptor | null;
}

type CopyOrLocale = Readonly<Record<string, string>> | string | undefined;

const MENU_CATEGORY_NAMES: Readonly<Record<string, string>> = Object.freeze({
	volumeCompression: 'Volume and compression',
	fading: 'Fading',
	eqFilters: 'EQ and filters',
	noiseRepair: 'Noise and repair',
	delayReverb: 'Delay and reverb',
	distortionModulation: 'Distortion and modulation',
	specialEffects: 'Special effects',
	legacyEffects: 'Legacy effects',
});

/** Facts for the effect About window; absent fields are deliberately omitted. */
export function effectAboutMetadata(
	effectOrType: EffectAboutSubject | string,
	copyOrLocale: CopyOrLocale = 'en',
	options: EffectAboutOptions = {},
): EffectAboutMetadata {
	const effect = typeof effectOrType === 'string' ? { type: effectOrType } : effectOrType;
	const type = effect.type ?? '';
	const fields: { key: EffectAboutFieldKey; value: string }[] = [];
	const add = (key: EffectAboutFieldKey, value: unknown) => {
		if (typeof value === 'string' && value.trim()) fields.push({ key, value: value.trim() });
	};
	let title = safeEffectLabel(effect, copyOrLocale) || type;

	if (type === 'native-plugin') {
		const descriptor = options.nativePlugin;
		const selectedInstallation = descriptor?.installations?.find((installation) => installation.selected);
		title = descriptor?.name?.trim() || effect.context?.stablePluginId || title;
		add('format', nativeFormat(effect.context?.format ?? descriptor?.format));
		add('author', descriptor?.vendor);
		add('version', descriptor?.version ?? selectedInstallation?.version);
		// The renderer's native registry is intentionally pathless. Only a trusted
		// descriptor supplied by the caller can make this field available.
		add('installPath', descriptor?.installPath);
		add('category', descriptor?.classification ?? descriptor?.kind);
		add('identifier', effect.context?.stablePluginId);
		add('compatibility', descriptor?.compatibility);
		if (Number.isSafeInteger(descriptor?.latencyFrames) && (descriptor?.latencyFrames ?? -1) >= 0) {
			fields.push({ key: 'latency', value: `${String(descriptor!.latencyFrames)} frames` });
		}
	} else if (type === 'missing') {
		add('identifier', effect.missing?.nativeId);
	} else if (type === REVIEWED_UTILITY_GAIN_SELECTION_EFFECT_TYPE) {
		add('format', 'Reviewed WASM');
		add('version', UTILITY_GAIN_MANIFEST.version);
		add('license', 'AGPL-3.0-only');
		add('category', menuCategory(type, copyOrLocale));
		add('source', 'Soundscaper');
		add('identifier', UTILITY_GAIN_MANIFEST.id);
	} else if (Object.hasOwn(AUDACITY_EFFECT_DEFINITIONS, type)) {
		const definition = AUDACITY_EFFECT_DEFINITIONS[type as keyof typeof AUDACITY_EFFECT_DEFINITIONS];
		const paths = (AUDACITY_EFFECT_UPSTREAM_FILES as Readonly<Record<string, readonly string[]>>)[type] ?? [];
		const source = paths.some((path) => path.startsWith('au3/'))
			? AUDACITY_STAFFPAD_SOURCE : AUDACITY_EFFECT_SOURCE;
		add('format', 'Audacity');
		add('author', 'Audacity');
		add('version', source.version);
		add('license', 'GPL-3.0');
		add('category', definition.category);
		add('source', 'Audacity');
		add('identifier', type);
	} else {
		const nyquist = getNyquistPlugin(type);
		if (nyquist) {
			title = nyquist.name;
			add('format', 'Nyquist');
			add('author', nyquist.author);
			add('version', nyquist.release);
			const copyright = nyquist.copyright?.trim();
			if (copyright && /\b(?:GPL|license|MIT|BSD|Apache|Creative Commons)\b/iu.test(copyright)) {
				add('license', copyright);
			} else add('copyright', copyright);
			add('category', nyquist.category);
			add('source', 'Audacity');
			add('identifier', type);
		} else if (Object.hasOwn(AUDIO_EFFECT_DEFINITIONS, type)) {
			add('format', 'Built-in');
			add('license', 'AGPL-3.0-only');
			add('category', menuCategory(type, copyOrLocale));
			add('source', 'Soundscaper');
			add('identifier', type);
		} else add('identifier', type);
	}

	return { title, fields };
}

function menuCategory(type: string, copyOrLocale: CopyOrLocale): string | undefined {
	const group = EFFECT_MENU_GROUPS.find(([, types]) => types.includes(type));
	if (!group) return undefined;
	const key = String(group[0]);
	return typeof copyOrLocale === 'object' && copyOrLocale[key]?.trim()
		? copyOrLocale[key].trim() : MENU_CATEGORY_NAMES[key];
}

function nativeFormat(format: string | undefined): string | undefined {
	switch (format?.toLowerCase()) {
		case 'vst3': return 'VST3';
		case 'clap': return 'CLAP';
		case 'au': return 'Audio Unit';
		case 'lv2': return 'LV2';
		case 'ladspa': return 'LADSPA';
		default: return format;
	}
}
