import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	applyAudacityParityToMenus,
	audacityActionDefinition,
	resolveAudacityActionId,
	evaluateAudacityActionEnablement,
	evaluateAudacityEnableWhen,
} from '../src/common/editor/audacity-action-parity.js';
import { collectAudacityShortcutCommands } from '../src/common/editor/ui/dialogs/workspace-preferences-shortcut-commands.ts';
import {
	AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS,
	AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS,
	createUnavailableApplicationMenuItem,
} from '../src/common/editor/ui/application-menu-registry.ts';

/**
 * What the parity manifest does once the editor is running.
 *
 * `tests/audacity-action-parity.test.js` holds the other half: that every upstream action
 * has a record, a disposition and an owner. These tests take those records as given and
 * check the surfaces that consume them — enablement evaluated from live state, the menus
 * decorated from the manifest, and the shortcut inventory built out of it.
 */

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
	assert.equal(placeholderIds.length, 0);
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
				{ id: 'plugin-manager', label: 'Plugin-Manager' }, { id: 'mixdown-to', label: 'Mix-down to' },
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
	assert.equal(menus[0].items.find(({ id }) => id === 'export-midi').onClick, exportMidi);
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
	assert.equal(insert.parityStatus, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(insert.disabled, false);
	assert.equal(insert.disabledReason, null);
	const remote = new Map(collectAudacityShortcutCommands([], {
		locale: 'fr',
		copy: {
			audacityParityLabelInsert: 'Insertion distante',
			audacityParityReasonTodo: 'Commande distante indisponible.',
		},
	}).map((command) => [command.id, command]));
	assert.equal(remote.get('insert').label, 'Insertion distante');
	assert.equal(remote.get('insert').disabledReason, null);
	assert.throws(() => collectAudacityShortcutCommands(null), /menus must be an array/);
});

test('shortcut command inventory omits product-disabled capability groups and submenu containers', () => {
	const disabledCommandIds = [
		'record', 'generate', 'selection-effect', 'spectral-edit', 'analyze', 'manage-macros', 'nyquist-prompt',
	];
	const commands = new Set(collectAudacityShortcutCommands([], { disabledCommandIds }).map(({ id }) => id));
	const omitted = [
		'record-on-new-track', 'generator://tone', 'effect://builtin/processors', 'spectral-brush',
		'contrast-analyzer', 'manage-macros', 'nyquist-prompt', 'nyquist:lowpass', 'menu-align', 'menu-sort',
	];
	assert.deepEqual(omitted.filter((id) => commands.has(id)), []);
	assert.equal(commands.has('file-new'), true);
	assert.equal(commands.has('sort-by-name'), true);
});
