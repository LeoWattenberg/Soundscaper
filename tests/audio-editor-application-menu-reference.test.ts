/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	isAudacityShortcutCommandDisabled,
	resolveAudacityActionId,
} from '../src/common/editor/audacity-action-parity.js';
import { audioSelectionEffectLabel, audioSelectionEffectTypes, createEffect } from '../src/common/editor/effects.js';
import {
	createNativeMediaCapabilitySnapshotV1,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createLabel, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';
import {
	APPLICATION_MENU_REFERENCE_BY_ID,
	APPLICATION_MENU_REFERENCE_ENTRIES,
} from '../src/common/editor/ui/application-menu-reference.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { createDesktopHostMenuItems } from '../src/common/editor/ui/desktop-host-menu.ts';
import { FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES } from '../src/common/editor/ui/framescaper-native-project-actions.ts';
import { FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS } from '../src/common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { FREESOUND_ATTRIBUTION_INVENTORY_COPY_BY_LOCALE } from '../src/common/i18n/editor-freesound-attribution-inventory-copy.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type ProductId = 'soundscaper' | 'framescaper';

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly documentationId?: string;
	readonly parityActionId?: string;
	readonly items?: readonly MenuItem[];
	readonly nativePreferences?: readonly MenuItem[];
	readonly onClick?: (...args: never[]) => unknown;
}

interface MenuSighting {
	readonly product: ProductId;
	readonly label: string;
	readonly location: string;
}

interface ApplicationMenuState {
	readonly project: unknown;
	readonly selectedTrackId: string;
	readonly selectedClipId: string;
	readonly freezeStatus?: 'none' | 'fresh';
}

const DYNAMIC_REFERENCE_LABELS = new Map([
	['recent-project', 'Recent project'],
	['workspace-custom', 'Custom workspace'],
	['framescaper-external-display', 'External display'],
]);
const APPLICATION_MENU_COPY = Object.freeze({
	...ENGLISH_COPY,
	'ui.freesoundAttribution.panel': FREESOUND_ATTRIBUTION_INVENTORY_COPY_BY_LOCALE.en.panel,
});

test('the supplemental application-menu reference is a frozen unique lookup', () => {
	assert.ok(Object.isFrozen(APPLICATION_MENU_REFERENCE_ENTRIES));
	assert.ok(Object.isFrozen(APPLICATION_MENU_REFERENCE_BY_ID));
	assert.ok(APPLICATION_MENU_REFERENCE_ENTRIES.length > 0);

	const ids = new Set<string>();
	for (const entry of APPLICATION_MENU_REFERENCE_ENTRIES) {
		assert.ok(Object.isFrozen(entry), entry.id);
		assert.ok(Object.isFrozen(entry.locations), entry.id);
		assert.ok(Object.isFrozen(entry.products), entry.id);
		assert.equal(entry.id.trim(), entry.id);
		assert.ok(entry.id.length > 0, entry.id);
		assert.ok(entry.label.trim().length > 0, entry.id);
		assert.ok(entry.locations.length > 0, entry.id);
		assert.ok(entry.locations.every((location) => location.trim().length > 0), entry.id);
		assert.ok(entry.products.length > 0, entry.id);
		assert.ok(entry.products.every((product) => product === 'soundscaper' || product === 'framescaper'), entry.id);
		assert.ok(entry.kind === 'command' || entry.kind === 'setting' || entry.kind === 'link', entry.id);
		assert.equal(ids.has(entry.id), false, entry.id);
		assert.equal(Object.hasOwn(AUDACITY_ACTION_MANIFEST, entry.id), false, entry.id);
		ids.add(entry.id);
		assert.equal(APPLICATION_MENU_REFERENCE_BY_ID[entry.id], entry);
	}

	assert.deepEqual(Object.keys(APPLICATION_MENU_REFERENCE_BY_ID).sort(), [...ids].sort());
});

test('every runnable application-menu leaf has one truthful handbook reference', () => {
	const sightings = new Map<string, MenuSighting[]>();
	const manifestAliases = new Map<string, Set<string>>();
	const unresolved: string[] = [];
	const invalidManifestRows: string[] = [];

	for (const product of ['soundscaper', 'framescaper'] as const) {
		for (const menus of richApplicationMenuMatrix(product)) {
			for (const menu of menus) {
				const materialized = materializeApplicationMenu(menu) as MenuItem;
				collectRunnableLeaves(materialized, [], product, sightings, manifestAliases, unresolved, invalidManifestRows);
				// Native preference controls are intentionally lifted out of Tools.items,
				// but remain menu-derived actions rendered by NativePreferencesPanel.
				for (const preference of materialized.nativePreferences ?? []) {
					collectRunnableLeaves(preference, [menuLabel(materialized)], product,
						sightings, manifestAliases, unresolved, invalidManifestRows);
				}
			}
		}
	}

	assert.deepEqual([...new Set(invalidManifestRows)].sort(), []);
	assert.deepEqual([...new Set(unresolved)].sort(), []);

	const unreachable: string[] = [];
	const metadataErrors: string[] = [];
	for (const entry of APPLICATION_MENU_REFERENCE_ENTRIES) {
		const observed = sightings.get(entry.id) ?? [];
		if (observed.length === 0) {
			const aliases = [...(manifestAliases.get(entry.id) ?? [])].sort();
			unreachable.push(aliases.length
				? `${entry.id} already resolves through the manifest as ${aliases.join(', ')}`
				: `${entry.id} is not a supplemental live leaf`);
			continue;
		}

		const observedProducts = uniqueSorted(observed.map(({ product }) => product));
		const documentedProducts = uniqueSorted(entry.products);
		if (!sameStrings(observedProducts, documentedProducts)) {
			metadataErrors.push(`${entry.id} products: ${documentedProducts.join('; ')} != ${observedProducts.join('; ')}`);
		}
		const observedLocations = uniqueSorted(observed.map(({ location }) => location));
		const documentedLocations = uniqueSorted(entry.locations);
		if (!sameStrings(observedLocations, documentedLocations)) {
			metadataErrors.push(`${entry.id} locations: ${documentedLocations.join('; ')} != ${observedLocations.join('; ')}`);
		}

		const genericLabel = DYNAMIC_REFERENCE_LABELS.get(entry.id);
		if (genericLabel !== undefined) {
			if (entry.label !== genericLabel) {
				metadataErrors.push(`${entry.id} label: ${JSON.stringify(entry.label)} != ${JSON.stringify(genericLabel)}`);
			}
		} else {
			const observedLabels = uniqueSorted(observed.map(({ label }) => label));
			if (observedLabels.length !== 1 || observedLabels[0] !== entry.label) {
				metadataErrors.push(`${entry.id} label ${JSON.stringify(entry.label)} is not live: ${observedLabels.join('; ')}`);
			}
		}
	}

	assert.deepEqual([
		...unreachable.sort(),
		...metadataErrors,
	], []);
});

function collectRunnableLeaves(
	item: MenuItem,
	parents: readonly string[],
	product: ProductId,
	sightings: Map<string, MenuSighting[]>,
	manifestAliases: Map<string, Set<string>>,
	unresolved: string[],
	invalidManifestRows: string[],
): void {
	if (item.items?.length) {
		const nextParents = [...parents, item.id === 'soundscaper-freeze' ? 'Freeze' : menuLabel(item)];
		for (const child of item.items) {
			collectRunnableLeaves(child, nextParents, product, sightings, manifestAliases, unresolved, invalidManifestRows);
		}
		return;
	}
	if (typeof item.onClick !== 'function') return;
	assert.ok(item.id, `Runnable ${parents.join(' > ')} leaf has no id.`);
	assert.ok(item.label, `Runnable ${item.id} leaf has no label.`);

	const documentationId = item.documentationId
		?? item.parityActionId
		?? resolveAudacityActionId(item.id);
	const manifest = AUDACITY_ACTION_MANIFEST[documentationId];
	if (manifest !== undefined) {
		const productDisabled = isAudacityShortcutCommandDisabled(
			documentationId,
			PRODUCT_PROFILES[product].shortcuts?.disabledCommandIds ?? [],
		);
		if (manifest.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED
			|| manifest.menuVisible === false || productDisabled) {
			invalidManifestRows.push(`${product}:${item.id}->${documentationId}`);
		}
		if (item.id !== documentationId) {
			const aliases = manifestAliases.get(item.id) ?? new Set<string>();
			aliases.add(documentationId);
			manifestAliases.set(item.id, aliases);
		}
		return;
	}
	if (!Object.hasOwn(APPLICATION_MENU_REFERENCE_BY_ID, documentationId)) {
		unresolved.push(`${product}:${parents.join(' > ')}:${item.id}->${documentationId}`);
		return;
	}

	const observed = sightings.get(documentationId) ?? [];
	observed.push({ product, label: item.label, location: parents.join(' > ') });
	sightings.set(documentationId, observed);
}

function richApplicationMenuMatrix(product: ProductId): readonly (readonly MenuItem[])[] {
	if (product === 'soundscaper') {
		const editable = richSoundscaperProject();
		return [
			applicationMenusForState(product, {
				project: editable, selectedTrackId: 'voice-track', selectedClipId: 'voice-clip', freezeStatus: 'none',
			}),
			applicationMenusForState(product, {
				project: frozenSoundscaperProject(editable),
				selectedTrackId: 'voice-track', selectedClipId: 'voice-clip', freezeStatus: 'fresh',
			}),
			applicationMenusForState(product, {
				project: richSoundscaperVideoProject(), selectedTrackId: 'video-track', selectedClipId: 'video-clip',
			}),
		];
	}
	const ungrouped = richFramescaperProject(false, 'video');
	return [
		applicationMenusForState(product, {
			project: ungrouped, selectedTrackId: 'video-track', selectedClipId: 'video-clip',
		}),
		applicationMenusForState(product, {
			project: richFramescaperProject(true, 'video'), selectedTrackId: 'video-track', selectedClipId: 'video-clip',
		}),
		applicationMenusForState(product, {
			project: richFramescaperProject(false, 'audio'), selectedTrackId: 'audio-track', selectedClipId: 'audio-clip',
		}),
	];
}

function applicationMenusForState(product: ProductId, state: ApplicationMenuState): readonly MenuItem[] {
	const profile = PRODUCT_PROFILES[product];
	const project = state.project as Readonly<{
		readonly clips: readonly Readonly<{ readonly id: string }>[];
		readonly selection: unknown;
	}>;
	const selectedClip = project.clips.find(({ id }) => id === state.selectedClipId) ?? null;
	const preferences = createAudioEditorPreferencesV1({
		workspace: {
			activeId: product === 'soundscaper' ? 'modern' : 'video-editor',
			custom: [{ id: 'reference-fixture', name: 'Reference workspace', layout: { columns: 2 } }],
		},
	});
	const actions = richActions(state.freezeStatus ?? 'none');
	const snapshot = {
		productId: product,
		project,
		capabilities: profile.capabilities,
		selectedTrackId: state.selectedTrackId,
		selection: project.selection,
		readOnly: false,
		lockReadOnly: true,
		recentProjects: [{ id: 'reference-fixture', title: 'Recent fixture' }],
		deliveryReport: {},
		archiveManifest: { manifest: {} },
		preferences,
		history: { canUndo: true, canRedo: true, hasClipboard: true },
		effects: {
			selectionTypes: audioSelectionEffectTypes().map((type) => ({
				type, label: audioSelectionEffectLabel(type, 'en'),
			})),
			canRepeatLast: true,
			lastSelectionType: 'eq',
		},
		generators: { canRepeatLast: true },
		analysisRepeatable: true,
		analysisProcessing: false,
		timeline: { view: 'spectrogram', showRms: true, showVerticalRulers: true },
		loopOptions: { selectionFollows: true },
	};

	return createApplicationMenus({
		productId: product,
		aboutLabel: `About ${profile.name}`,
		capabilities: profile.capabilities,
		locale: 'en',
		copy: APPLICATION_MENU_COPY,
		desktopHost: richDesktopHost(product, profile.name) as never,
		project,
		snapshot,
		blocked: false,
		editBlocked: false,
		handoffBlocked: false,
		showArmControls: true,
		selectionActive: true,
		selectedClip,
		durationFrames: 48_000,
		effectsPanelOpen: true,
		projectBinEffectivelyOpen: true,
		uiFlags: { clipping: true, statusbar: true, storagePanel: true, tracksPanel: true, trackHeaderDrawer: true },
		compactLayout: true,
		actionRuntime: null,
		actions,
		crossProductHandoffAvailable: true,
	}) as readonly MenuItem[];
}

function richSoundscaperProject() {
	const source = createAudioSource({
		id: 'voice-source', name: 'Voice', storageKey: 'voice-source', mimeType: 'audio/wav',
		frameCount: 48_000, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
	});
	return createSoundscaperProject({
		id: 'menu-reference-soundscaper', title: 'Menu reference', now: '2026-09-20T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [
			createAudioTrack({
				id: 'voice-track', name: 'Voice', clipIds: [clip.id], displayMode: 'spectrogram',
				effects: [createEffect('delay', { id: 'voice-delay' })],
			}),
			createLabelTrack({
				id: 'label-track', name: 'Labels',
				labels: [createLabel({ id: 'label', title: 'Line', startFrame: 100, endFrame: 1_000 })],
			}),
		],
		selection: {
			startFrame: 0, endFrame: 48_000, trackIds: ['voice-track', 'label-track'], clipIds: ['voice-clip'],
			frequencyRange: { minimumFrequency: 80, maximumFrequency: 8_000 },
		},
		loop: { enabled: true, startFrame: 0, endFrame: 48_000 },
		snap: { enabled: true, unit: '1/4', division: '1/4', mode: 'nearest', triplets: false },
	});
}

function frozenSoundscaperProject(project: ReturnType<typeof richSoundscaperProject>) {
	return {
		...project,
		tracks: project.tracks.map((track) => track.id === 'voice-track'
			? { ...track, audioFreeze: { schemaVersion: 1 } }
			: track),
	};
}

function richSoundscaperVideoProject() {
	return createSoundscaperProject({
		...framescaperV20Options(),
		selection: { startFrame: 0, endFrame: 4_800, trackIds: ['video-track'], clipIds: ['video-clip'] },
		loop: { enabled: true, startFrame: 0, endFrame: 4_800 },
		snap: { enabled: true, unit: '1/4', division: '1/4', mode: 'nearest', triplets: false },
	} as never);
}

function richFramescaperProject(grouped: boolean, selection: 'video' | 'audio') {
	const options = framescaperV20Options();
	const secondVideoSource = {
		...(options.sources as readonly Readonly<Record<string, unknown>>[])[0],
		id: 'video-source-b', name: 'Second camera', storageKey: 'video-source-b',
		contentSha256: '34'.repeat(32),
	};
	const selectedClipId = selection === 'video' ? 'video-clip' : 'audio-clip';
	const selectedTrackId = selection === 'video' ? 'video-track' : 'audio-track';
	return createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		...options,
		sources: [...options.sources as readonly unknown[], secondVideoSource],
		clips: (options.clips as readonly Readonly<Record<string, unknown>>[]).map((clip) => ({
			...clip, avLinkId: grouped ? 'picture-and-sound-link' : null,
		})),
		tracks: (options.tracks as readonly Readonly<Record<string, unknown>>[]).map((track) => ({
			...track, laneGroupId: 'picture-and-sound',
		})),
		selection: {
			startFrame: 0, endFrame: 4_800, trackIds: [selectedTrackId], clipIds: [selectedClipId],
		},
		loop: { enabled: true, startFrame: 0, endFrame: 4_800 },
		snap: { enabled: true, unit: '1/4', division: '1/4', mode: 'nearest', triplets: false },
		sequences: [
			...options.sequences as readonly unknown[],
			sequence('shared-sequence', 'Shared sequence'),
			sequence('delete-sequence', 'Delete sequence'),
		],
		subsequences: [{
			id: 'nested', sequenceId: 'main-sequence', sourceSequenceId: 'shared-sequence',
			sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 24,
		}],
		multicameraGroups: grouped ? [{
			id: 'multicamera-group', projectId: String(options.id), sequenceId: 'main-sequence',
			outputClipId: 'video-clip', activeMemberId: 'camera-a',
			members: [
				{ id: 'camera-a', groupId: 'multicamera-group', sourceId: 'video-source', syncOffsetSamples: 0 },
				{ id: 'camera-b', groupId: 'multicamera-group', sourceId: 'video-source-b', syncOffsetSamples: 0 },
			],
		}] : [],
	} as never);
}

function sequence(id: string, name: string): Readonly<Record<string, unknown>> {
	return {
		id, name, rate: { num: 24, den: 1 }, dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		trackIds: [], trackNodes: [],
	};
}

function richActions(freezeStatus: 'none' | 'fresh'): Record<string, unknown> {
	const noop = () => undefined;
	const nativeCapabilitySnapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: Object.values(NATIVE_MEDIA_CAPABILITY_IDS).map(({ domain, id }) => ({
			domain, id, buildSupported: true, probeSucceeded: true, selfTestPassed: true,
			quarantined: false, degraded: false, userEnabled: true,
		})),
	});
	const explicit: Record<string, unknown> = {
		openLocalAssistance: noop,
		openLocalAssistanceIndexedSearch: noop,
		openLocalModels: noop,
		installAvailable: () => true,
		installApplication: noop,
		soundscaperWorkflow: {
			freezeStatus, freezeActionsAvailable: true, openMasteringSequences: noop, freeze: noop,
		},
		soundscaperNativeServices: {
			snapshot: {
				enabled: true, quarantined: false, payloadAvailable: true, payloadDetail: '',
				pluginEnabled: true, pluginQuarantined: false,
				pluginPayloadAvailable: true, pluginPayloadDetail: '',
				usableAudioBackends: ['fixture'], enabledPluginFormats: ['fixture', 'vamp'],
			},
			open: noop,
		},
		framescaperCandidateAuthoring: { surfaces: FRAMESCAPER_CANDIDATE_AUTHORING_SURFACES, open: noop },
		openFramescaperFinishing: noop,
		framescaperNativeServices: {
			capabilitySnapshot: nativeCapabilitySnapshot,
			externalDisplays: [{
				displayId: 'secondary', label: 'Client monitor', primary: false,
				width: 1_920, height: 1_080, hdrCapable: true, colorManaged: true,
			}],
			activeExternalDisplayId: 'secondary',
			lifecycleMethods: FRAMESCAPER_NATIVE_SERVICES_LIFECYCLE_METHODS,
			projectActionSurfaces: FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
			open: noop,
			openExternalDisplay: noop,
		},
	};
	return new Proxy(explicit, {
		get(target, property, receiver) {
			return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : noop;
		},
	});
}

function richDesktopHost(productId: ProductId, productName: string) {
	const noop = () => undefined;
	return createDesktopHostMenuItems({
		copy: ENGLISH_COPY,
		development: true,
		platform: 'linux',
		productId,
		productName,
		snapshot: {
			probeHelperEnabled: true,
			probeHelperQuarantined: true,
			audioHelperEnabled: true,
			audioHelperQuarantined: true,
			nativeEffectDiscoveryEnabled: true,
		},
		applyNativeTierControl: noop,
		runWindowAction: noop,
		checkForUpdates: noop,
		openExternal: noop,
	});
}

function menuLabel(item: MenuItem): string {
	assert.ok(item.label, `Menu ${String(item.id)} has no label.`);
	return item.label;
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
