/* SPDX-License-Identifier: AGPL-3.0-only */

import { productProfile } from '../../../products.js';
import { applicationVersion } from '../../application-version.ts';
import type { AboutDialogCopy } from '../about-dialog-copy.ts';

const MODULE_COPY_KEYS = Object.freeze({
	project: 'project',
	timeline: 'timeline',
	transport: 'transport',
	'audio-mix': 'audioMix',
	'audio-record': 'audioRecord',
	'audio-generate': 'audioGenerate',
	'audio-effects': 'audioEffects',
	'audio-spectral': 'audioSpectral',
	'audio-analysis': 'audioAnalysis',
	'audio-macros': 'audioMacros',
	'video-basic': 'videoBasic',
	'video-effects': 'videoEffects',
	'video-compositing': 'videoCompositing',
	'export-audio': 'exportAudio',
	'export-video': 'exportVideo',
} satisfies Record<string, keyof AboutDialogCopy>);

export const ABOUT_TABS = Object.freeze(['about', 'contributors', 'license', 'enabledModules'] as const);
export type AboutTab = typeof ABOUT_TABS[number];

export const ABOUT_CONTRIBUTORS = Object.freeze([
	{ name: 'Leo Wattenberg', url: 'https://leo.wattenberg.dk', role: 'creator' },
	{ name: 'DilsonsPickles', url: 'https://github.com/DilsonsPickles/audacity-design-system', role: 'designSystem' },
	{ name: null, url: 'https://www.audacityteam.org/', role: 'audacityContribution' },
] as const);

export const ABOUT_SOURCE_URL = 'https://github.com/LeoWattenberg/Soundscaper';
export const ABOUT_NOTICES_URL = `${ABOUT_SOURCE_URL}/blob/main/THIRD_PARTY_LICENSES.md`;

export function aboutDialogInformation(productId: string, version = applicationVersion()) {
	const product = productProfile(productId);
	return Object.freeze({
		name: product.name as string,
		version,
		descriptionKey: product.id === 'framescaper' ? 'framescaperDescription' : 'soundscaperDescription',
		websiteUrl: product.id === 'framescaper' ? 'https://soundscaper.org/framescaper/' : 'https://soundscaper.org/',
		modules: Object.freeze((product.enabledCommands as readonly string[]).map((id) => {
			if (!Object.hasOwn(MODULE_COPY_KEYS, id)) throw new RangeError(`Unregistered About module: ${id}.`);
			return Object.freeze({ id, copyKey: MODULE_COPY_KEYS[id as keyof typeof MODULE_COPY_KEYS] });
		})),
	} as const);
}

export type AboutDialogInformation = ReturnType<typeof aboutDialogInformation>;
