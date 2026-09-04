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
	evaluateAudacityActionEnablement,
	resolveAudacityActionId,
} from '../src/common/editor/audacity-action-parity.js';
import { collectAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';
import { AUDACITY_ACTION_ROADMAP_DISPOSITION, AUDACITY_MIDI_FENCE } from '../src/common/editor/audacity-action-roadmap.ts';

const PINNED_COMMIT = '4c177d436e48c1d20f231eada44035593cb26292';

test('Audacity action parity is pinned to the reviewed Audacity 4 source revision', () => {
	assert.equal(AUDACITY_ACTION_SOURCE.commit, PINNED_COMMIT);
	assert.match(AUDACITY_ACTION_SOURCE.url, new RegExp(PINNED_COMMIT));
	assert.equal(AUDACITY_ACTION_SOURCE.version, '4.0.0');
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
	for (const [disposition, count] of dispositions) {
		if (disposition === AUDACITY_ACTION_ROADMAP_DISPOSITION.BLOCKED) {
			assert.equal(count, 0, 'human review cannot block implementation work');
		} else assert.ok(count > 0, disposition);
	}

	assert.deepEqual(
		Object.values(AUDACITY_ACTION_MANIFEST)
			.filter((definition) => definition.roadmapMilestone === '3')
			.map((definition) => definition.id),
		[],
		'Milestone 3 exits with no planned Audacity action gaps',
	);
	for (const id of [
		'insert', 'project-properties',
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
	for (const id of [
		'menu-macros', 'apply-macros-palette', 'macro-fade-ends', 'macro-mp3-conversion', 'get-effects', 'project-show-in-folder',
	]) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.JUSTIFIED_EXCLUDED, id);
		assert.equal(definition.roadmapMilestone, undefined, id);
	}
	assert.match(audacityActionReason('reset-configuration', 'en'), /superseded/u);
});

test('upstream disabled and TODO actions stay explicit, inert, and user-explainable', () => {
	const requiredDisabled = ['export-midi', 'menu-macros', 'reset-configuration'];

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

test('removed and superseded actions remain auditable while raw import is actionable', () => {
	const exportMidi = audacityActionDefinition('export-midi');
	assert.equal(exportMidi.status, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.equal(exportMidi.menuVisible, false);
	const rawImport = audacityActionDefinition('raw-data-import');
	assert.equal(rawImport.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(rawImport.handler, 'io.importRawData');
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
	assert.match(serialized, /raw-data-import/);
	assert.doesNotMatch(serialized, /reset-configuration/);
	assert.doesNotMatch(serialized, /sample-data-(?:import|export)/);
	assert.doesNotMatch(JSON.stringify(applyAudacityParityToMenus([{
		id: 'file',
		label: 'File',
		items: [{ id: 'export-other', label: 'Export other', items: [] }],
	}], { materializeDisabled: true })), /export-midi/);
});

test('milestone 3 import and analysis actions have exact menu ownership and handlers', () => {
	for (const [id, parents, handler] of [
		['raw-data-import', ['Tools'], 'io.importRawData'],
		['local://repeat-generator', ['Generate'], 'generators.repeatLast'],
		['local://repeat-analyzer', ['Analyze'], 'analysis.repeatLast'],
		['regular-interval-labels', ['Extra'], 'timelineAnnotations.openRegularInterval'],
	]) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
		assert.deepEqual(definition.locations, parents, id);
		assert.equal(definition.handler, handler, id);
		assert.equal(definition.roadmapDisposition, AUDACITY_ACTION_ROADMAP_DISPOSITION.IMPLEMENTED, id);
	}
});

test('the unimplemented milestone 8B MIDI plan stays inert and post-1.0', () => {
	const midiActionIds = ['export-midi', 'midi-device-info', 'local://midi-track'];
	assert.deepEqual(AUDACITY_MIDI_FENCE.actionIds, midiActionIds);
	assert.ok(Object.isFrozen(AUDACITY_MIDI_FENCE));
	assert.ok(Object.isFrozen(AUDACITY_MIDI_FENCE.actionIds));
	for (const id of midiActionIds) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition.handler, null, id);
		assert.equal(definition.enableWhen, 'never', id);
		assert.equal(definition.shortcut, null, id);
		assert.equal(definition.roadmapDisposition, 'planned', id);
		assert.equal(definition.roadmapMilestone, '8B', id);
		assert.equal(definition.releaseReviewMilestone, undefined, id);
		assert.equal(definition.blockedThroughMilestone, undefined, id);
		assert.match(audacityActionReason(id, 'en'), /not implemented/u, id);
		assert.match(audacityActionReason(id, 'en'), /post-1\.0 scope/u, id);
	}

	const shortcutIds = collectAudacityShortcutCommands([]).map(({ id }) => id);
	assert.deepEqual(shortcutIds.filter((id) => midiActionIds.includes(id)), []);
});

test('Mix & Render is canonical while the Audacity Mix-down to record stays compatibility-only', () => {
	const definition = audacityActionDefinition('mix-render');
	assert.deepEqual([definition?.label, definition?.locations, definition?.handler, definition?.origin],
		['Mix & Render', ['Tracks'], 'track.openMixRender', 'local']);
	assert.equal(resolveAudacityActionId('mixdown-to'), 'mix-render');
	assert.equal(audacityActionDefinition('mixdown-to'), definition);
	assert.deepEqual([AUDACITY_ACTION_MANIFEST['mixdown-to'].label, AUDACITY_ACTION_MANIFEST['mixdown-to'].locations,
		AUDACITY_ACTION_MANIFEST['mixdown-to'].menuVisible, AUDACITY_ACTION_MANIFEST['mixdown-to'].origin],
		['Mix-down to', ['Tracks > Mix'], false, 'upstream']);
});

test('cloud, installable plugins, OS audio, MIDI tracks, Extra, developer diagnostics, and updates remain excluded', () => {
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
		'check-update',
	];

	for (const id of excluded) {
		const definition = audacityActionDefinition(id);
		assert.equal(definition?.status, AUDACITY_ACTION_STATUS.EXCLUDED, id);
		assert.equal(definition.handler, null);
	}

	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (definition.id !== 'menu-diagnostics' && /cloud|audio\.com|plugin|diagnostic|rescan-devices|audio-setup/.test(
			`${definition.id} ${definition.label}`.toLowerCase(),
		)) {
			assert.notEqual(definition.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, definition.id);
		}
	}
	assert.equal(audacityActionDefinition('nyquist-prompt')?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
});

test('legacy UI aliases resolve to stable upstream IDs and share one policy record', () => {
	assert.equal(resolveAudacityActionId('new-project'), 'file-new');
	for (const id of ['constructor', '__proto__']) { assert.equal(resolveAudacityActionId(id), id); assert.equal(audacityActionDefinition(id), null); }
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
