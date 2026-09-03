import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	resolveAudacityActionId,
} from './audacity-action-parity.js';
import { AUDACITY_ACTION_DEFINITIONS } from './audacity-action-inventory.js';
import {
	AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION,
	AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
} from './audacity-shortcut-bindings.ts';
import {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	AUDIO_EDITOR_WORKSPACE_PRESETS,
	DEFAULT_FLOATING_PANEL_GEOMETRY,
	DEFAULT_PANELS,
	DEFAULT_TOOLBAR_BUTTONS,
	DEFAULT_TOOLBARS,
} from './workspace-layout-defaults.ts';
import {
	DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	normalizeSoundActivationPreferences,
} from './sound-activation-preferences.ts';
import {
	AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
	migrateAudioEditorShortcutDefaults,
} from './shortcut-default-migration.ts';
import {
	audioEditorShortcutConflictKey,
	collectAudioEditorShortcutConflicts,
	normalizeAudioEditorShortcut,
} from './audio-editor-shortcut-normalization.ts';
import { canonicalizeWorkspacePanelGroups, normalizeWorkspacePanelGroupFields } from './workspace-panel-layout.ts';
import { clone, finiteInRange, integer, nonEmptyString, oneOf } from './preferences-validators.js';

export {
	AUDIO_EDITOR_BUILT_IN_WORKSPACES,
	AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
	AUDIO_EDITOR_WORKSPACE_PRESETS,
	audioEditorShortcutConflictKey,
	normalizeAudioEditorShortcut,
};

export const AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION = 1;

export const AUDIO_EDITOR_THEMES = Object.freeze([
	'system',
	'light',
	'dark',
	'high-contrast-light',
	'high-contrast-dark',
]);
export const AUDIO_EDITOR_CLIP_STYLES = Object.freeze(['classic', 'colorful']);
export const AUDIO_EDITOR_PLAY_AT_SPEED_MODES = Object.freeze(['naive', 'staffpad']);
export const AUDIO_EDITOR_LAYOUTS = Object.freeze(['auto', 'compact', 'desktop']);

const AUDIO_EDITOR_LOCAL_DEFAULT_SHORTCUTS_BY_ACTION = Object.freeze({
	...Object.fromEntries(Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((action) => (
			action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED
			&& action.origin === 'local'
			&& action.shortcut
			&& !Object.hasOwn(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION, action.id)
		))
		.map((action) => [action.id, Object.freeze([action.shortcut])])),
	...AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION,
});

export const AUDIO_EDITOR_DEFAULT_SHORTCUTS = Object.freeze({
	...AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	...AUDIO_EDITOR_LOCAL_DEFAULT_SHORTCUTS_BY_ACTION,
});

// `shortcut` metadata is the immutable pre-Audacity-profile default snapshot;
// live defaults come from the imported binding table above.
const AUDIO_EDITOR_SHORTCUT_DEFAULTS_V0 = Object.freeze({
	...Object.fromEntries(AUDACITY_ACTION_DEFINITIONS
		.filter((action) => action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED && action.shortcut)
		.map((action) => [resolveAudacityActionId(action.id), Object.freeze([action.shortcut])])),
	'delete-all-tracks-ripple': Object.freeze(['Ctrl+Delete', 'Ctrl+Backspace']),
});

export const AUDIO_EDITOR_SEARCH_ACTION_ID = 'application-search';
export const AUDIO_EDITOR_SEARCH_SHORTCUTS = Object.freeze(['Ctrl+K']);
export const AUDIO_EDITOR_RESERVED_SHORTCUTS = Object.freeze({
	[AUDIO_EDITOR_SEARCH_ACTION_ID]: AUDIO_EDITOR_SEARCH_SHORTCUTS,
});

const LEGACY_SHORTCUT_ACTION_IDS = Object.freeze({
	play: 'action://playback/play',
	'quick-help': 'online-handbook',
});

const BUILT_IN_WORKSPACE_SET = new Set(AUDIO_EDITOR_BUILT_IN_WORKSPACES);
const THEME_SET = new Set(AUDIO_EDITOR_THEMES);
const CLIP_STYLE_SET = new Set(AUDIO_EDITOR_CLIP_STYLES);
const PLAY_AT_SPEED_MODE_SET = new Set(AUDIO_EDITOR_PLAY_AT_SPEED_MODES);
const LAYOUT_SET = new Set(AUDIO_EDITOR_LAYOUTS);
const RIPPLE_MODE_SET = new Set(['off', 'per-track', 'all-tracks']);
const DOCK_SET = new Set(['left', 'right', 'bottom', 'floating']);
const FORBIDDEN_TOP_LEVEL_KEYS = new Set([
	'account',
	'audio',
	'audioDevice',
	'audioDevices',
	'cloud',
	'device',
	'inputDevice',
	'outputDevice',
	'plugins',
	'telemetry',
	'updates',
]);

/**
 * @typedef {Object} AudioEditorPanelStateV1
 * @property {boolean} visible
 * @property {'left'|'right'|'bottom'|'floating'} [dock]
 * @property {number} [order]
 * @property {number} [size]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [tabGroup]
 * @property {boolean} [tabActive]
 */

/**
 * @typedef {Object} AudioEditorPreferencesV1
 * @property {1} schemaVersion
 * @property {number} shortcutDefaultsVersion
 * @property {{rippleMode: 'off'|'per-track'|'all-tracks', collisionBehavior: 'audacity', snapToZeroCrossings: boolean}} editing
 * @property {Record<string, string[]>} shortcuts
 * @property {{theme: string, clipStyle: 'classic'|'colorful', layout: 'auto'|'compact'|'desktop'}} appearance
 * @property {{showMasterTrack: boolean, showMarkers: boolean}} view
 * @property {{activeId: string, custom: Object[], toolbars: Record<string, Object>, toolbarButtons: Record<string, boolean>, panels: Record<string, AudioEditorPanelStateV1>}} workspace
 * @property {Object} spectrogram
 * @property {{detectTempo: boolean}} import
 * @property {{retainInputs: boolean, soundActivation: import('./sound-activation-preferences.ts').SoundActivationPreferences}} recording
 * @property {{playAtSpeedMode: 'naive'|'staffpad'}} playback
 */

function normalizeShortcuts(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('shortcuts must be an object.');
	const shortcuts = {};
	for (const [actionId, bindings] of Object.entries(value)) {
		nonEmptyString(actionId, 'shortcut action ID');
		const canonicalActionId = Object.hasOwn(LEGACY_SHORTCUT_ACTION_IDS, actionId)
			? LEGACY_SHORTCUT_ACTION_IDS[actionId]
			: resolveAudacityActionId(actionId);
		const list = Array.isArray(bindings) ? bindings : [bindings];
		const normalizedBindings = list.map((binding, index) => nonEmptyString(binding, `shortcuts.${actionId}[${index}]`));
		if (new Set(normalizedBindings).size !== normalizedBindings.length) {
			throw new RangeError(`shortcuts.${actionId} cannot contain duplicate bindings.`);
		}
		Object.defineProperty(shortcuts, canonicalActionId, {
			value: normalizedBindings,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return shortcuts;
}

function mergePreferences(preferences, patch = {}) {
	return {
		...preferences,
		...patch,
		editing: { ...preferences.editing, ...patch.editing },
		shortcuts: patch.shortcuts === undefined ? preferences.shortcuts : patch.shortcuts,
		appearance: { ...preferences.appearance, ...patch.appearance },
		view: { ...preferences.view, ...patch.view },
		workspace: {
			...preferences.workspace,
			...patch.workspace,
			toolbars: { ...preferences.workspace?.toolbars, ...patch.workspace?.toolbars },
			toolbarButtons: { ...preferences.workspace?.toolbarButtons, ...patch.workspace?.toolbarButtons },
			panels: { ...preferences.workspace?.panels, ...patch.workspace?.panels },
		},
		spectrogram: { ...preferences.spectrogram, ...patch.spectrogram },
		import: { ...preferences.import, ...patch.import },
		recording: { ...preferences.recording, ...patch.recording },
		playback: { ...preferences.playback, ...patch.playback },
	};
}

function normalizeRecordingSoundActivation(recording) {
	if (!recording || (typeof recording !== 'object' && typeof recording !== 'function')
		|| !Object.hasOwn(recording, 'soundActivation')) {
		return DEFAULT_SOUND_ACTIVATION_PREFERENCES;
	}
	const descriptor = Object.getOwnPropertyDescriptor(recording, 'soundActivation');
	if (!descriptor?.enumerable || !('value' in descriptor)) {
		throw new TypeError('recording.soundActivation must be an enumerable data field.');
	}
	return normalizeSoundActivationPreferences(descriptor.value);
}

function workspaceLayout(activeId, custom) {
	if (BUILT_IN_WORKSPACE_SET.has(activeId)) return AUDIO_EDITOR_WORKSPACE_PRESETS[activeId];
	return custom.find((workspace) => workspace.id === activeId)?.layout || {};
}

function normalizeToolbarEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.toolbars must be an object.');
	const entries = {};
	for (const [id, defaults] of Object.entries(DEFAULT_TOOLBARS)) {
		const entry = value[id] || {};
		entries[id] = {
			visible: entry.visible ?? defaults.visible,
			order: integer(entry.order ?? defaults.order, 0, `workspace.toolbars.${id}.order`),
		};
		if (typeof entries[id].visible !== 'boolean') throw new TypeError(`workspace.toolbars.${id}.visible must be boolean.`);
	}
	for (const [id, entry] of Object.entries(value)) {
		if (entries[id]) continue;
		nonEmptyString(id, 'toolbar ID');
		if (!entry || typeof entry !== 'object') throw new TypeError(`workspace.toolbars.${id} must be an object.`);
		entries[id] = {
			visible: entry.visible !== false,
			order: integer(entry.order ?? Object.keys(entries).length, 0, `workspace.toolbars.${id}.order`),
		};
	}
	return entries;
}

function normalizeToolbarButtonEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.toolbarButtons must be an object.');
	const entries = { ...DEFAULT_TOOLBAR_BUTTONS };
	for (const [id, visible] of Object.entries(value)) {
		if (id === 'timecode-format') continue;
		nonEmptyString(id, 'toolbar button ID');
		if (typeof visible !== 'boolean') throw new TypeError(`workspace.toolbarButtons.${id} must be boolean.`);
		entries[id] = visible;
	}
	return entries;
}

function normalizePanelEntries(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('workspace.panels must be an object.');
	const entries = {};
	const ids = new Set([...Object.keys(DEFAULT_PANELS), ...Object.keys(value)].filter((id) => id !== 'spectrogram'));
	for (const id of ids) {
		nonEmptyString(id, 'panel ID');
		const defaults = DEFAULT_PANELS[id] || { visible: false, dock: 'right', order: Object.keys(entries).length, size: 320 };
		const floatingDefaults = DEFAULT_FLOATING_PANEL_GEOMETRY[id] || {
			x: 24 + Object.keys(entries).length * 24,
			y: 24 + Object.keys(entries).length * 24,
			width: Math.max(240, defaults.size),
			height: 320,
		};
		const entry = value[id] || {};
		if (!entry || typeof entry !== 'object') throw new TypeError(`workspace.panels.${id} must be an object.`);
		const visible = entry.visible ?? defaults.visible;
		if (typeof visible !== 'boolean') throw new TypeError(`workspace.panels.${id}.visible must be boolean.`);
		entries[id] = {
			visible,
			dock: oneOf(entry.dock ?? defaults.dock, DOCK_SET, `workspace.panels.${id}.dock`),
			order: integer(entry.order ?? defaults.order, 0, `workspace.panels.${id}.order`),
			size: finiteInRange(entry.size ?? defaults.size, 80, 4_096, `workspace.panels.${id}.size`),
			x: finiteInRange(entry.x ?? floatingDefaults.x, 0, 1_000_000, `workspace.panels.${id}.x`),
			y: finiteInRange(entry.y ?? floatingDefaults.y, 0, 1_000_000, `workspace.panels.${id}.y`),
			width: finiteInRange(entry.width ?? entry.size ?? floatingDefaults.width, 80, 4_096, `workspace.panels.${id}.width`),
			height: finiteInRange(entry.height ?? floatingDefaults.height, 80, 4_096, `workspace.panels.${id}.height`),
			...normalizeWorkspacePanelGroupFields(entry, `workspace.panels.${id}`),
		};
	}
	return canonicalizeWorkspacePanelGroups(entries);
}

function normalizeCustomWorkspaces(value = []) {
	if (!Array.isArray(value)) throw new TypeError('workspace.custom must be an array.');
	const workspaces = value.map((workspace, index) => {
		if (!workspace || typeof workspace !== 'object') throw new TypeError(`workspace.custom[${index}] must be an object.`);
		const id = nonEmptyString(workspace.id, `workspace.custom[${index}].id`);
		if (BUILT_IN_WORKSPACE_SET.has(id)) throw new RangeError(`Custom workspace ID ${id} is reserved.`);
		return {
			id,
			name: nonEmptyString(workspace.name, `workspace.custom[${index}].name`),
			layout: clone(workspace.layout ?? {}),
		};
	});
	if (new Set(workspaces.map((workspace) => workspace.id)).size !== workspaces.length) {
		throw new RangeError('Custom workspace IDs must be unique.');
	}
	return workspaces;
}

/**
 * Editor-only preferences. Audio device selection, plugins, cloud accounts,
 * telemetry and operating-system integration deliberately do not belong here.
 * @returns {AudioEditorPreferencesV1}
 */
export function createAudioEditorPreferencesV1(options = {}) {
	for (const key of FORBIDDEN_TOP_LEVEL_KEYS) {
		if (Object.hasOwn(options, key)) throw new RangeError(`${key} is not an editor preference.`);
	}
	const custom = normalizeCustomWorkspaces(options.workspace?.custom || []);
	const activeId = options.workspace?.activeId || 'modern';
	if (!BUILT_IN_WORKSPACE_SET.has(activeId) && !custom.some((workspace) => workspace.id === activeId)) {
		throw new ReferenceError(`Active workspace ${activeId} does not exist.`);
	}
	const layout = workspaceLayout(activeId, custom);
	const minimumFrequency = finiteInRange(options.spectrogram?.minimumFrequency ?? 0, 0, 384_000, 'spectrogram.minimumFrequency');
	const maximumFrequency = finiteInRange(options.spectrogram?.maximumFrequency ?? 20_000, 0, 384_000, 'spectrogram.maximumFrequency');
	if (maximumFrequency <= minimumFrequency) throw new RangeError('Spectrogram preferences must have a positive frequency range.');
	const windowSize = integer(options.spectrogram?.windowSize ?? 2048, 32, 'spectrogram.windowSize');
	if ((windowSize & (windowSize - 1)) !== 0) throw new RangeError('spectrogram.windowSize must be a power of two.');
	const showMasterTrack = options.view?.showMasterTrack ?? false;
	if (typeof showMasterTrack !== 'boolean') throw new TypeError('view.showMasterTrack must be boolean.');
	const showMarkers = options.view?.showMarkers ?? false;
	if (typeof showMarkers !== 'boolean') throw new TypeError('view.showMarkers must be boolean.');
	return {
		schemaVersion: AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION,
		shortcutDefaultsVersion: Math.max(
			AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
			integer(
				options.shortcutDefaultsVersion ?? AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
				0,
				'shortcutDefaultsVersion',
			),
		),
		editing: {
			rippleMode: oneOf(options.editing?.rippleMode ?? 'off', RIPPLE_MODE_SET, 'editing.rippleMode'),
			collisionBehavior: 'audacity',
			snapToZeroCrossings: Boolean(options.editing?.snapToZeroCrossings),
		},
		shortcuts: normalizeShortcuts(options.shortcuts === undefined ? AUDIO_EDITOR_DEFAULT_SHORTCUTS : options.shortcuts),
		appearance: {
			theme: oneOf(options.appearance?.theme ?? 'system', THEME_SET, 'appearance.theme'),
			clipStyle: oneOf(options.appearance?.clipStyle ?? 'colorful', CLIP_STYLE_SET, 'appearance.clipStyle'),
			// 'auto' follows the viewport width; the explicit values force the
			// compact (drawer) or desktop chrome regardless of window size.
			layout: oneOf(options.appearance?.layout ?? 'auto', LAYOUT_SET, 'appearance.layout'),
		},
		view: {
			showMasterTrack,
			showMarkers,
		},
		workspace: {
			activeId,
			custom,
			toolbars: normalizeToolbarEntries(options.workspace?.toolbars ?? layout.toolbars),
			toolbarButtons: normalizeToolbarButtonEntries(options.workspace?.toolbarButtons ?? layout.toolbarButtons),
			panels: normalizePanelEntries(options.workspace?.panels ?? layout.panels),
		},
		spectrogram: {
			scale: nonEmptyString(options.spectrogram?.scale ?? 'mel', 'spectrogram.scale'),
			minimumFrequency,
			maximumFrequency,
			windowSize,
			windowType: nonEmptyString(options.spectrogram?.windowType ?? 'hann', 'spectrogram.windowType'),
			gain: finiteInRange(options.spectrogram?.gain ?? 20, -120, 120, 'spectrogram.gain'),
			range: finiteInRange(options.spectrogram?.range ?? 80, 1, 240, 'spectrogram.range'),
		},
		import: {
			detectTempo: options.import?.detectTempo !== false,
		},
		recording: {
			retainInputs: options.recording?.retainInputs !== false,
			soundActivation: normalizeRecordingSoundActivation(options.recording),
		},
		playback: {
			playAtSpeedMode: oneOf(
				options.playback?.playAtSpeedMode ?? 'naive',
				PLAY_AT_SPEED_MODE_SET,
				'playback.playAtSpeedMode',
			),
		},
	};
}

export function updateAudioEditorPreferencesV1(preferences, patch = {}) {
	validateAudioEditorPreferencesV1(preferences);
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Preference changes must be an object.');
	return createAudioEditorPreferencesV1(mergePreferences(preferences, patch));
}

export function applyAudioEditorWorkspace(preferences, activeId) {
	validateAudioEditorPreferencesV1(preferences);
	nonEmptyString(activeId, 'workspace ID');
	const layout = workspaceLayout(activeId, preferences.workspace.custom);
	if (!BUILT_IN_WORKSPACE_SET.has(activeId) && !preferences.workspace.custom.some((workspace) => workspace.id === activeId)) {
		throw new ReferenceError(`Workspace ${activeId} does not exist.`);
	}
	return createAudioEditorPreferencesV1(mergePreferences(preferences, {
		workspace: {
			activeId,
			toolbars: clone(layout.toolbars || DEFAULT_TOOLBARS),
			toolbarButtons: clone(layout.toolbarButtons || DEFAULT_TOOLBAR_BUTTONS),
			panels: clone(layout.panels || DEFAULT_PANELS),
		},
	}));
}

export function createCustomAudioEditorWorkspace(preferences, workspace) {
	validateAudioEditorPreferencesV1(preferences);
	if (!workspace || typeof workspace !== 'object') throw new TypeError('Custom workspace settings are required.');
	const id = nonEmptyString(workspace.id, 'custom workspace ID');
	const name = nonEmptyString(workspace.name, 'custom workspace name');
	if (BUILT_IN_WORKSPACE_SET.has(id) || preferences.workspace.custom.some((candidate) => candidate.id === id)) {
		throw new RangeError(`Workspace ID ${id} already exists.`);
	}
	const layout = clone(workspace.layout || {
		toolbars: preferences.workspace.toolbars,
		toolbarButtons: preferences.workspace.toolbarButtons,
		panels: preferences.workspace.panels,
	});
	return createAudioEditorPreferencesV1(mergePreferences(preferences, {
		workspace: {
			activeId: id,
			custom: [...preferences.workspace.custom, { id, name, layout }],
			toolbars: layout.toolbars,
			toolbarButtons: layout.toolbarButtons,
			panels: layout.panels,
		},
	}));
}

export function updateCustomAudioEditorWorkspace(preferences, workspaceId, changes = {}) {
	validateAudioEditorPreferencesV1(preferences);
	const index = preferences.workspace.custom.findIndex((workspace) => workspace.id === workspaceId);
	if (index < 0) throw new ReferenceError(`Custom workspace ${workspaceId} does not exist.`);
	const custom = clone(preferences.workspace.custom);
	custom[index] = {
		...custom[index],
		...(changes.name === undefined ? {} : { name: nonEmptyString(changes.name, 'custom workspace name') }),
		layout: clone(changes.layout || {
			toolbars: preferences.workspace.toolbars,
			toolbarButtons: preferences.workspace.toolbarButtons,
			panels: preferences.workspace.panels,
		}),
	};
	return createAudioEditorPreferencesV1(mergePreferences(preferences, { workspace: { custom } }));
}

export function deleteCustomAudioEditorWorkspace(preferences, workspaceId) {
	validateAudioEditorPreferencesV1(preferences);
	if (!preferences.workspace.custom.some((workspace) => workspace.id === workspaceId)) {
		throw new ReferenceError(`Custom workspace ${workspaceId} does not exist.`);
	}
	const custom = preferences.workspace.custom.filter((workspace) => workspace.id !== workspaceId);
	const next = createAudioEditorPreferencesV1(mergePreferences(preferences, {
		workspace: { activeId: preferences.workspace.activeId === workspaceId ? 'modern' : preferences.workspace.activeId, custom },
	}));
	return preferences.workspace.activeId === workspaceId ? applyAudioEditorWorkspace(next, 'modern') : next;
}

function normalizedShortcutKey(binding) {
	return normalizeAudioEditorShortcut(binding).toLowerCase();
}

function migrateLoadedAudioEditorShortcuts(shortcuts, shortcutDefaultsVersion) {
	return migrateAudioEditorShortcutDefaults({
		shortcuts: normalizeShortcuts(shortcuts),
		currentDefaults: AUDIO_EDITOR_DEFAULT_SHORTCUTS,
		formerDefaults: AUDIO_EDITOR_SHORTCUT_DEFAULTS_V0,
		shortcutDefaultsVersion,
		normalizedKey: normalizedShortcutKey,
		conflictKey: audioEditorShortcutConflictKey,
		reservedBindings: AUDIO_EDITOR_SEARCH_SHORTCUTS,
	});
}

export function findAudioEditorShortcutConflicts(shortcuts) {
	return collectAudioEditorShortcutConflicts(
		normalizeShortcuts(shortcuts),
		AUDIO_EDITOR_RESERVED_SHORTCUTS,
	);
}

export function validateAudioEditorPreferencesV1(preferences) {
	if (!preferences || typeof preferences !== 'object') throw new TypeError('Audio editor preferences are required.');
	if (preferences.schemaVersion !== AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor preferences schema version: ${preferences.schemaVersion}.`);
	}
	if (preferences.shortcutDefaultsVersion !== undefined) {
		integer(preferences.shortcutDefaultsVersion, 0, 'shortcutDefaultsVersion');
	}
	for (const section of ['editing', 'shortcuts', 'appearance', 'workspace', 'spectrogram', 'import']) {
		if (!preferences[section] || typeof preferences[section] !== 'object' || Array.isArray(preferences[section])) {
			throw new TypeError(`preferences.${section} must be an object.`);
		}
	}
	for (const key of FORBIDDEN_TOP_LEVEL_KEYS) {
		if (Object.hasOwn(preferences, key)) throw new RangeError(`${key} is not an editor preference.`);
	}
	if (preferences.editing.collisionBehavior !== 'audacity') {
		throw new RangeError('editing.collisionBehavior must use Audacity behavior.');
	}
	if (typeof preferences.editing.snapToZeroCrossings !== 'boolean') {
		throw new TypeError('editing.snapToZeroCrossings must be boolean.');
	}
	if (typeof preferences.import.detectTempo !== 'boolean') throw new TypeError('import.detectTempo must be boolean.');
	if (preferences.view !== undefined) {
		if (!preferences.view || typeof preferences.view !== 'object' || Array.isArray(preferences.view)) {
			throw new TypeError('preferences.view must be an object.');
		}
		if (typeof preferences.view.showMasterTrack !== 'boolean') {
			throw new TypeError('view.showMasterTrack must be boolean.');
		}
		// Preferences saved before the marker toggle existed carry a view section
		// without it; normalization supplies the default, so only a stored value
		// of the wrong type is a fault.
		if (preferences.view.showMarkers !== undefined && typeof preferences.view.showMarkers !== 'boolean') {
			throw new TypeError('view.showMarkers must be boolean.');
		}
	}
	if (preferences.recording !== undefined) {
		if (!preferences.recording || typeof preferences.recording !== 'object' || Array.isArray(preferences.recording)) {
			throw new TypeError('preferences.recording must be an object.');
		}
		if (typeof preferences.recording.retainInputs !== 'boolean') {
			throw new TypeError('recording.retainInputs must be boolean.');
		}
	}
	if (preferences.playback !== undefined) {
		if (!preferences.playback || typeof preferences.playback !== 'object' || Array.isArray(preferences.playback)) {
			throw new TypeError('preferences.playback must be an object.');
		}
		oneOf(preferences.playback.playAtSpeedMode, PLAY_AT_SPEED_MODE_SET, 'playback.playAtSpeedMode');
	}
	createAudioEditorPreferencesV1(preferences);
	return true;
}

export function loadAudioEditorPreferencesV1(value) {
	if (!value || typeof value !== 'object') throw new TypeError('Saved audio editor preferences are required.');
	if (Number(value.schemaVersion) > AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION) {
		return { preferences: clone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorPreferencesV1(value);
	const shortcutDefaultsVersion = value.shortcutDefaultsVersion === undefined
		? 0
		: integer(value.shortcutDefaultsVersion, 0, 'shortcutDefaultsVersion');
	const normalized = createAudioEditorPreferencesV1(value);
	return {
		preferences: {
			...clone(value),
			shortcutDefaultsVersion: Math.max(
				shortcutDefaultsVersion,
				AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION,
			),
			shortcuts: migrateLoadedAudioEditorShortcuts(normalized.shortcuts, shortcutDefaultsVersion),
			// Documents saved before the layout preference existed carry an
			// appearance section without it; normalization supplies the default.
			appearance: normalized.appearance,
			view: normalized.view,
			workspace: {
				...clone(value.workspace),
				// Buttons added after a document was saved must resolve to their
				// defaults rather than to "visible" (the toolbar treats an absent
				// entry as shown); stored choices win over the defaults.
				toolbarButtons: normalized.workspace.toolbarButtons,
				panels: {
					...normalized.workspace.panels,
					'web-vcr': { ...normalized.workspace.panels['web-vcr'], visible: false },
				},
			},
			recording: normalized.recording,
			playback: normalized.playback,
		},
		readOnly: false,
		reason: null,
	};
}
