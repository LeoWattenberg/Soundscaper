import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	resolveAudacityActionId,
} from './audacity-action-parity.js';

export const AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION = 1;

export const AUDIO_EDITOR_BUILT_IN_WORKSPACES = Object.freeze(['classic', 'music', 'modern']);
export const AUDIO_EDITOR_THEMES = Object.freeze([
	'system',
	'light',
	'dark',
	'high-contrast-light',
	'high-contrast-dark',
]);
export const AUDIO_EDITOR_CLIP_STYLES = Object.freeze(['classic', 'colorful']);
export const AUDIO_EDITOR_PLAY_AT_SPEED_MODES = Object.freeze(['naive', 'staffpad']);

export const AUDIO_EDITOR_DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(
	Object.values(AUDACITY_ACTION_MANIFEST)
		.filter((action) => action.status === AUDACITY_ACTION_STATUS.IMPLEMENTED && action.shortcut)
		.map((action) => [action.id, Object.freeze([action.shortcut])]),
));

	const LEGACY_SHORTCUT_ACTION_IDS = Object.freeze({
		play: 'action://playback/play',
	});

const BUILT_IN_WORKSPACE_SET = new Set(AUDIO_EDITOR_BUILT_IN_WORKSPACES);
const THEME_SET = new Set(AUDIO_EDITOR_THEMES);
const CLIP_STYLE_SET = new Set(AUDIO_EDITOR_CLIP_STYLES);
const PLAY_AT_SPEED_MODE_SET = new Set(AUDIO_EDITOR_PLAY_AT_SPEED_MODES);
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

const DEFAULT_TOOLBARS = Object.freeze({
	transport: Object.freeze({ visible: true, order: 0 }),
	tools: Object.freeze({ visible: true, order: 1 }),
	edit: Object.freeze({ visible: true, order: 2 }),
	meter: Object.freeze({ visible: true, order: 3 }),
});

const DEFAULT_TOOLBAR_BUTTONS = Object.freeze({
	play: true,
	'play-at-speed': true,
	stop: true,
	record: true,
	'jump-start': true,
	'jump-end': true,
	loop: true,
	'split-tool': true,
	'waveform-view': true,
	'spectrogram-view': true,
	'spectral-box-select': true,
	'spectral-brush': true,
	'zoom-in': true,
	'zoom-out': true,
	'zoom-fit': true,
	undo: true,
	redo: true,
	cut: true,
	copy: true,
	paste: true,
	split: true,
	delete: true,
	rippleDelete: true,
	'time-display': true,
	monitor: true,
	'playback-volume': true,
});

const DEFAULT_PANELS = Object.freeze({
	history: Object.freeze({ visible: false, dock: 'right', order: 0, size: 320 }),
	labels: Object.freeze({ visible: false, dock: 'right', order: 1, size: 320 }),
	metadata: Object.freeze({ visible: false, dock: 'right', order: 2, size: 320 }),
	effects: Object.freeze({ visible: false, dock: 'right', order: 3, size: 360 }),
	mixer: Object.freeze({ visible: false, dock: 'bottom', order: 4, size: 460 }),
	spectrogram: Object.freeze({ visible: false, dock: 'bottom', order: 5, size: 240 }),
	analysis: Object.freeze({ visible: false, dock: 'right', order: 6, size: 380 }),
	spectrum: Object.freeze({ visible: false, dock: 'right', order: 7, size: 380 }),
	clipping: Object.freeze({ visible: false, dock: 'right', order: 8, size: 380 }),
	contrast: Object.freeze({ visible: false, dock: 'right', order: 9, size: 380 }),
	'ebu-r128': Object.freeze({ visible: false, dock: 'right', order: 10, size: 380 }),
});

const DEFAULT_FLOATING_PANEL_GEOMETRY = Object.freeze({
	history: Object.freeze({ x: 24, y: 24, width: 360, height: 320 }),
	labels: Object.freeze({ x: 48, y: 48, width: 360, height: 360 }),
	metadata: Object.freeze({ x: 72, y: 72, width: 380, height: 360 }),
	effects: Object.freeze({ x: 96, y: 40, width: 400, height: 440 }),
	mixer: Object.freeze({ x: 40, y: 96, width: 560, height: 360 }),
	spectrogram: Object.freeze({ x: 120, y: 64, width: 400, height: 360 }),
	analysis: Object.freeze({ x: 144, y: 88, width: 520, height: 600 }),
	spectrum: Object.freeze({ x: 168, y: 112, width: 520, height: 600 }),
	clipping: Object.freeze({ x: 192, y: 136, width: 520, height: 600 }),
	contrast: Object.freeze({ x: 216, y: 160, width: 520, height: 600 }),
	'ebu-r128': Object.freeze({ x: 240, y: 184, width: 440, height: 460 }),
});

export const AUDIO_EDITOR_WORKSPACE_PRESETS = Object.freeze({
	classic: Object.freeze({
		toolbars: Object.freeze({
			transport: Object.freeze({ visible: true, order: 0 }),
			tools: Object.freeze({ visible: true, order: 1 }),
			edit: Object.freeze({ visible: true, order: 2 }),
			meter: Object.freeze({ visible: true, order: 3 }),
		}),
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			history: Object.freeze({ visible: true, dock: 'left', order: 0, size: 300 }),
			labels: Object.freeze({ visible: false, dock: 'right', order: 1, size: 320 }),
			metadata: Object.freeze({ visible: false, dock: 'right', order: 2, size: 320 }),
			effects: Object.freeze({ visible: false, dock: 'right', order: 3, size: 360 }),
			mixer: Object.freeze({ visible: false, dock: 'bottom', order: 4, size: 460 }),
			spectrogram: Object.freeze({ visible: false, dock: 'bottom', order: 5, size: 240 }),
		}),
	}),
	music: Object.freeze({
		toolbars: Object.freeze({
			transport: Object.freeze({ visible: true, order: 0 }),
			tools: Object.freeze({ visible: true, order: 1 }),
			edit: Object.freeze({ visible: true, order: 2 }),
			meter: Object.freeze({ visible: true, order: 3 }),
		}),
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: Object.freeze({
			...DEFAULT_PANELS,
			effects: Object.freeze({ visible: true, dock: 'right', order: 0, size: 360 }),
			mixer: Object.freeze({ visible: true, dock: 'bottom', order: 0, size: 460 }),
		}),
	}),
	modern: Object.freeze({
		toolbars: DEFAULT_TOOLBARS,
		toolbarButtons: DEFAULT_TOOLBAR_BUTTONS,
		panels: DEFAULT_PANELS,
	}),
});

/**
 * @typedef {Object} AudioEditorPreferencesV1
 * @property {1} schemaVersion
 * @property {{rippleMode: 'off'|'per-track'|'all-tracks', collisionBehavior: 'audacity', snapToZeroCrossings: boolean}} editing
 * @property {Record<string, string[]>} shortcuts
 * @property {{theme: string, clipStyle: 'classic'|'colorful'}} appearance
 * @property {{activeId: string, custom: Object[], toolbars: Record<string, Object>, toolbarButtons: Record<string, boolean>, panels: Record<string, Object>}} workspace
 * @property {Object} spectrogram
 * @property {{detectTempo: boolean}} import
 * @property {{retainInputs: boolean}} recording
 * @property {{playAtSpeedMode: 'naive'|'staffpad'}} playback
 */

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value, name) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function integer(value, minimum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) {
		throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`);
	}
	return number;
}

function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function oneOf(value, allowed, name) {
	if (!allowed.has(value)) throw new RangeError(`${name} has an unsupported value: ${value}.`);
	return value;
}

function normalizeShortcuts(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('shortcuts must be an object.');
	const shortcuts = {};
	for (const [actionId, bindings] of Object.entries(value)) {
		nonEmptyString(actionId, 'shortcut action ID');
		const canonicalActionId = LEGACY_SHORTCUT_ACTION_IDS[actionId] || resolveAudacityActionId(actionId);
		const list = Array.isArray(bindings) ? bindings : [bindings];
		shortcuts[canonicalActionId] = list.map((binding, index) => nonEmptyString(binding, `shortcuts.${actionId}[${index}]`));
		if (new Set(shortcuts[canonicalActionId]).size !== shortcuts[canonicalActionId].length) {
			throw new RangeError(`shortcuts.${actionId} cannot contain duplicate bindings.`);
		}
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
	const ids = new Set([...Object.keys(DEFAULT_PANELS), ...Object.keys(value)]);
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
		};
	}
	return entries;
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
	return {
		schemaVersion: AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION,
		editing: {
			rippleMode: oneOf(options.editing?.rippleMode ?? 'off', RIPPLE_MODE_SET, 'editing.rippleMode'),
			collisionBehavior: 'audacity',
			snapToZeroCrossings: Boolean(options.editing?.snapToZeroCrossings),
		},
		shortcuts: normalizeShortcuts(options.shortcuts === undefined ? AUDIO_EDITOR_DEFAULT_SHORTCUTS : options.shortcuts),
		appearance: {
			theme: oneOf(options.appearance?.theme ?? 'system', THEME_SET, 'appearance.theme'),
			clipStyle: oneOf(options.appearance?.clipStyle ?? 'colorful', CLIP_STYLE_SET, 'appearance.clipStyle'),
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

export function normalizeAudioEditorShortcut(binding) {
	const value = nonEmptyString(binding, 'shortcut binding').trim();
	const aliases = new Map([
		['control', 'Ctrl'], ['ctrl', 'Ctrl'], ['cmd', 'Meta'], ['command', 'Meta'], ['meta', 'Meta'],
		['option', 'Alt'], ['alt', 'Alt'], ['shift', 'Shift'], ['spacebar', 'Space'], [' ', 'Space'],
	]);
	const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
	const key = parts.pop() || value;
	const modifiers = new Set(parts.map((part) => aliases.get(part.toLowerCase()) || part));
	const ordered = ['Ctrl', 'Meta', 'Alt', 'Shift'].filter((modifier) => modifiers.has(modifier));
	const normalizedKey = aliases.get(key.toLowerCase()) || (key.length === 1 ? key.toUpperCase() : key);
	return [...ordered, normalizedKey].join('+');
}

export function findAudioEditorShortcutConflicts(shortcuts) {
	const normalized = normalizeShortcuts(shortcuts);
	const byBinding = new Map();
	for (const [actionId, bindings] of Object.entries(normalized)) {
		for (const binding of bindings) {
			const key = normalizeAudioEditorShortcut(binding).toLowerCase();
			if (!byBinding.has(key)) byBinding.set(key, { binding: normalizeAudioEditorShortcut(binding), actionIds: [] });
			byBinding.get(key).actionIds.push(actionId);
		}
	}
	return [...byBinding.values()].filter((entry) => entry.actionIds.length > 1);
}

export function validateAudioEditorPreferencesV1(preferences) {
	if (!preferences || typeof preferences !== 'object') throw new TypeError('Audio editor preferences are required.');
	if (preferences.schemaVersion !== AUDIO_EDITOR_PREFERENCES_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor preferences schema version: ${preferences.schemaVersion}.`);
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
	const normalized = createAudioEditorPreferencesV1(value);
	return {
		preferences: {
			...clone(value),
			workspace: { ...clone(value.workspace), panels: normalized.workspace.panels },
			recording: normalized.recording,
			playback: normalized.playback,
		},
		readOnly: false,
		reason: null,
	};
}
