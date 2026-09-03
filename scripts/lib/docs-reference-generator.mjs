/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Composition root for the generated handbook reference pages.
 *
 * Each page has its own renderer under `docs-reference/`; this module is the
 * only place that knows which runtime registries exist and how to hand them to
 * a renderer. A renderer never reaches into the repository itself, so every
 * page stays a pure function of values a test can supply.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderAssistanceReference } from './docs-reference/assistance.mjs';
import { renderAudioEffectReference } from './docs-reference/audio-effects.mjs';
import { renderCapabilityReference } from './docs-reference/capabilities.mjs';
import { renderCommandReference } from './docs-reference/commands.mjs';
import { renderFormatReference } from './docs-reference/formats.mjs';
import { renderLanguageReference } from './docs-reference/languages.mjs';
import { renderNyquistReference } from './docs-reference/nyquist.mjs';
import { renderPlatformReference } from './docs-reference/platforms.mjs';
import { renderProjectFileReference } from './docs-reference/project-files.mjs';
import { renderVideoEffectReference } from './docs-reference/video-effects.mjs';
import { renderLessonPages } from './docs-reference/lessons.mjs';
import { renderWorkspaceReference } from './docs-reference/workspaces.mjs';
import { GENERATED_LESSON_DIRECTORY, GENERATED_REFERENCE_DIRECTORY, syncReferenceDocuments } from './docs-reference/sync.mjs';

export { GENERATED_LESSON_DIRECTORY, GENERATED_REFERENCE_DIRECTORY, syncReferenceDocuments };
export { escapeMarkdownTableCell } from './docs-reference/markdown.mjs';
export {
	renderAssistanceReference,
	renderAudioEffectReference,
	renderCapabilityReference,
	renderCommandReference,
	renderFormatReference,
	renderLanguageReference,
	renderLessonPages,
	renderNyquistReference,
	renderPlatformReference,
	renderProjectFileReference,
	renderVideoEffectReference,
	renderWorkspaceReference,
};

const LESSON_MODULES = Object.freeze({
	lessons: 'handbook/lessons/soundscaper.mjs',
	lessonFixtures: 'handbook/lessons/fixtures.mjs',
	lessonSteps: 'handbook/lessons/steps.mjs',
});

const RUNTIME_MODULES = Object.freeze({
	actions: 'src/common/editor/audacity-action-parity.js',
	assistance: 'src/common/editor/assistance/workflow-recipes.ts',
	assistanceOperations: 'src/common/editor/assistance/operation.ts',
	audacityEffects: 'src/common/editor/audacity-effects/manifest.js',
	copy: 'src/common/i18n/catalogs.js',
	copyKeys: 'src/common/i18n/canonical-extras.js',
	effectHelpers: 'src/common/editor/ui/inspector/effect-helpers.ts',
	effects: 'src/common/editor/effects.js',
	exportSettings: 'src/common/editor/controller/export-settings.ts',
	factoryPresets: 'src/common/editor/audacity-effects/factory-presets.js',
	labels: 'src/common/editor/label-io.js',
	liveEffects: 'src/common/editor/audacity-effects/live-capabilities.js',
	locales: 'src/common/i18n/locales.js',
	media: 'src/common/editor/media-export.js',
	nyquist: 'src/common/editor/nyquist/plugin-registry.js',
	panels: 'src/common/editor/ui/workspace/workspace-panel-model.ts',
	products: 'src/common/products.js',
	projectFiles: 'src/common/project-file-extensions.ts',
	scapeFormat: 'src/common/editor/scape-project-format.ts',
	staffPad: 'src/common/editor/audacity-effects/contracts.js',
	video: 'src/common/editor/video-export.js',
	videoEffects: 'src/common/editor/video-effects.js',
	workspaces: 'src/common/editor/workspace-layout-defaults.ts',
});

const RUNTIME_CONFIGURATION = Object.freeze({
	modelCatalog: 'config/local-model-catalog.json',
	productionCapabilities: 'config/production-capabilities.json',
});

const DESKTOP_PACKAGING_CONFIGURATION = 'electron-builder.config.cjs';

function moduleUrl(repositoryRoot, relativePath) {
	return pathToFileURL(resolve(repositoryRoot, relativePath)).href;
}

async function readJson(repositoryRoot, relativePath) {
	return JSON.parse(await readFile(resolve(repositoryRoot, relativePath), 'utf8'));
}

export async function loadReferenceSources(repositoryRoot) {
	const names = Object.keys(RUNTIME_MODULES);
	const loaded = await Promise.all(names.map((name) => import(moduleUrl(repositoryRoot, RUNTIME_MODULES[name]))));
	const configurationNames = Object.keys(RUNTIME_CONFIGURATION);
	const configurations = await Promise.all(
		configurationNames.map((name) => readJson(repositoryRoot, RUNTIME_CONFIGURATION[name])),
	);
	// The packaging configuration is CommonJS and is read for its target lists
	// only, so that the desktop package formats on the platforms page cannot
	// drift from the formats electron-builder is actually told to produce.
	const packaging = createRequire(moduleUrl(repositoryRoot, 'package.json'))(`./${DESKTOP_PACKAGING_CONFIGURATION}`);
	return Object.freeze({
		...Object.fromEntries(names.map((name, index) => [name, loaded[index]])),
		...Object.fromEntries(configurationNames.map((name, index) => [name, configurations[index]])),
		packageTargets: Object.freeze({
			win: packaging.win.target,
			mac: packaging.mac.target,
			linux: packaging.linux.target,
		}),
	});
}

/** Resolve reviewed English copy, or report that the identifier has none. */
function copyResolver(sources) {
	const { canonicalCopyValue } = sources.copyKeys;
	return (key) => {
		const value = canonicalCopyValue(key, 'en');
		return value === key ? null : value;
	};
}

function audioEffectInputs(sources, productProfiles) {
	const {
		audacityEffects, copyKeys, effectHelpers, effects, factoryPresets, liveEffects, staffPad,
	} = sources;
	const resolveCopy = copyResolver(sources);
	// The editor's own resolver owns parameter naming, so a reader meets the
	// same word the effect panel shows rather than a second vocabulary.
	const englishCopy = sources.copy.COPY_BY_LOCALE.en;
	return {
		products: productProfiles,
		audacityDefinitions: audacityEffects.AUDACITY_EFFECT_DEFINITIONS,
		audacitySource: audacityEffects.AUDACITY_EFFECT_SOURCE,
		staffPadSource: audacityEffects.AUDACITY_STAFFPAD_SOURCE,
		staffPadEffectTypes: staffPad.AUDACITY_STAFFPAD_EFFECT_TYPES,
		factoryPresets: factoryPresets.AUDACITY_EFFECT_FACTORY_PRESETS,
		factoryPresetSource: factoryPresets.AUDACITY_FACTORY_PRESET_SOURCE,
		liveCapability: (type) => liveEffects.audacityLiveEffectCapability(type),
		// The rack and selection registries each merge the Audacity inventory
		// into the local one, so their union is every documented definition and
		// the Audacity manifest still wins wherever both describe a type.
		localDefinitions: {
			...effects.AUDIO_RACK_EFFECT_DEFINITIONS,
			...effects.AUDIO_SELECTION_EFFECT_DEFINITIONS,
		},
		rackEffectTypes: Object.keys(effects.AUDIO_RACK_EFFECT_DEFINITIONS),
		selectionEffectTypes: Object.keys(effects.AUDIO_SELECTION_EFFECT_DEFINITIONS),
		effectLabel: (type) => effects.audioSelectionEffectLabel(type, 'en'),
		parameterLabel: (type, name) => effectHelpers.nativeEffectParameterLabel(type, name, englishCopy),
		optionLabel: (type, name, value) => resolveCopy(copyKeys.effectOptionCopyKey(type, name, value)),
		formatCurve: audacityEffects.formatAudacityCurve,
	};
}

export function renderReferenceDocuments(sources) {
	const {
		actions, assistance, assistanceOperations, copy, exportSettings, labels, locales, media,
		modelCatalog, nyquist, packageTargets, panels, productionCapabilities, products, projectFiles,
		scapeFormat, video, videoEffects, workspaces,
	} = sources;
	const productProfiles = products.PRODUCT_IDS.map((id) => products.PRODUCT_PROFILES[id]);
	const englishCopy = copy.COPY_BY_LOCALE.en;
	return new Map([
		['commands.md', renderCommandReference({
			manifest: actions.AUDACITY_ACTION_MANIFEST,
			implementedStatus: actions.AUDACITY_ACTION_STATUS.IMPLEMENTED,
			products: productProfiles,
			source: actions.AUDACITY_ACTION_SOURCE,
			isProductCommandDisabled: actions.isAudacityShortcutCommandDisabled,
		})],
		['formats.md', renderFormatReference({
			products: productProfiles,
			audioFormatIds: exportSettings.EDITOR_EXPORT_FORMATS,
			audioFormats: media.MEDIA_EXPORT_FORMATS,
			videoFormats: video.VIDEO_EXPORT_FORMATS,
		})],
		['product-capabilities.md', renderCapabilityReference({ products: productProfiles })],
		['audio-effects.md', renderAudioEffectReference(audioEffectInputs(sources, productProfiles))],
		['video-effects.md', renderVideoEffectReference({
			products: productProfiles,
			definitions: videoEffects.VIDEO_EFFECT_DEFINITIONS,
		})],
		['nyquist-plugins.md', renderNyquistReference({
			plugins: nyquist.NYQUIST_BUNDLED_PLUGINS,
			products: productProfiles,
			isProductCommandDisabled: actions.isAudacityShortcutCommandDisabled,
		})],
		['local-assistance.md', renderAssistanceReference({
			products: productProfiles,
			guidedWorkflowIds: assistance.ASSISTANCE_GUIDED_WORKFLOW_IDS,
			operations: assistanceOperations.ASSISTANCE_OPERATIONS,
			stageGraph: assistance.assistanceWorkflowStageGraph,
			modelCatalog,
		})],
		['workspaces.md', renderWorkspaceReference({
			products: productProfiles,
			copy: englishCopy,
			builtInWorkspaces: workspaces.AUDIO_EDITOR_BUILT_IN_WORKSPACES,
			presets: workspaces.AUDIO_EDITOR_WORKSPACE_PRESETS,
			defaultPanels: workspaces.DEFAULT_PANELS,
			panelIds: panels.WORKSPACE_DISCOVERABLE_PANEL_IDS,
			toolbarIds: panels.WORKSPACE_TOOLBAR_IDS,
			dockIds: panels.WORKSPACE_DOCK_IDS,
			panelLabel: panels.workspacePanelLabel,
			dockLabel: panels.workspaceDockLabel,
			isProductCommandDisabled: actions.isAudacityShortcutCommandDisabled,
		})],
		['project-files.md', renderProjectFileReference({
			products: productProfiles,
			extensionByProduct: projectFiles.PROJECT_FILE_EXTENSION_BY_PRODUCT,
			acceptedExtensions: projectFiles.ACCEPTED_PROJECT_FILE_EXTENSIONS,
			legacyExtension: projectFiles.LEGACY_PROJECT_FILE_EXTENSION,
			mimeType: scapeFormat.SCAPE_MIME_TYPE,
			labelImportFormats: labels.AUDIO_EDITOR_LABEL_FORMATS,
			labelExportFormats: labels.AUDIO_EDITOR_LABEL_EXPORT_FORMATS,
		})],
		['languages.md', renderLanguageReference({
			routeLocales: locales.ROUTE_LOCALES,
			bundledLocaleTags: locales.DEFAULT_LOCALE_TAGS,
			localePath: locales.localePath,
		})],
		['platforms.md', renderPlatformReference({
			capabilities: productionCapabilities,
			packageTargets,
		})],
	]);
}

/** The lesson catalog and the two modules that give it words and example files. */
export async function loadLessonSources(repositoryRoot) {
	const names = Object.keys(LESSON_MODULES);
	const loaded = await Promise.all(names.map((name) => import(moduleUrl(repositoryRoot, LESSON_MODULES[name]))));
	return Object.freeze(Object.fromEntries(names.map((name, index) => [name, loaded[index]])));
}

export function renderLessonDocuments({ lessons, lessonFixtures, lessonSteps }) {
	return renderLessonPages({
		groups: lessons.SOUNDSCAPER_LESSON_GROUPS,
		describeStep: lessonSteps.describeStep,
		fixtureFile: lessonFixtures.lessonFixtureFile,
	});
}

export async function generateReferenceDocuments(repositoryRoot, { write = true } = {}) {
	const sources = await loadReferenceSources(repositoryRoot);
	const documents = renderReferenceDocuments(sources);
	const result = await syncReferenceDocuments(repositoryRoot, documents, { write });
	const lessonDocuments = renderLessonDocuments(await loadLessonSources(repositoryRoot));
	const lessonResult = await syncReferenceDocuments(repositoryRoot, lessonDocuments, {
		write, directory: GENERATED_LESSON_DIRECTORY,
	});
	return Object.freeze({
		stale: Object.freeze([...result.stale, ...lessonResult.stale.map((name) => `lessons/${name}`)]),
		documentCount: documents.size + lessonDocuments.size,
	});
}
