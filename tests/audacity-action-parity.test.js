import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDACITY_ACTION_ALIASES,
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_SOURCE,
	AUDACITY_ACTION_STATUS,
	applyAudacityParityToMenus,
	audacityActionDefinition,
	audacityActionReason,
	collectAudacityShortcutCommands,
	evaluateAudacityActionEnablement,
	evaluateAudacityEnableWhen,
	resolveAudacityActionId,
} from '../src/common/editor/audacity-action-parity.js';
import {
	AUDACITY_ACTION_ROADMAP_DISPOSITION,
	AUDACITY_MIDI_FENCE,
} from '../src/common/editor/audacity-action-roadmap.ts';
import {
	AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS,
	AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS,
	createUnavailableApplicationMenuItem,
} from '../src/common/editor/ui/application-menu-registry.ts';

const PINNED_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';

test('Audacity action parity is pinned to the reviewed Audacity 4 source revision', () => {
	assert.equal(AUDACITY_ACTION_SOURCE.commit, PINNED_COMMIT);
	assert.match(AUDACITY_ACTION_SOURCE.url, new RegExp(PINNED_COMMIT));
	assert.equal(AUDACITY_ACTION_SOURCE.version, '4.0.0-beta.2+');
	assert.ok(Object.isFrozen(AUDACITY_ACTION_SOURCE));
});

test('every parity record carries the complete immutable action contract', () => {
	const entries = Object.entries(AUDACITY_ACTION_MANIFEST);
	assert.ok(entries.length >= 190, `Expected a broad pinned inventory, received ${entries.length} actions.`);
	assert.ok(Object.isFrozen(AUDACITY_ACTION_MANIFEST));

	for (const [id, definition] of entries) {
		assert.equal(definition.id, id);
		assert.equal(typeof definition.label, 'string');
		assert.ok(definition.label.length > 0);
		assert.ok(Array.isArray(definition.locations) && definition.locations.length > 0);
		assert.ok(definition.locations.every((location) => typeof location === 'string' && location.length > 0));
		assert.ok(Object.hasOwn(definition, 'shortcut'));
		assert.ok(Object.hasOwn(definition, 'handler'));
		assert.equal(typeof definition.enableWhen, 'string');
		assert.ok(Object.values(AUDACITY_ACTION_STATUS).includes(definition.status));
		assert.equal(typeof definition.upstreamAction, 'string');
		assert.ok(['upstream', 'local'].includes(definition.origin));
		assert.ok(Object.isFrozen(definition));
		assert.ok(Object.isFrozen(definition.locations));

		if (definition.origin === 'upstream') {
			assert.equal(typeof definition.upstreamSource, 'string');
			assert.ok(definition.upstreamSource.length > 0);
		} else {
			assert.equal(definition.upstreamSource, null);
		}

		if (definition.status === AUDACITY_ACTION_STATUS.IMPLEMENTED) {
			assert.equal(typeof definition.handler, 'string');
			assert.ok(definition.handler.length > 0);
		} else {
			assert.equal(definition.handler, null);
			assert.equal(definition.enableWhen, 'never');
			assert.equal(typeof definition.reason.en, 'string');
			assert.equal(typeof definition.reason.de, 'string');
			assert.ok(Object.isFrozen(definition.reason));
		}
	}
});

test('every Audacity action has a roadmap disposition with actionable ownership', () => {
	const dispositions = new Map(Object.values(AUDACITY_ACTION_ROADMAP_DISPOSITION).map((value) => [value, 0]));
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		assert.ok(dispositions.has(definition.roadmapDisposition), definition.id);
		dispositions.set(definition.roadmapDisposition, dispositions.get(definition.roadmapDisposition) + 1);
		if (definition.roadmapDisposition === AUDACITY_ACTION_ROADMAP_DISPOSITION.IMPLEMENTED) {
			assert.equal(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, definition.id);
			continue;
		}
		if (definition.roadmapDisposition === AUDACITY_ACTION_ROADMAP_DISPOSITION.JUSTIFIED_EXCLUDED) {
			assert.ok(definition.reason?.en && definition.reason?.de, definition.id);
			continue;
		}
		assert.match(definition.roadmapMilestone, /^(?:[1-9]|8[AB])$/u, definition.id);
	}
	for (const [disposition, count] of dispositions) assert.ok(count > 0, disposition);

	for (const id of [
		'align-together', 'sort-by-name',
		'raw-data-import',
	]) {
		assert.equal(audacityActionDefinition(id).roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.PLANNED, id);
		assert.equal(audacityActionDefinition(id).roadmapMilestone, '3', id);
	}
	for (const id of [
		'toggle-sound-activated-recording', 'set-sound-activation-level',
		'menu-selection-spectral', 'toggle-spectral-selection', 'spectral-brush',
		'select-previous-clip', 'select-next-clip', 'skip-to-selection-start',
		'skip-to-selection-end', 'local://select-no-tracks',
	]) {
		assert.equal(audacityActionDefinition(id).roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.IMPLEMENTED, id);
		assert.equal(audacityActionDefinition(id).roadmapMilestone, undefined, id);
	}
	for (const id of ['plugin-manager', 'audio-setup', 'diagnostic-save-diagnostic-files']) {
		assert.equal(audacityActionDefinition(id).roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.PLANNED, id);
	}
	for (const id of ['file-save-to-cloud', 'raise-segfault', 'sample-data-import']) {
		assert.equal(
			audacityActionDefinition(id).roadmapDisposition,
			AUDACITY_ACTION_ROADMAP_DISPOSITION.JUSTIFIED_EXCLUDED,
			id,
		);
	}
	assert.match(audacityActionReason('reset-configuration', 'en'), /superseded/u);
});

test('upstream disabled and TODO actions stay explicit, inert, and user-explainable', () => {
	const requiredDisabled = [
		'export-midi',
		'menu-align',
		'menu-sort',
		'menu-macros',
		'raw-data-import',
		'reset-configuration',
		'insert',
	];

	for (const id of requiredDisabled) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition?.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM, id);
		assert.equal(definition.handler, null);
		assert.equal(definition.enableWhen, 'never');
		assert.ok(audacityActionReason(id, 'en'));
		assert.ok(audacityActionReason(id, 'de'));
	}
});

test('sound activation parity actions expose real handlers and guarded enablement', () => {
	const toggle = audacityActionDefinition('toggle-sound-activated-recording');
	assert.equal(toggle.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(toggle.handler, 'recording.toggleSoundActivation');
	assert.equal(toggle.enableWhen, 'sound-activation-preferences-mutable');
	assert.equal(toggle.shortcut, null);
	const level = audacityActionDefinition('set-sound-activation-level');
	assert.equal(level.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(level.handler, 'recording.openSoundActivation');
	assert.equal(level.enableWhen, 'sound-activation-preferences-available');

	const context = {
		snapshot: {
			productId: 'soundscaper',
			project: { tracks: [], clips: [] },
			readOnly: false,
			recordingInputs: { soundActivation: {
				preferences: { enabled: false, thresholdDb: -40, hysteresisDb: 6, holdMilliseconds: 250 },
				preferenceMutationBlocked: false,
				preferenceMutationBlockReason: null,
				sources: [],
			} },
		},
	};
	assert.equal(evaluateAudacityActionEnablement(toggle.id, context), true);
	assert.equal(evaluateAudacityActionEnablement(level.id, context), true);
	const pending = structuredClone(context);
	pending.snapshot.recordingInputs.soundActivation.preferenceMutationBlocked = true;
	pending.snapshot.recordingInputs.soundActivation.preferenceMutationBlockReason = 'preference-update';
	assert.equal(evaluateAudacityActionEnablement(toggle.id, pending), false);
	assert.equal(evaluateAudacityActionEnablement(level.id, pending), true);
	const readOnly = structuredClone(context);
	readOnly.snapshot.readOnly = true;
	assert.equal(evaluateAudacityActionEnablement(toggle.id, readOnly), false);
	assert.equal(evaluateAudacityActionEnablement(level.id, readOnly), true);
	const framescaper = structuredClone(context);
	framescaper.snapshot.productId = 'framescaper';
	assert.equal(evaluateAudacityActionEnablement(toggle.id, framescaper), false);
	assert.equal(evaluateAudacityActionEnablement(level.id, framescaper), false);

	const actionRuntime = {
		recording: {
			toggleSoundActivation: () => true,
			openSoundActivation: () => true,
		},
	};
	const [record] = applyAudacityParityToMenus([{
		id: 'record',
		label: 'Record',
		items: [
			{ id: toggle.id, label: 'stale toggle label' },
			{ id: level.id, label: 'stale level label' },
		],
	}], { actionRuntime, actionContext: context });
	assert.deepEqual(record.items.map(({ label, disabled }) => [label, disabled]), [
		['Sound-activated recording', undefined],
		['Sound activation level', undefined],
	]);
	assert.strictEqual(record.items[0].onClick, actionRuntime.recording.toggleSoundActivation);
	assert.strictEqual(record.items[1].onClick, actionRuntime.recording.openSoundActivation);
	const commands = new Map(collectAudacityShortcutCommands([record]).map((command) => [command.id, command]));
	assert.equal(commands.get(toggle.id).disabled, false);
	assert.equal(commands.get(level.id).disabled, false);
});

test('spectral selection and brush actions are native, state-guarded menu workflows', () => {
	const spectral = [
		['menu-selection-spectral', 'tools.openSpectralSelection'],
		['toggle-spectral-selection', 'tools.toggleSpectralSelection'],
		['spectral-brush', 'tools.toggleSpectralBrush'],
	];
	for (const [id, handler] of spectral) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
		assert.equal(definition.handler, handler, id);
		assert.equal(definition.enableWhen, 'editable-spectrogram-track-selected', id);
	}
	const context = {
		snapshot: {
			project: {
				tracks: [{ id: 'audio', type: 'audio', displayMode: 'spectrogram', clipIds: [] }],
				clips: [],
				selection: { startFrame: 0, endFrame: 0, trackIds: ['audio'], clipIds: [], frequencyRange: null },
			},
			selectedTrackId: 'audio',
			readOnly: false,
			timeline: { view: 'waveform' },
		},
	};
	assert.equal(evaluateAudacityActionEnablement('spectral-brush', context), true);
	const waveform = structuredClone(context);
	waveform.snapshot.project.tracks[0].displayMode = 'waveform';
	assert.equal(evaluateAudacityActionEnablement('spectral-brush', waveform), false);
	const readOnly = structuredClone(context);
	readOnly.snapshot.readOnly = true;
	assert.equal(evaluateAudacityActionEnablement('spectral-brush', readOnly), false);
});

test('removed and superseded actions remain auditable without entering application menus', () => {
	const exportMidi = audacityActionDefinition('export-midi');
	assert.equal(exportMidi.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.equal(exportMidi.menuVisible, false);
	const rawImport = audacityActionDefinition('raw-data-import');
	assert.equal(rawImport.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.equal(rawImport.menuVisible, false);
	const resetConfiguration = audacityActionDefinition('reset-configuration');
	assert.equal(resetConfiguration.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.equal(resetConfiguration.menuVisible, false);

	const menus = applyAudacityParityToMenus([{
		id: 'tools',
		label: 'Tools',
		items: [
			{ id: 'raw-data-import', label: 'Import raw data' },
			{ id: 'reset-configuration', label: 'Reset configuration' },
		],
	}], { materializeDisabled: true });
	const serialized = JSON.stringify(menus);
	assert.doesNotMatch(serialized, /raw-data-import/);
	assert.doesNotMatch(serialized, /reset-configuration/);
	assert.doesNotMatch(serialized, /sample-data-(?:import|export)/);
	assert.doesNotMatch(JSON.stringify(applyAudacityParityToMenus([{
		id: 'file',
		label: 'File',
		items: [{ id: 'export-other', label: 'Export other', items: [] }],
	}], { materializeDisabled: true })), /export-midi/);
});

test('the milestone 8B MIDI fence keeps every pinned action inert and off command surfaces', () => {
	const midiActionIds = ['export-midi', 'midi-device-info', 'local://midi-track'];
	assert.deepEqual(AUDACITY_MIDI_FENCE.actionIds, midiActionIds);
	assert.ok(Object.isFrozen(AUDACITY_MIDI_FENCE));
	assert.ok(Object.isFrozen(AUDACITY_MIDI_FENCE.actionIds));
	for (const id of midiActionIds) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.handler, null, id);
		assert.equal(definition.enableWhen, 'never', id);
		assert.equal(definition.shortcut, null, id);
		assert.equal(definition.roadmapDisposition, 'blocked', id);
		assert.equal(definition.roadmapMilestone, '8B', id);
		assert.equal(definition.blockedThroughMilestone, 7, id);
		assert.match(audacityActionReason(id, 'en'), /milestone 8B/u, id);
		assert.match(audacityActionReason(id, 'en'), /pending Audacity MIDI design/u, id);
	}

	const shortcutIds = collectAudacityShortcutCommands([]).map(({ id }) => id);
	assert.deepEqual(shortcutIds.filter((id) => midiActionIds.includes(id)), []);
});

test('Audacity Mix-down to is a concrete destructive track action', () => {
	const definition = audacityActionDefinition('mixdown-to');
	assert.equal(definition?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(definition.handler, 'track.mixAndRender');
	assert.equal(definition.enableWhen, 'editable-audio-track-selected');
	assert.equal(resolveAudacityActionId('mix-render'), 'mixdown-to');
	assert.equal(audacityActionDefinition('mix-render-new'), null);
});

test('cloud, installable plugins, OS audio, MIDI tracks, Extra, diagnostics, and updates are audit-only exclusions', () => {
	const excluded = [
		'file-save-to-cloud',
		'file-share-audio',
		'audacity://cloud/open-audio-file',
		'link-account',
		'plugin-manager',
		'audio-setup',
		'audio-settings',
		'rescan-devices',
		'local://midi-track',
		'menu-extra',
		'menu-diagnostics',
		'check-update',
	];

	for (const id of excluded) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition?.status, AUDACITY_ACTION_STATUS.EXCLUDED, id);
		assert.equal(definition.handler, null);
	}

	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (/cloud|audio\.com|plugin|diagnostic|rescan-devices|audio-setup/.test(
			`${definition.id} ${definition.label}`.toLowerCase(),
		)) {
			assert.notEqual(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, definition.id);
		}
	}
	assert.equal(audacityActionDefinition('nyquist-prompt')?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
});

test('legacy UI aliases resolve to stable upstream IDs and share one policy record', () => {
	assert.equal(resolveAudacityActionId('new-project'), 'file-new');
	assert.equal(audacityActionDefinition('new-project'), AUDACITY_ACTION_MANIFEST['file-new']);
	assert.equal(audacityActionDefinition('ripple-delete'), AUDACITY_ACTION_MANIFEST['delete-per-track-ripple']);
	assert.equal(audacityActionDefinition('effect-plugin-manager'), AUDACITY_ACTION_MANIFEST['plugin-manager']);
	assert.equal(audacityActionDefinition('midi-track'), AUDACITY_ACTION_MANIFEST['local://midi-track']);
	assert.equal(audacityActionDefinition('change-tempo'), AUDACITY_ACTION_MANIFEST['effect://builtin/change-tempo']);
	assert.equal(resolveAudacityActionId('play-at-speed'), 'local://play-at-speed');
	assert.equal(audacityActionDefinition('play-at-speed')?.handler, 'transport.playAtSpeed');
	assert.equal(
		audacityActionDefinition('action://trackedit/track/change-rate?rate=44100'),
		AUDACITY_ACTION_MANIFEST['action://trackedit/track/change-rate?rate=%1'],
	);
	assert.equal(audacityActionDefinition('not-in-inventory'), null);
	assert.ok(Object.isFrozen(AUDACITY_ACTION_ALIASES));
});

test('Nyquist spectral processors require an editable frequency selection', () => {
	assert.equal(audacityActionDefinition('nyquist:spectral-delete').enableWhen, 'editable-frequency-selection');
	assert.equal(audacityActionDefinition('nyquist:spectraleditmulti').enableWhen, 'editable-frequency-selection');
	assert.equal(audacityActionDefinition('nyquist:lowpass').enableWhen, 'editable-selection-or-clip');
});

test('the complete enableWhen vocabulary evaluates from runtime state', () => {
	const context = {
		snapshot: {
			project: {
				tracks: [
					{ id: 'audio-1', type: 'audio', displayMode: 'spectrogram', clipIds: ['clip-1'], effects: [] },
					{ id: 'audio-2', type: 'audio', displayMode: 'waveform', clipIds: ['clip-2'], effects: [] },
					{ id: 'labels-1', type: 'label', labels: [] },
				],
				clips: [
					{ id: 'clip-1', sourceId: 'source-1', groupId: 'group-1', pitchCents: 100, speedRatio: 1, stretchToTempo: false },
					{ id: 'clip-2', sourceId: 'source-2', pitchCents: 0, speedRatio: 1, stretchToTempo: false },
				],
				sources: [
					{ id: 'source-1', channelCount: 1, sampleRate: 48_000 },
					{ id: 'source-2', channelCount: 1, sampleRate: 44_100 },
				],
				selection: {
					startFrame: 100,
					endFrame: 200,
					trackIds: ['audio-1'],
					clipIds: ['clip-1'],
					frequencyRange: { minimumFrequency: 100, maximumFrequency: 1_000 },
				},
				loop: { enabled: true, startFrame: 100, endFrame: 200 },
			},
			selectedTrackId: 'audio-1',
			selectedClipId: 'clip-1',
			readOnly: false,
			recentProjects: [{ id: 'recent-1' }],
			history: { canUndo: true, canRedo: false, hasClipboard: true },
			effects: { canRepeatLast: true, presets: [] },
			timeline: { view: 'waveform' },
		},
		telemetry: { transportState: 'stopped', recording: false },
	};

	const vocabulary = new Set(Object.values(AUDACITY_ACTION_MANIFEST).map(({ enableWhen }) => enableWhen));
	for (const predicate of vocabulary) {
		assert.equal(typeof evaluateAudacityEnableWhen(predicate, context), 'boolean', predicate);
	}
	assert.equal(evaluateAudacityActionEnablement('duplicate-track', context), true);
	assert.equal(evaluateAudacityActionEnablement('action://trackedit/track/change-rate?rate=44100', context), true);
	assert.equal(evaluateAudacityActionEnablement('clip-render-pitch-speed', context), true);
	assert.equal(evaluateAudacityActionEnablement('export-midi', context), false);
	assert.equal(evaluateAudacityActionEnablement('plugin-manager', context), false);

	const readOnlyContext = structuredClone(context);
	readOnlyContext.snapshot.readOnly = true;
	assert.equal(evaluateAudacityActionEnablement('duplicate-track', readOnlyContext), false);
	assert.equal(evaluateAudacityActionEnablement('action://copy', readOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('action://cut', readOnlyContext), false);
	const clipOnlyContext = structuredClone(context);
	clipOnlyContext.snapshot.project.selection.startFrame = 0;
	clipOnlyContext.snapshot.project.selection.endFrame = 0;
	assert.equal(evaluateAudacityActionEnablement('delete-leave-gap', clipOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('delete-all-tracks-ripple', clipOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('silence-audio-selection', clipOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('effect://builtin/processors', clipOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('repeat-last-effect', clipOnlyContext), true);
	assert.equal(evaluateAudacityActionEnablement('trim-audio-outside-selection', clipOnlyContext), false);
	assert.equal(evaluateAudacityActionEnablement('zero-cross', clipOnlyContext), false);
	assert.throws(() => evaluateAudacityEnableWhen('not-a-predicate', context), /Unknown Audacity/);
});

test('every registered unavailable application-menu action has a parity classification', () => {
	const placeholderIds = AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS;
	assert.ok(placeholderIds.length > 0, 'Expected an explicit unavailable-action inventory.');
	assert.equal(new Set(placeholderIds).size, placeholderIds.length);
	assert.ok(Object.isFrozen(placeholderIds));
	assert.deepEqual(
		placeholderIds.filter((id) => !audacityActionDefinition(id)),
		[],
	);
	for (const id of placeholderIds) {
		assert.deepEqual(createUnavailableApplicationMenuItem(id, id), { id, label: id, disabled: true });
	}
	assert.throws(
		() => createUnavailableApplicationMenuItem('not-in-the-registry', 'Unknown'),
		/Unknown unavailable application-menu action/,
	);
});

test('implemented parity actions are never registered as unavailable menu placeholders', () => {
	assert.deepEqual(
		AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS.filter(
			(id) => audacityActionDefinition(id)?.status === AUDACITY_ACTION_STATUS.IMPLEMENTED,
		),
		[],
	);
});

test('critical functional manifest surfaces have semantic menu registry entries', () => {
	const explicitIds = new Set(AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS.map(resolveAudacityActionId));
	const critical = [
		'open-label-editor', 'open-metadata-editor', 'select-all-tracks',
		'local://select-no-tracks', 'select-previous-clip-boundary-to-cursor',
		'select-cursor-to-next-clip-boundary', 'select-previous-clip', 'select-next-clip',
		'skip-to-selection-start', 'skip-to-selection-end',
		'select-left-of-playback-position', 'select-right-of-playback-position',
		'select-track-start-to-cursor', 'select-cursor-to-track-end', 'select-track-start-to-end',
		'toggle-loop-region', 'clear-loop-region', 'set-loop-region-to-selection', 'set-loop-region-in-out',
		'toggle-rms-in-waveform', 'record-on-new-track', 'action://record/pause',
		'action://record/lead-in-recording', 'set-up-timed-recording',
		'toggle-sound-activated-recording', 'set-sound-activation-level',
		'metronome', 'track-resample', 'repeat-last-effect',
		'online-handbook', 'local://support', 'revert-factory', 'about-audacity',
	];
	assert.equal(explicitIds.size, critical.length);
	assert.deepEqual(critical.filter((id) => !explicitIds.has(id)), []);
	for (const id of critical) {
		assert.equal(AUDACITY_ACTION_MANIFEST[id]?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
	}
});

test('menu decoration removes hidden actions and preserves pending local actions with localized reasons', () => {
	const exportMidi = () => 'must never run';
	const createProject = () => 'create';
	const menus = [
		{
			id: 'file',
			label: 'Datei',
			items: [
				{ id: 'plugin-manager', label: 'Plugin-Manager' },
				{ divider: true },
				{ id: 'export-midi', label: 'MIDI exportieren', onClick: exportMidi },
				{ divider: true },
				{ id: 'save-project', label: 'Speichern', disabled: true },
				{ divider: true },
				{ id: 'new-project', label: 'Neu', onClick: createProject },
				{ divider: true },
			],
		},
		{ id: 'extra', label: 'Extra', items: [{ id: 'extra-play', label: 'Play' }] },
	];

	const decorated = applyAudacityParityToMenus(menus, { locale: 'de' });
	assert.deepEqual(decorated.map(({ id }) => id), ['file']);
	assert.deepEqual(decorated[0].items.map((item) => item.divider ? 'divider' : item.id), [
		'save-project', 'divider', 'new-project',
	]);

	const [pendingSave, , newProject] = decorated[0].items;
	assert.match(pendingSave.disabledReason, /noch nicht angebunden/);
	assert.equal(newProject.onClick, createProject);
	assert.equal(newProject.label, 'Neu');
	assert.equal(newProject.parityActionId, 'file-new');

	assert.equal(menus.length, 2);
	assert.equal(menus[0].items[2].onClick, exportMidi);
	assert.equal(menus[0].items.at(-1).divider, true);
	assert.throws(() => applyAudacityParityToMenus(null), /menus must be an array/);
});

test('menu decoration uses pinned Audacity labels instead of divergent English call-site copy', () => {
	const onClick = () => {};
	const [item] = applyAudacityParityToMenus([{
		id: 'file-new',
		label: 'Create a local project',
		onClick,
	}], { locale: 'en' });
	assert.equal(item.label, 'New');
	assert.equal(item.onClick, onClick);

	const [stateful] = applyAudacityParityToMenus([{
		id: 'record',
		label: 'Stop recording',
		preserveLabel: true,
		onClick,
	}], { locale: 'en' });
	assert.equal(stateful.label, 'Stop recording');
	assert.equal(Object.hasOwn(stateful, 'preserveLabel'), false);
});

test('shortcut command inventory consumes manifest actions while keeping disabled entries inert and exclusions absent', () => {
	const commands = collectAudacityShortcutCommands([{
		id: 'file',
		label: 'Datei',
		items: [
			{ id: 'new-project', label: 'Neues Projekt', shortcut: 'Ctrl+N', disabled: true, disabledReason: 'Kein Projekt.' },
			{ id: 'plugin-manager', label: 'Plugin-Manager' },
			{ id: 'local-command', label: 'Lokaler Befehl', disabled: true, disabledReason: 'Lokaler Platzhalter.' },
		],
	}], { locale: 'de' });
	const byId = new Map(commands.map((command) => [command.id, command]));

	assert.equal(byId.has('plugin-manager'), false);
	assert.equal(byId.get('file-new').label, 'Neues Projekt');
	assert.equal(byId.get('file-new').preferenceId, 'new-project');
	assert.equal(byId.get('file-new').disabled, false);
	assert.equal(byId.get('zoom-default').parityStatus, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(byId.get('local-command').parityStatus, null);
	assert.equal(byId.get('local-command').disabled, true);
	assert.equal(byId.get('local-command').disabledReason, 'Lokaler Platzhalter.');

	const insert = byId.get('insert');
	assert.equal(insert.label, 'Einfügen');
	assert.equal(insert.preferenceId, 'insert');
	assert.equal(insert.parityStatus, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.equal(insert.disabled, true);
	assert.match(insert.disabledReason, /noch keine nutzbare Aktion/);
	const remote = new Map(collectAudacityShortcutCommands([], {
		locale: 'fr',
		copy: {
			audacityParityLabelInsert: 'Insertion distante',
			audacityParityReasonTodo: 'Commande distante indisponible.',
		},
	}).map((command) => [command.id, command]));
	assert.equal(remote.get('insert').label, 'Insertion distante');
	assert.equal(remote.get('insert').disabledReason, 'Commande distante indisponible.');
	assert.throws(() => collectAudacityShortcutCommands(null), /menus must be an array/);
});
