/* SPDX-License-Identifier: AGPL-3.0-only */

import { ENGLISH_COPY, GERMAN_COPY } from './catalogs.js';
import { acceptableTranslation } from './translation-catalog.js';
import { MACRO_MANAGER_COPY_BY_LOCALE } from './editor-macro-manager-copy.ts';
import { TRACK_AUTOMATION_COPY_BY_LOCALE } from './editor-track-automation-copy.ts';
import { EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE } from './editor-effect-macro-template-copy.ts';
import { SOUNDSCAPER_NATIVE_SERVICES_COPY } from './editor-soundscaper-native-services-copy.ts';
import { FRAMESCAPER_NATIVE_SERVICES_COPY } from './editor-framescaper-native-services-copy.ts';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from './editor-soundscaper-mastering-sequence-copy.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from './editor-soundscaper-routing-graph-copy.ts';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from './community-translations-copy.ts';
import { LOCAL_ASSISTANCE_ADDITIONAL_COPY } from './editor-local-assistance-additional-copy.ts';
import { FRAMESCAPER_FINISHING_ADDITIONAL_COPY, FRAMESCAPER_FINISHING_ADDITIONAL_GERMAN_COPY } from './editor-framescaper-finishing-additional-copy.ts';
import { FRAMESCAPER_VISUAL_INSPECTOR_ADDITIONAL_COPY } from './editor-framescaper-visual-inspector-additional-copy.ts';
import { VIDEO_PROXY_ADDITIONAL_COPY } from './editor-video-proxy-additional-copy.ts';
import { VIDEO_RETIME_ADDITIONAL_COPY } from './editor-video-retime-additional-copy.ts';
import { FRAMESCAPER_MENUS_ADDITIONAL_COPY } from './editor-framescaper-menus-additional-copy.ts';
import { TIMELINE_ADDITIONAL_COPY, TIMELINE_ADDITIONAL_GERMAN_COPY } from './editor-timeline-additional-copy.ts';
import { VIDEO_PREVIEW_ADDITIONAL_COPY } from './editor-video-preview-additional-copy.ts';
import { STORAGE_CAPACITY_COPY_BY_LOCALE } from './editor-storage-capacity-copy.ts';
import { DESKTOP_FFMPEG_COPY } from './editor-desktop-ffmpeg-copy.ts';
import { FRAMESCAPER_FINISHING_SURFACE_COPY } from './editor-framescaper-finishing-surface-copy.ts';
import { PROCESSING_DIALOG_COPY_BY_LOCALE } from './processing-dialog-copy.js';
import { LOCAL_MODEL_NAMES_COPY } from './editor-local-model-names-copy.ts';
import { PARAMETRIC_EQ_BAND_COPY } from './editor-parametric-eq-copy.ts';
import { VIDEO_FILMSTRIP_COPY } from './editor-video-filmstrip-copy.ts';
import { SOUNDSCAPER_WORKFLOW_COPY } from './editor-soundscaper-workflow-copy.ts';
import { TAKE_COMP_COPY } from './editor-take-comp-copy.ts';
import { NATIVE_PROJECT_STATUS_COPY_BY_LOCALE } from './editor-native-project-status-copy.ts';
import { PROJECT_MEDIA_COPY_BY_LOCALE, CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE, IMPORT_STATUS_COPY_BY_LOCALE } from './editor-project-media-copy.ts';
import { EFFECTS_OVERLAY_COPY_BY_LOCALE } from './editor-effects-overlay-copy.ts';
import { SELECTED_VISUAL_AUTHORING_COPY, SELECTED_VISUAL_AUTHORING_SURFACE_COPY } from './editor-selected-visual-authoring-copy.ts';
import { SOURCE_STATUS_COPY_BY_LOCALE } from './editor-source-status-copy.ts';
import { FREESOUND_ATTRIBUTION_INVENTORY_COPY_BY_LOCALE } from './editor-freesound-attribution-inventory-copy.ts';

export interface EditorCopyOwner {
	readonly owner: string;
	readonly en: Readonly<Record<string, string>>;
	readonly de?: Readonly<Record<string, string>>;
	readonly aliases?: Readonly<Record<string, string>>;
}

/** Canonical inventory identities include independently owned UI namespaces. */
export type EditorCopy = Readonly<Record<string, string>>;

export interface EditorCopyMetadata {
	readonly key: string;
	readonly owner: string;
	readonly source: string;
	readonly bundledGerman?: string;
}

export function buildEditorCopyInventory(
	english: Readonly<Record<string, string>>,
	german: Readonly<Record<string, string>>,
	owners: readonly EditorCopyOwner[],
) {
	const en: Record<string, string> = { ...english };
	const de: Record<string, string> = { ...german };
	const metadata: Record<string, EditorCopyMetadata> = {};
	for (const key of Object.keys(en)) metadata[key] = Object.freeze({
		key, owner: 'editor', source: en[key]!, ...(de[key] === undefined ? {} : { bundledGerman: de[key] }),
	});
	for (const owner of owners) {
		for (const [localKey, source] of Object.entries(owner.en)) {
			const alias = owner.aliases?.[localKey];
			if (alias !== undefined) {
				if (en[alias] !== source) throw new Error(`Invalid shared editor copy source: ${alias}`);
				continue;
			}
			const key = `ui.${owner.owner}.${localKey}`;
			if (Object.hasOwn(en, key)) throw new Error(`Duplicate editor copy key: ${key}`);
			if (!acceptableTranslation(source, source)) throw new Error(`Invalid editor copy source: ${key}`);
			const translation = owner.de?.[localKey] ?? (english[localKey] === source ? german[localKey] : undefined);
			if (translation !== undefined && !acceptableTranslation(source, translation)) throw new Error(`Invalid German editor copy: ${key}`);
			en[key] = source;
			if (translation !== undefined) de[key] = translation;
			metadata[key] = Object.freeze({ key, owner: owner.owner, source,
				...(translation === undefined ? {} : { bundledGerman: translation }) });
		}
	}
	return Object.freeze({ english: Object.freeze(en), german: Object.freeze(de), metadata: Object.freeze(metadata) });
}

const templateEnglish = EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE.en;
const templateGerman = EFFECT_MACRO_TEMPLATE_COPY_BY_LOCALE.de;
const processingAliases = Object.freeze(Object.fromEntries(
	Object.keys(PROCESSING_DIALOG_COPY_BY_LOCALE.en).map((key) => [key, key]),
));
const { pressure: pressureEnglish, preflightStatus: preflightEnglish, operation: operationEnglish,
	...storageEnglish } = STORAGE_CAPACITY_COPY_BY_LOCALE.en;
const { pressure: pressureGerman, preflightStatus: preflightGerman, operation: operationGerman,
	...storageGerman } = STORAGE_CAPACITY_COPY_BY_LOCALE.de;
const inventory = buildEditorCopyInventory(ENGLISH_COPY, GERMAN_COPY, [
	{ owner: 'macroManager', ...MACRO_MANAGER_COPY_BY_LOCALE },
	{ owner: 'trackAutomation', ...TRACK_AUTOMATION_COPY_BY_LOCALE },
	{ owner: 'effectMacroTemplate', en: templateEnglish, de: templateGerman },
	{ owner: 'soundscaperNative', en: SOUNDSCAPER_NATIVE_SERVICES_COPY, aliases: processingAliases },
	{ owner: 'framescaperNative', en: FRAMESCAPER_NATIVE_SERVICES_COPY, aliases: processingAliases },
	{ owner: 'mastering', en: SOUNDSCAPER_MASTERING_SEQUENCE_COPY },
	{ owner: 'routing', en: SOUNDSCAPER_ROUTING_GRAPH_COPY },
	{ owner: 'communityTranslations', ...COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE },
	{ owner: 'localAssistance', en: LOCAL_ASSISTANCE_ADDITIONAL_COPY },
	{ owner: 'framescaperFinishing', en: FRAMESCAPER_FINISHING_ADDITIONAL_COPY, de: FRAMESCAPER_FINISHING_ADDITIONAL_GERMAN_COPY },
	{ owner: 'framescaperVisualInspector', en: FRAMESCAPER_VISUAL_INSPECTOR_ADDITIONAL_COPY },
	{ owner: 'videoProxy', en: VIDEO_PROXY_ADDITIONAL_COPY },
	{ owner: 'videoRetime', en: VIDEO_RETIME_ADDITIONAL_COPY },
	{ owner: 'framescaperMenus', en: FRAMESCAPER_MENUS_ADDITIONAL_COPY },
	{ owner: 'timeline', en: TIMELINE_ADDITIONAL_COPY, de: TIMELINE_ADDITIONAL_GERMAN_COPY },
	{ owner: 'videoPreview', en: VIDEO_PREVIEW_ADDITIONAL_COPY },
	{ owner: 'storageCapacity', en: storageEnglish, de: storageGerman },
	{ owner: 'storageCapacity.pressure', en: pressureEnglish, de: pressureGerman },
	{ owner: 'storageCapacity.preflightStatus', en: preflightEnglish, de: preflightGerman },
	{ owner: 'storageCapacity.operation', en: operationEnglish, de: operationGerman },
	{ owner: 'desktopFfmpeg', en: DESKTOP_FFMPEG_COPY },
	{ owner: 'localModelNames', en: LOCAL_MODEL_NAMES_COPY },
	{ owner: 'parametricEq.band', en: PARAMETRIC_EQ_BAND_COPY },
	{ owner: 'videoFilmstrip', en: VIDEO_FILMSTRIP_COPY },
	{ owner: 'soundscaperWorkflow', en: SOUNDSCAPER_WORKFLOW_COPY },
	{ owner: 'takeComp', en: TAKE_COMP_COPY },
	{ owner: 'nativeProjectStatus', ...NATIVE_PROJECT_STATUS_COPY_BY_LOCALE },
	{ owner: 'projectMedia', ...PROJECT_MEDIA_COPY_BY_LOCALE },
	{ owner: 'crossProductHandoff', ...CROSS_PRODUCT_HANDOFF_COPY_BY_LOCALE },
	{ owner: 'importStatus', ...IMPORT_STATUS_COPY_BY_LOCALE },
	{ owner: 'effectsOverlay', ...EFFECTS_OVERLAY_COPY_BY_LOCALE },
	{ owner: 'sourceStatus', ...SOURCE_STATUS_COPY_BY_LOCALE },
	{ owner: 'freesoundAttribution', ...FREESOUND_ATTRIBUTION_INVENTORY_COPY_BY_LOCALE },
	{ owner: 'selectedVisualAuthoring', en: SELECTED_VISUAL_AUTHORING_COPY },
	...Object.entries(SELECTED_VISUAL_AUTHORING_SURFACE_COPY).map(([surface, en]) => ({
		owner: `selectedVisualAuthoring.surfaces.${surface}`, en,
	})),
	...Object.entries(FRAMESCAPER_FINISHING_SURFACE_COPY).map(([surface, en]) => ({
		owner: `framescaperFinishing.surfaces.${surface}`, en,
	})),
]);

export const EDITOR_ENGLISH_COPY = inventory.english as EditorCopy;
export const EDITOR_GERMAN_COPY = inventory.german as EditorCopy;
export const EDITOR_COPY_METADATA = inventory.metadata;
