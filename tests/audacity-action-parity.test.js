import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('upstream disabled and TODO actions stay explicit, inert, and user-explainable', () => {
	const requiredDisabled = [
		'export-midi',
		'menu-selection-audio-clips',
		'menu-selection-spectral',
		'menu-skip',
		'menu-align',
		'menu-sort',
		'toggle-sound-activated-recording',
		'set-sound-activation-level',
		'menu-macros',
		'raw-data-import',
		'reset-configuration',
		'spectral-brush',
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

test('superseded tools and raw-data actions remain auditable without entering application menus', () => {
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

test('every existing disabled application-menu placeholder has a parity classification', async () => {
	const source = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const placeholderIds = [...source.matchAll(/unavailable\('([^']+)'/g)].map((match) => match[1]);
	assert.ok(
		placeholderIds.length >= 15,
		`Expected the explicit unavailable-action inventory, received ${placeholderIds.length} placeholders.`,
	);
	assert.deepEqual(
		placeholderIds.filter((id) => !audacityActionDefinition(id)),
		[],
	);
});

test('implemented parity actions are never represented by unavailable menu placeholders', async () => {
	const source = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const placeholderIds = [...source.matchAll(/unavailable\('([^']+)'/g)].map((match) => match[1]);
	assert.deepEqual(
		placeholderIds.filter((id) => audacityActionDefinition(id)?.status === AUDACITY_ACTION_STATUS.IMPLEMENTED),
		[],
	);
});

test('critical functional manifest surfaces have explicit menu command IDs', async () => {
	const source = await readFile(new URL('../src/common/editor/ui/AudioEditorApp.jsx', import.meta.url), 'utf8');
	const explicitIds = new Set(
		[...source.matchAll(/(?:id:\s*|unavailable\()'([^']+)'/g)]
			.map((match) => resolveAudacityActionId(match[1])),
	);
	const critical = [
		'open-label-editor', 'open-metadata-editor', 'select-all-tracks',
		'select-left-of-playback-position', 'select-right-of-playback-position',
		'select-track-start-to-cursor', 'select-cursor-to-track-end', 'select-track-start-to-end',
		'toggle-loop-region', 'clear-loop-region', 'set-loop-region-to-selection', 'set-loop-region-in-out',
		'toggle-rms-in-waveform', 'record-on-new-track', 'action://record/pause',
		'action://record/lead-in-recording', 'metronome', 'track-resample', 'repeat-last-effect',
		'online-handbook', 'local://support', 'revert-factory', 'about-audacity',
	];
	assert.deepEqual(critical.filter((id) => !explicitIds.has(id)), []);
	for (const id of critical) {
		assert.equal(AUDACITY_ACTION_MANIFEST[id]?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED, id);
	}
});

test('menu decoration removes exclusions and preserves disabled actions with localized reasons', () => {
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
		'export-midi', 'divider', 'save-project', 'divider', 'new-project',
	]);

	const [disabledMidi, , pendingSave, , newProject] = decorated[0].items;
	assert.equal(disabledMidi.label, 'MIDI exportieren');
	assert.equal(disabledMidi.disabled, true);
	assert.equal(disabledMidi.onClick, undefined);
	assert.equal(disabledMidi.parityActionId, 'export-midi');
	assert.equal(disabledMidi.parityStatus, AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM);
	assert.match(disabledMidi.disabledReason, /deaktiviert/);
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
