import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import {
	COPY, createMemoryEngine, createMemoryStore, createMemoryTimePitchCache, valueAtPath,
} from './helpers/audacity-action-runtime-fixture.js';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	applyAudacityParityToMenus,
	auditAudacityActionRuntime,
	resolveAudacityActionHandler,
} = await import('../src/common/editor/audacity-action-parity.js');
const {
	createAudacityActionRuntime,
	createAudioEditorUiActionController,
} = await import('../src/common/editor/audacity-action-runtime.js');

test('every implemented manifest action resolves on the concrete editor runtime', async () => {
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true,
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		copy: COPY,
	});
	await controller.ready;
	const uiController = createAudioEditorUiActionController();
	const runtime = createAudacityActionRuntime(controller, { uiController, productId: 'framescaper' });

	try {
		const audit = auditAudacityActionRuntime(runtime.actions);
		const implemented = Object.values(AUDACITY_ACTION_MANIFEST)
			.filter((definition) => definition.status === AUDACITY_ACTION_STATUS.IMPLEMENTED);
		assert.equal(audit.complete, true);
		assert.equal(audit.resolved.length, implemented.length);
		assert.deepEqual(audit.missing, []);
		assert.strictEqual(
			runtime.actions.project.saveAs,
			controller.actions.project.saveAs,
			'the parity fallback keeps the facade\'s native Scape save-as action',
		);

		for (const definition of implemented) {
			const resolved = resolveAudacityActionHandler(definition.id, runtime.actions);
			assert.equal(typeof resolved, 'function', `${definition.id}: ${definition.handler}`);
			if (definition.handler !== 'track.audacityMixer') {
				assert.strictEqual(resolved, valueAtPath(runtime.actions, definition.handler));
			}
		}
		const [helpMenu] = applyAudacityParityToMenus([{
			id: 'help',
			label: 'Help',
			items: [
				{ id: 'online-handbook', label: 'Manual' },
				{ id: 'export-midi', label: 'Export MIDI' },
				{ id: 'plugin-manager', label: 'Plugins' },
			],
		}], { actionRuntime: runtime.actions });
		assert.strictEqual(helpMenu.items[0].onClick, runtime.actions.help.openManual);
		assert.equal(helpMenu.items[0].disabled, undefined);
		assert.equal(helpMenu.items.some((item) => item.id === 'export-midi'), false);
		assert.equal(helpMenu.items.some((item) => item.id === 'plugin-manager'), false);

		await runtime.actions.workspace.toggleTransportToolbar();
		assert.equal(controller.getSnapshot().preferences.workspace.toolbars.transport.visible, false);
		assert.equal(controller.getSnapshot().preferences.view.showMasterTrack, false);
		await runtime.actions.workspace.toggleMasterTrack();
		assert.equal(controller.getSnapshot().preferences.view.showMasterTrack, true);
		assert.equal(store.settings.get('audio-editor-preferences-v1').view.showMasterTrack, true);
		assert.equal(uiController.getSnapshot().flags.masterTrack, false);
		await runtime.actions.workspace.toggleMasterTrack();
		assert.equal(controller.getSnapshot().preferences.view.showMasterTrack, false);
		assert.equal(store.settings.get('audio-editor-preferences-v1').view.showMasterTrack, false);
		runtime.actions.panels.labels();
		assert.equal(controller.getSnapshot().preferences.workspace.panels.labels.visible, true);
		assert.equal(uiController.getSnapshot().request.type, 'focus-panel');
		await controller.actions.preferences.setPanelVisibility('history', true);
		await controller.actions.preferences.movePanel('labels', { kind: 'tab', targetPanelId: 'history' });
		await controller.actions.preferences.activatePanelTab('history');
		assert.equal(controller.getSnapshot().preferences.workspace.panels.labels.tabActive, false);
		runtime.actions.panels.labels();
		assert.equal(controller.getSnapshot().preferences.workspace.panels.labels.tabActive, true);
		runtime.actions.track.openSpectrogramSettings();
		assert.equal(uiController.getSnapshot().request.type, 'open-surface');
		assert.equal(uiController.getSnapshot().request.payload.surface, 'preferences');
		assert.equal(uiController.getSnapshot().request.payload.section, 'spectrogram');
		resolveAudacityActionHandler('mix-render', runtime.actions)();
		assert.equal(uiController.getSnapshot().request.payload.surface, 'mix-render');
		resolveAudacityActionHandler('mixdown-to', runtime.actions)();
		assert.equal(uiController.getSnapshot().request.payload.surface, 'mix-render');
		assert.equal(controller.getSnapshot().recordingInputs.soundActivation.preferences.enabled, false);
		assert.equal(await runtime.actions.recording.toggleSoundActivation(), true);
		assert.equal(controller.getSnapshot().recordingInputs.soundActivation.preferences.enabled, true);
		runtime.actions.recording.openSoundActivation();
		assert.equal(uiController.getSnapshot().request.type, 'open-surface');
		assert.equal(uiController.getSnapshot().request.payload.surface, 'preferences');
		assert.equal(uiController.getSnapshot().request.payload.section, 'sound-activation');
		runtime.actions.io.importRawData();
		assert.equal(uiController.getSnapshot().request.payload.surface, 'raw-pcm-import');
		runtime.actions.timelineAnnotations.openRegularInterval();
		assert.equal(uiController.getSnapshot().request.payload.surface, 'regular-interval-annotations');
		assert.equal(runtime.actions.tools.toggleSplitTool(), true);
		assert.equal(uiController.getSnapshot().flags.splitTool, true);
		assert.equal(uiController.getSnapshot().flags.spectralBrush, false);
		assert.equal(runtime.actions.tools.toggleSpectralBrush(), true);
		assert.equal(uiController.getSnapshot().flags.spectralBrush, true);
		assert.equal(uiController.getSnapshot().flags.splitTool, false);
		assert.equal(runtime.actions.tools.toggleSpectralBrush(), false);
		runtime.actions.tools.openSpectralSelection();
		assert.equal(uiController.getSnapshot().request.payload.surface, 'spectral-selection');
		runtime.actions.track.setColor('#123456');
		assert.equal(controller.getSnapshot().project.tracks[0].color, '#123456');
		runtime.actions.track.setHalfWaveView();
		assert.equal(controller.getSnapshot().project.tracks[0].displayMode, 'half-wave');
		const mixerTrackId = controller.getSnapshot().selectedTrackId;
		await resolveAudacityActionHandler('track-pan-right', runtime.actions)();
		assert.equal(controller.getSnapshot().project.tracks[0].pan, 0.1);
		await resolveAudacityActionHandler('track-gain-inc', runtime.actions)();
		assert.ok(controller.getSnapshot().project.tracks[0].gain > 1);
		await resolveAudacityActionHandler('track-mute', runtime.actions)();
		assert.equal(controller.getSnapshot().project.tracks[0].mute, true);
		await controller.actions.edit.undo();
		assert.equal(controller.getSnapshot().project.tracks[0].mute, false);
		assert.equal(controller.getSnapshot().selectedTrackId, mixerTrackId);
		runtime.actions.timeline.setMusicalRuler();
		assert.equal(controller.getSnapshot().project.timeDisplay.format, 'beats+measures');
		controller.actions.timeline.setZoom(120);
		runtime.actions.timeline.zoomToggle();
		assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, 240);
		runtime.actions.timeline.zoomToggle();
		assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, 120);
		controller.actions.timeline.setZoom(360);
		runtime.actions.timeline.zoomDefault();
		assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, 120);
		runtime.actions.timeline.centerOnPlayhead();
		assert.equal(uiController.getSnapshot().request.type, 'center-playhead');
		runtime.actions.help.revertFactorySettings();
		assert.equal(uiController.getSnapshot().request.type, 'revert-factory');
		runtime.actions.help.openManual();
		assert.equal(uiController.getSnapshot().request.payload.url, 'https://soundscaper.org/docs/framescaper/');
		runtime.actions.help.openTutorials();
		assert.equal(
			uiController.getSnapshot().request.payload.url,
			'https://soundscaper.org/docs/framescaper/first-project/',
		);

		const originalTrackId = controller.getSnapshot().selectedTrackId;
		const originalTrackCount = controller.getSnapshot().project.tracks.length;
		const duplicateSelectedTrack = resolveAudacityActionHandler('duplicate-track', runtime.actions);
		duplicateSelectedTrack({ type: 'synthetic-click' });
		assert.equal(controller.getSnapshot().project.tracks.length, originalTrackCount + 1);
		assert.notEqual(controller.getSnapshot().selectedTrackId, originalTrackId);

		const setDynamicRate = resolveAudacityActionHandler(
			'action://trackedit/track/change-rate?rate=44100',
			runtime.actions,
		);
		assert.equal(typeof setDynamicRate, 'function');
		assert.notStrictEqual(setDynamicRate, runtime.actions.track.setRate);
		await setDynamicRate({ type: 'synthetic-click' });
		const duplicatedTrack = controller.getSnapshot().project.tracks.find((track) => (
			track.id === controller.getSnapshot().selectedTrackId
		));
		assert.equal(Object.hasOwn(duplicatedTrack, 'sampleRate'), false);
		assert.equal(resolveAudacityActionHandler('action://trackedit/track/change-rate?rate=not-a-rate', runtime.actions), null);

		const [stateMenu] = applyAudacityParityToMenus([{
			id: 'tracks',
			label: 'Tracks',
			items: [
				{ id: 'duplicate-track', label: 'Duplicate track' },
				{ id: 'action://trackedit/track/change-rate?rate=96000', label: '96000 Hz' },
				{ id: 'action://record/pause', label: 'Pause recording' },
			],
		}], { actionRuntime: runtime.actions });
		assert.equal(stateMenu.items[0].disabled, undefined);
		assert.equal(typeof stateMenu.items[0].onClick, 'function');
		assert.equal(stateMenu.items[1].disabled, undefined);
		assert.equal(typeof stateMenu.items[1].onClick, 'function');
		assert.equal(stateMenu.items[2].disabled, true);
		assert.equal(stateMenu.items[2].onClick, undefined);
		assert.match(stateMenu.items[2].disabledReason, /current editor state/);

		const firstProjectId = controller.getSnapshot().project.id;
		await controller.actions.project.create({ title: 'Second project' });
		assert.equal(controller.getSnapshot().projectTabs.length, 2);
		await runtime.actions.project.clearRecent();
		assert.deepEqual(controller.getSnapshot().recentProjects, []);
		const closeResult = await runtime.actions.session.closeProject();
		assert.equal(closeResult.closed, true);
		assert.equal(controller.getSnapshot().project.id, firstProjectId);
		assert.equal(controller.getSnapshot().projectTabs.length, 1);
	} finally {
		runtime.dispose();
		uiController.dispose();
		await controller.dispose();
	}
});

test('disabled, excluded, unknown, and malformed runtime paths never become executable', () => {
	const accidentalHandlers = {
		io: { exportAudio() { throw new Error('must not run'); } },
		help: { openManual: 'not callable' },
	};
	for (const definition of Object.values(AUDACITY_ACTION_MANIFEST)) {
		if (definition.status === AUDACITY_ACTION_STATUS.IMPLEMENTED) continue;
		assert.equal(resolveAudacityActionHandler(definition.id, accidentalHandlers), null, definition.id);
	}
	assert.equal(resolveAudacityActionHandler('not-an-action', accidentalHandlers), null);
	assert.equal(resolveAudacityActionHandler('online-handbook', accidentalHandlers), null);
	assert.equal(resolveAudacityActionHandler('online-handbook', null), null);
});

test('UI action controller publishes immutable, monotonic command snapshots', () => {
	const uiController = createAudioEditorUiActionController();
	let notifications = 0;
	const unsubscribe = uiController.subscribe(() => { notifications += 1; });
	const initial = uiController.getSnapshot();
	const first = uiController.actions.openSurface('preferences', { section: 'workspace' });
	assert.equal(first.revision, 1);
	assert.equal(uiController.getSnapshot().request.type, 'open-surface');
	assert.equal(uiController.getSnapshot().request.payload.section, 'workspace');
	assert.ok(Object.isFrozen(uiController.getSnapshot().request));
	assert.notStrictEqual(uiController.getSnapshot(), initial);
	assert.equal(uiController.actions.toggleFlag('statusbar'), false);
	assert.equal(uiController.getSnapshot().flags.statusbar, false);
	assert.equal(notifications, 2);
	unsubscribe();
	uiController.dispose();
	assert.equal(notifications, 2);
	assert.throws(() => uiController.actions.issue('after-dispose'), /disposed/);
});
