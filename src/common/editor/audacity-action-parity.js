/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Audacity 4 browser action-parity runtime.
 *
 * The inventory this reads lives in audacity-action-inventory.js and is
 * intentionally pinned: updating it means reviewing the upstream menus and
 * action registrations at the new commit, not merely changing
 * AUDACITY_ACTION_SOURCE.commit.
 */

import {
	AUDACITY_DISABLED_REASONS as DISABLED_REASONS,
	localizedAudacityParityLabel,
	localizedAudacityReason,
} from '../i18n/action-parity.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';
import { audacitySpectrogramTrackSelected } from './audacity-action-enablement.ts';
import { audacityShortcutCommandDisabled } from './audacity-shortcut-command-inventory.ts';
import { selectAudioEditorEditBlock } from './edit-blocking.ts';
import { audioTrackChannelCount } from './project-audio-factory.js';
import { AUDACITY_ACTION_ALIASES } from './audacity-action-aliases.js';
import { AUDACITY_ACTION_DEFINITIONS, AUDACITY_ACTION_STATUS } from './audacity-action-inventory.js';
import {
	AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	audioEditorPrimaryShortcut,
} from './audacity-shortcut-bindings.ts';

export const AUDACITY_ACTION_SOURCE = deepFreeze({
	version: '4.0.0',
	commit: '4c177d436e48c1d20f231eada44035593cb26292',
	url: 'https://github.com/audacity/audacity/tree/4c177d436e48c1d20f231eada44035593cb26292/src',
});

export { AUDACITY_ACTION_ALIASES, AUDACITY_ACTION_STATUS };

export const AUDACITY_ACTION_MANIFEST = deepFreeze(toManifest(AUDACITY_ACTION_DEFINITIONS));

export function resolveAudacityActionId(id) {
	return Object.hasOwn(AUDACITY_ACTION_ALIASES, id) ? AUDACITY_ACTION_ALIASES[id] : id;
}

export function audacityActionDefinition(id) {
	return matchAudacityAction(id)?.definition || null;
}

export function audacityActionReason(id, copyOrLocale = 'en') {
	const reason = audacityActionDefinition(id)?.reason;
	return localizedAudacityReason(reason, copyOrLocale);
}

/**
 * Evaluate a manifest predicate against a controller/runtime snapshot.
 * Disabled and excluded records always evaluate false, regardless of state.
 */
export function evaluateAudacityActionEnablement(id, context) {
	const definition = audacityActionDefinition(id);
	if (!definition || definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) return false;
	return evaluateAudacityEnableWhen(definition.enableWhen, resolveActionContext(context));
}

/** Evaluate one of the closed predicate vocabulary entries used by the manifest. */
export function evaluateAudacityEnableWhen(enableWhen, context = {}) {
	if (typeof enableWhen !== 'string' || !enableWhen) throw new TypeError('An Audacity enableWhen predicate is required.');
	const resolvedContext = resolveActionContext(context);
	const override = resolvedContext?.predicates?.[enableWhen];
	if (typeof override === 'boolean') return override;

	const snapshot = resolvedContext?.snapshot || {};
	const project = snapshot.project || null;
	const telemetry = resolvedContext?.telemetry || {};
	const ui = resolvedContext?.ui || {};
	const tracks = project?.tracks || [];
	const clips = project?.clips || [];
	const selection = project?.selection || snapshot.selection || {};
	const selectedClipIds = uniqueExistingIds([
		snapshot.selectedClipId,
		...(selection.clipIds || []),
	], clips);
	const selectedClips = selectedClipIds.map((clipId) => clips.find((clip) => clip.id === clipId)).filter(Boolean);
	const selectedTrackIds = uniqueExistingIds([
		snapshot.selectedTrackId,
		...(selection.trackIds || []),
		...selectedClips.map((clip) => tracks.find((track) => track.clipIds?.includes(clip.id))?.id),
	], tracks);
	const selectedTracks = selectedTrackIds.map((trackId) => tracks.find((track) => track.id === trackId)).filter(Boolean);
	const selectedTrack = selectedTracks[0] || null;
	const selectedAudioTrack = selectedTracks.find((track) => track.type === 'audio') || null;
	const focusedTrack = tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedMediaTrack = (selection.trackIds?.length ? selection.trackIds : [snapshot.selectedTrackId])
		.some((id) => tracks.some((track) => track.id === id && track.type !== 'label'));
	const selectedClip = selectedClips[0] || null;
	const selectedAudioClip = selectedClip?.kind === 'audio' ? selectedClip : null;
	const timeSelection = Number.isSafeInteger(selection.startFrame)
		&& Number.isSafeInteger(selection.endFrame)
		&& selection.endFrame > selection.startFrame;
	const frequencySelection = timeSelection
		&& Number.isFinite(selection.frequencyRange?.minimumFrequency)
		&& Number.isFinite(selection.frequencyRange?.maximumFrequency)
		&& selection.frequencyRange.maximumFrequency > selection.frequencyRange.minimumFrequency;
	const projectOpened = Boolean(project);
	const projectWritable = projectOpened && !snapshot.readOnly;
	const recording = Boolean(snapshot.recording || snapshot.recordingStarting || telemetry.recording);
	const playing = telemetry.transportState === 'playing';
	const editable = projectWritable && !selectAudioEditorEditBlock(snapshot).blocked && !telemetry.recording;
	const projectHasAudio = tracks.some((track) => track.type === 'audio' && track.clipIds?.length);
	const audioSelection = timeSelection && Boolean(selectedAudioTrack || projectHasAudio);
	const realtimeEffectId = resolvedContext?.realtimeEffectId || null;
	const realtimeEffects = selectedAudioTrack?.effects || [];
	const realtimeEffectIndex = realtimeEffects.findIndex((effect) => effect.id === realtimeEffectId);
	const selectedClipPitchCents = Number.isFinite(Number(selectedAudioClip?.pitchCents))
		? Number(selectedAudioClip.pitchCents)
		: 0;
	const effectOpened = typeof resolvedContext?.effectOpened === 'boolean'
		? resolvedContext.effectOpened
		: ['selection-effect', 'generator'].includes(ui.request?.payload?.surface);
	const effectPresetId = resolvedContext?.effectPresetId || null;
	const effectPreset = effectPresetId
		? snapshot.effects?.presets?.find((preset) => preset.id === effectPresetId) || null
		: null;
	const effectPresetSelected = Boolean(effectPreset);
	// Audacity's Save and Delete act on the presets a user wrote; the presets it
	// ships can only be applied, exported, or saved onward under a new name.
	const effectPresetEditable = Boolean(effectPreset && effectPreset.custom !== false);
	const hasSelection = timeSelection || selectedTrackIds.length > 0 || selectedClipIds.length > 0;
	const predicates = {
		always: true,
		never: false,
		'project-opened': projectOpened,
		'project-writable': projectWritable,
		'editable-project': editable,
		'project-writable-and-not-recording': projectWritable && !recording,
		'project-has-audio': projectHasAudio,
		'recent-projects': Boolean(snapshot.recentProjects?.length),
		'history-can-undo': Boolean(snapshot.history?.canUndo),
		'history-can-redo': Boolean(snapshot.history?.canRedo),
		selection: hasSelection,
		'time-selection': timeSelection,
		'audio-selection': audioSelection,
		'audio-selection-or-clip': audioSelection || Boolean(selectedClip),
		'editable-selection': editable && audioSelection,
		'editable-selection-or-clip': editable && (audioSelection || Boolean(selectedClip)),
		'playing-or-editable-clip-or-project-cursor': playing || (projectOpened && (!selectedClip || editable)),
		'clipboard-and-project-writable': projectWritable && Boolean(snapshot.history?.hasClipboard),
		'clip-selected': Boolean(selectedClip),
		'editable-clip-selected': editable && Boolean(selectedClip),
		'editable-transformed-clip': editable && Boolean(selectedClip) && clipHasTimePitchTransform(selectedClip),
		'multiple-editable-clips': editable && selectedClips.length > 1,
		'grouped-editable-clips': editable && selectedClips.some((clip) => Boolean(clip.groupId)),
		'track-selected': Boolean(selectedTrack),
		'editable-track-selected': editable && Boolean(selectedTrack),
		'audio-track-selected': Boolean(selectedAudioTrack),
		'editable-audio-track-selected': editable && Boolean(selectedAudioTrack),
		'editable-selected-media-tracks': editable && selectedMediaTrack,
		'editable-focused-audio-track': editable && focusedTrack?.type === 'audio',
		'editable-focused-media-track': editable && Boolean(focusedTrack && focusedTrack.type !== 'label'),
		'stereo-track-selected': audioTrackChannelCount(project, selectedAudioTrack) === 2,
		'compatible-mono-tracks': editable && audioTrackChannelCount(project, selectedAudioTrack) === 1 && tracks.some((track) => (
			track.id !== selectedAudioTrack.id && track.type === 'audio' && audioTrackChannelCount(project, track) === 1
		)),
		'label-track-present': tracks.some((track) => track.type === 'label'),
		'loop-region': Boolean(project?.loop?.enabled && project.loop.endFrame > project.loop.startFrame),
		playing,
		'playing-or-recording': playing || recording,
		recording,
		'not-recording': !recording,
		'sound-activation-preferences-available': projectOpened && snapshot.productId === 'soundscaper' && Boolean(snapshot.recordingInputs?.soundActivation),
		'sound-activation-preferences-mutable': projectWritable && snapshot.productId === 'soundscaper' && Boolean(snapshot.recordingInputs?.soundActivation) && !snapshot.recordingInputs?.soundActivation?.preferenceMutationBlocked,
		'spectrogram-track-selected': audacitySpectrogramTrackSelected(selectedAudioTrack, snapshot),
		'editable-spectrogram-track-selected': editable && audacitySpectrogramTrackSelected(selectedAudioTrack, snapshot),
		'editable-frequency-selection': editable && Boolean(selectedAudioTrack) && frequencySelection,
		'sample-pencil-available': editable && Boolean(selectedAudioClip) && snapshot.sampleEdit?.available === true,
		'repeatable-effect-and-editable-selection': editable && (audioSelection || Boolean(selectedClip)) && Boolean(snapshot.effects?.canRepeatLast),
		'repeatable-generator': editable && Boolean(snapshot.generators?.canRepeatLast),
		'repeatable-analyzer': projectHasAudio && Boolean(snapshot.analysisRepeatable),
		'effect-opened': effectOpened,
		'effect-preset-selected': effectPresetSelected,
		'editable-effect-preset-selected': projectWritable && effectPresetEditable,
		'realtime-effect-selected': realtimeEffectIndex >= 0,
		'realtime-effect-can-move-up': realtimeEffectIndex > 0,
		'realtime-effect-can-move-down': realtimeEffectIndex >= 0 && realtimeEffectIndex < realtimeEffects.length - 1,
		'contextual-pitch-or-effect-up': realtimeEffectId
			? realtimeEffectIndex > 0
			: editable && Boolean(selectedAudioClip) && selectedClipPitchCents <= 1_100,
		'contextual-pitch-or-effect-down': realtimeEffectId
			? realtimeEffectIndex >= 0 && realtimeEffectIndex < realtimeEffects.length - 1
			: editable && Boolean(selectedAudioClip) && selectedClipPitchCents >= -1_100,
	};
	if (!Object.hasOwn(predicates, enableWhen)) throw new ReferenceError(`Unknown Audacity enableWhen predicate: ${enableWhen}.`);
	return Boolean(predicates[enableWhen]);
}
/**
 * Resolve an implemented manifest action against a concrete runtime action
 * tree. Disabled and excluded actions are deliberately never resolved, even
 * when an object happens to expose a property with the same name.
 *
 * Runtime actions are closures and must not depend on a dynamic `this` value;
 * returning the function unchanged keeps this check honest (and makes it
 * possible for tests to prove that the callable belongs to the real runtime).
 */
export function resolveAudacityActionHandler(id, actionRuntime) {
	const match = matchAudacityAction(id);
	const definition = match?.definition;
	if (!definition || definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) return null;
	if (!actionRuntime || typeof actionRuntime !== 'object') return null;
	let candidate = actionRuntime;
	for (const segment of definition.handler.split('.')) {
		if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) return null;
		if (!Object.hasOwn(candidate, segment)) return null;
		candidate = candidate[segment];
	}
	if (typeof candidate !== 'function') return null;
	if (definition.handler === 'track.audacityMixer') return () => candidate(definition.id);
	if (!match.dynamic || match.template) return candidate;
	if (!match.valid) return null;
	return () => candidate(...match.parameters);
}

/** Return a deterministic release-gate report for a concrete action runtime. */
export function auditAudacityActionRuntime(actionRuntime) {
	const implemented = [];
	const resolved = [];
	const missing = [];
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED) continue;
		implemented.push(definition.id);
		if (resolveAudacityActionHandler(definition.id, actionRuntime)) resolved.push(definition.id);
		else missing.push(Object.freeze({ id: definition.id, handler: definition.handler }));
	}
	return Object.freeze({
		implemented: Object.freeze(implemented),
		resolved: Object.freeze(resolved),
		missing: Object.freeze(missing),
		complete: missing.length === 0,
	});
}

/**
 * Applies parity policy to an already-materialized UI menu without mutating it.
 * Unknown local containers and effect groups are deliberately retained so
 * migration to fully manifest-generated menus can happen incrementally.
 */
export function applyAudacityParityToMenus(menus, {
	locale = 'en',
	copy = null,
	materializeDisabled = false,
	actionRuntime = null,
	actionContext,
	shortcuts = null,
} = {}) {
	if (!Array.isArray(menus)) throw new TypeError('menus must be an array.');
	const completeMenus = materializeDisabled
		? materializeAudacityDisabledMenuActions(menus, { locale, copy })
		: menus;
	const normalizedLocale = normalizeBcp47Locale(locale);
	const localization = copy || normalizedLocale;
	const resolvedContext = actionContext === undefined
		? resolveRuntimeActionContext(actionRuntime)
		: resolveActionContext(actionContext);
	return cleanMenuItems(completeMenus.map((item) => decorateMenuItem(
		item,
		localization,
		actionRuntime,
		resolvedContext,
		normalizedLocale === 'en',
		shortcuts,
	)).filter(Boolean));
}

function decorateMenuItem(item, localization, actionRuntime, actionContext, canonicalEnglish, shortcuts) {
	if (!item || typeof item !== 'object') throw new TypeError('Each menu item must be an object.');
	if (item.divider) return { ...item };
	if (item.id && AUDACITY_ACTION_MANIFEST[item.id]?.menuVisible === false) return null;
	const definition = item.id ? audacityActionDefinition(item.id) : null;
	if (definition?.status === AUDACITY_ACTION_STATUS.EXCLUDED || definition?.menuVisible === false) return null;

	const children = item.items
		? cleanMenuItems(item.items.map((child) => decorateMenuItem(
			child,
			localization,
			actionRuntime,
			actionContext,
			canonicalEnglish,
			shortcuts,
		)).filter(Boolean))
		: undefined;
	const result = { ...item };
	if (children) result.items = children;

	if (definition) {
		result.parityActionId = definition.id;
		result.parityStatus = definition.status;
		const bindings = shortcuts === null
			? AUDACITY_SHORTCUT_BINDINGS_BY_ACTION[definition.id]
			: shortcuts?.[definition.id];
		if (bindings?.length) result.shortcut = bindings.join(', ');
		else if (shortcuts !== null || definition.origin === 'upstream') delete result.shortcut;
		// The reviewed parity manifest owns upstream command labels. Keeping a
		// second label at every menu call site caused Audacity wording to drift.
		// Value-bearing query actions (for example a concrete sample rate) and
		// explicitly stateful controls retain their contextual label.
		if (definition.origin === 'upstream' && !item.preserveLabel && !item.id.includes('?')) {
			const canonicalLabel = localizedAudacityParityLabel(definition.label, localization);
			if (canonicalEnglish || canonicalLabel !== definition.label) result.label = canonicalLabel;
		}
	}
	delete result.preserveLabel;
	if (definition?.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM) {
		result.disabled = true;
		result.onClick = undefined;
		result.disabledReason = localizedAudacityReason(definition.reason, localization);
	} else if (!children?.length && definition?.status === AUDACITY_ACTION_STATUS.IMPLEMENTED) {
		const hadHandler = typeof result.onClick === 'function';
		const stateDisabled = result.disabled || (
			actionContext !== undefined && !evaluateAudacityEnableWhen(definition.enableWhen, actionContext)
		);
		if (stateDisabled) {
			result.disabled = true;
			result.onClick = undefined;
			const reason = actionContext === undefined && !hadHandler ? DISABLED_REASONS.pending : DISABLED_REASONS.state;
			result.disabledReason ||= localizedAudacityReason(reason, localization);
		} else if (typeof result.onClick !== 'function') {
			const handler = resolveAudacityActionHandler(item.id, actionRuntime);
			if (handler) result.onClick = handler;
			else {
				result.disabled = true;
				result.onClick = undefined;
				result.disabledReason = localizedAudacityReason(DISABLED_REASONS.pending, localization);
			}
		}
	} else if (result.disabled) {
		const hadHandler = typeof result.onClick === 'function';
		result.onClick = undefined;
		result.disabledReason ||= localizedAudacityReason(hadHandler ? DISABLED_REASONS.state : DISABLED_REASONS.local, localization);
	}
	return result;
}

function matchAudacityAction(id) {
	if (typeof id !== 'string' || !id) return null;
	const resolvedId = resolveAudacityActionId(id);
	const exact = Object.hasOwn(AUDACITY_ACTION_MANIFEST, resolvedId) ? AUDACITY_ACTION_MANIFEST[resolvedId] : undefined;
	if (exact) return { definition: exact, dynamic: exact.id.includes('%1'), template: true, valid: true, parameters: [] };

	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		const markerIndex = definition.id.indexOf('%1');
		if (markerIndex < 0) continue;
		const prefix = definition.id.slice(0, markerIndex);
		const suffix = definition.id.slice(markerIndex + 2);
		if (!resolvedId.startsWith(prefix) || !resolvedId.endsWith(suffix)) continue;
		const encodedValue = resolvedId.slice(prefix.length, suffix ? -suffix.length : undefined);
		if (!encodedValue) return { definition, dynamic: true, template: false, valid: false, parameters: [] };
		let value;
		try {
			value = decodeURIComponent(encodedValue.replace(/\+/g, ' '));
		} catch {
			return { definition, dynamic: true, template: false, valid: false, parameters: [] };
		}
		const parameterName = definition.id.slice(0, markerIndex).match(/[?&]([^?&=]+)=$/)?.[1] || '';
		if (parameterName === 'rate') {
			const rate = Number(value);
			if (!Number.isSafeInteger(rate) || rate <= 0) {
				return { definition, dynamic: true, template: false, valid: false, parameters: [] };
			}
			value = rate;
		} else if (parameterName === 'colorindex') {
			const colorIndex = Number(value);
			if (!Number.isSafeInteger(colorIndex) || colorIndex < 0) {
				return { definition, dynamic: true, template: false, valid: false, parameters: [] };
			}
			value = colorIndex;
		}
		return { definition, dynamic: true, template: false, valid: true, parameters: [value] };
	}
	return null;
}

function resolveRuntimeActionContext(actionRuntime) {
	if (!actionRuntime || typeof actionRuntime.getActionContext !== 'function') return undefined;
	return resolveActionContext(actionRuntime.getActionContext());
}

function resolveActionContext(context) {
	if (context && typeof context.getActionContext === 'function') return resolveActionContext(context.getActionContext());
	if (!context || typeof context !== 'object') return {};
	if (
		Object.hasOwn(context, 'snapshot')
		|| Object.hasOwn(context, 'telemetry')
		|| Object.hasOwn(context, 'ui')
		|| Object.hasOwn(context, 'predicates')
		|| Object.hasOwn(context, 'effectOpened')
		|| Object.hasOwn(context, 'effectPresetId')
		|| Object.hasOwn(context, 'realtimeEffectId')
	) return context;
	return { snapshot: context };
}

function uniqueExistingIds(values, records) {
	const available = new Set(records.map((record) => record.id));
	return [...new Set(values.filter((value) => typeof value === 'string' && available.has(value)))];
}

function clipHasTimePitchTransform(clip) {
	return Boolean(
		clip
		&& (
			Math.abs(Number(clip.pitchCents) || 0) > 1e-9
			|| Math.abs((Number(clip.speedRatio) || 1) - 1) > 1e-9
			|| clip.stretchToTempo
		),
	);
}

const APPLICATION_MENU_IDS = Object.freeze({
	File: 'file',
	Edit: 'edit',
	Select: 'select',
	View: 'view',
	Record: 'record',
	Tracks: 'tracks',
	Generate: 'generate',
	Effect: 'effect',
	Analyze: 'analyze',
	Tools: 'tools',
	Help: 'help',
});

/** Materialize every pinned application-menu command that is intentionally disabled. */
export function materializeAudacityDisabledMenuActions(menus, { locale = 'en', copy = null } = {}) {
	const result = menus.map(cloneMenuTree);
	const localization = copy || normalizeBcp47Locale(locale);
	const definitions = Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((definition) => (
			definition.status === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM
			&& definition.menuVisible !== false
		));
	for (const definition of definitions) {
		const location = definition.locations.find((candidate) => APPLICATION_MENU_IDS[String(candidate).split(' > ')[0]]);
		if (!location) continue;
		const path = String(location).split(' > ');
		const root = result.find((menu) => menu.id === APPLICATION_MENU_IDS[path[0]]);
		if (!root) continue;
		root.items ||= [];
		let children = root.items;
		for (const segment of path.slice(1)) {
			let container = children.find((item) => menuItemMatchesManifestLabel(item, segment));
			if (!container) {
				const containerDefinition = definitions.find((candidate) => (
					candidate.label === segment
					&& candidate.locations.some((candidateLocation) => candidateLocation === path.slice(0, path.indexOf(segment)).join(' > '))
				));
				container = {
					id: containerDefinition?.id || `parity-${slug(path.slice(0, path.indexOf(segment) + 1).join('-'))}`,
					label: localizedParityLabel(segment, localization),
					items: [],
				};
				children.push(container);
			}
			container.items ||= [];
			children = container.items;
		}
		if (findMenuAction(result, definition.id)) continue;
		const isContainer = definitions.some((candidate) => candidate.locations.some((candidateLocation) => (
			String(candidateLocation).startsWith(`${path.join(' > ')} > ${definition.label}`)
		)));
		children.push({
			id: definition.id,
			label: localizedParityLabel(definition.label, localization),
			disabled: true,
			...(definition.shortcut ? { shortcut: definition.shortcut } : {}),
			...(isContainer ? { items: [] } : {}),
		});
	}
	return result;
}

/**
 * Apply product capability filters without loading the Preferences-only collector.
 *
 * @param {string} id
 * @param {readonly string[]} [disabledCommandIds]
 */
export function isAudacityShortcutCommandDisabled(id, disabledCommandIds = []) {
	return audacityShortcutCommandDisabled(audacityActionDefinition, id, disabledCommandIds);
}

function menuItemMatchesManifestLabel(item, label) {
	return item?.label === label || item?.parityLabel === label || audacityActionDefinition(item?.id)?.label === label;
}

function findMenuAction(items, actionId) {
	for (const item of items || []) {
		if (resolveAudacityActionId(item?.id) === actionId) return item;
		const child = findMenuAction(item?.items, actionId);
		if (child) return child;
	}
	return null;
}

function cloneMenuTree(item) {
	return item && typeof item === 'object'
		? { ...item, ...(item.items ? { items: item.items.map(cloneMenuTree) } : {}) }
		: item;
}

function localizedParityLabel(label, copyOrLocale) {
	return localizedAudacityParityLabel(label, copyOrLocale);
}

function slug(value) {
	return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanMenuItems(items) {
	const result = [];
	for (const item of items) {
		if (item.divider && (!result.length || result.at(-1).divider)) continue;
		result.push(item);
	}
	while (result.at(-1)?.divider) result.pop();
	return result;
}

function toManifest(entries) {
	const manifest = {};
	for (const entry of entries) {
		if (manifest[entry.id]) throw new Error(`Duplicate Audacity action ID: ${entry.id}.`);
		manifest[entry.id] = {
			...entry,
			shortcut: audioEditorPrimaryShortcut(entry.id)
				|| (entry.origin === 'local' ? entry.shortcut : null),
		};
	}
	return manifest;
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
