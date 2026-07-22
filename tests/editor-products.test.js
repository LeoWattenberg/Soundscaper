import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PRODUCT_PROFILES,
	otherProductId,
	productLocalePath,
	productProfile,
} from '../src/common/products.js';
import { createEditorController } from '../src/common/editor/index.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('product profiles are immutable and resolve distinct routes and capability sets', () => {
	assert.equal(productLocalePath('soundscaper', 'en'), '/en/');
	assert.equal(productLocalePath('framescaper', 'de'), '/framescaper/de/');
	assert.equal(productLocalePath('framescaper', 'en', { embedded: true }), '/framescaper/embed/en/');
	assert.equal(otherProductId('soundscaper'), 'framescaper');
	assert.equal(otherProductId('framescaper'), 'soundscaper');
	assert.equal(PRODUCT_PROFILES.soundscaper.capabilities.audioRecording, true);
	assert.equal(PRODUCT_PROFILES.soundscaper.capabilities.videoEffects, false);
	assert.equal(PRODUCT_PROFILES.framescaper.capabilities.audioRecording, false);
	assert.equal(PRODUCT_PROFILES.framescaper.capabilities.videoEffects, true);
	assert.deepEqual(PRODUCT_PROFILES.framescaper.panels.includes('analysis'), false);
	assert.deepEqual(PRODUCT_PROFILES.soundscaper.exportChoices.includes('aup4-audio-only'), true);
	assert.deepEqual(PRODUCT_PROFILES.framescaper.exportChoices.includes('aup4-audio-only'), false);
	assert.equal(Object.isFrozen(productProfile('framescaper').capabilities), true);
	assert.equal(Object.isFrozen(productProfile('framescaper').shortcuts.disabledCommandIds), true);
});

test('controllers enforce product authoring boundaries while retaining the shared project model', async () => {
	const soundStore = createProjectStore({ indexedDB: null, databaseName: `products-sound-${Date.now()}` });
	const frameStore = createProjectStore({ indexedDB: null, databaseName: `products-frame-${Date.now()}` });
	const soundscaper = createEditorController(null, {
		productId: 'soundscaper',
		store: soundStore,
	});
	const framescaper = createEditorController(null, {
		productId: 'framescaper',
		store: frameStore,
	});
	await Promise.all([soundscaper.ready, framescaper.ready]);

	assert.equal(soundscaper.getSnapshot().productId, 'soundscaper');
	assert.equal(soundscaper.getSnapshot().preferences.workspace.activeId, 'modern');
	for (const path of [
		'video.effects.add', 'video.effects.update', 'video.effects.bypass', 'video.effects.toggle',
		'video.effects.reorder', 'video.effects.remove', 'video.effects.beginGesture',
		'video.effects.preview', 'video.effects.commit', 'video.effects.cancel',
	]) assertRestricted(soundscaper, path, 'videoEffects');
	assert.throws(() => soundscaper.actions.edit.commit({ type: 'video-effect/remove' }), /does not support videoEffects/u);
	assert.throws(() => soundscaper.actions.edit.commit({
		type: 'clip/update', clipId: 'missing', changes: { videoEffects: [] },
	}), /does not support videoEffects/u);

	assert.equal(framescaper.getSnapshot().productId, 'framescaper');
	assert.equal(framescaper.getSnapshot().preferences.workspace.activeId, 'video-editor');
	for (const path of [
		'recording.start', 'recording.startNewTrack', 'recording.schedule', 'recording.toggleLeadIn',
		'recording.setMonitoring', 'recording.setMetering', 'recording.setLevel', 'recording.setLatencyOffset',
		'recording.requestInputAccess', 'recording.refreshInputs', 'recording.setTrackInput',
		'recording.clearTrackInput', 'recording.setSourceOffset', 'recording.setRetainInputs',
	]) assertRestricted(framescaper, path, 'audioRecording');
	for (const path of ['edit.silenceSelection', 'generators.generate']) assertRestricted(framescaper, path, 'audioGenerators');
	for (const path of ['sampleEdit.setMode', 'sampleEdit.pencil', 'sampleEdit.smooth']) assertRestricted(framescaper, path, 'audioSampleEditing');
	for (const path of [
		'spectral.boxSelect', 'spectral.delete', 'spectral.amplify', 'track.setSpectrogramView', 'track.setMultiView',
	]) assertRestricted(framescaper, path, 'audioSpectralEditing');
	for (const path of [
		'nyquist.evaluate', 'nyquist.preview', 'clip.setTimePitch', 'clip.stretch', 'clip.toggleStretchToTempo',
		'clip.resetPitchSpeed', 'clip.renderPitchSpeed', 'clip.reverse', 'clip.normalizePeak', 'clip.normalizeLoudness',
		'track.makeStereo', 'track.swapChannels', 'track.splitStereoLR', 'track.splitStereoCenter',
		'track.setRate', 'track.setSampleFormat', 'track.mixAndRender', 'track.resample',
		'effects.add', 'effects.update', 'effects.beginRackEffectGesture', 'effects.previewRackEffect',
		'effects.commitRackEffectGesture', 'effects.cancelRackEffectGesture', 'effects.beginParametricEqGesture',
		'effects.previewParametricEq', 'effects.commitParametricEqGesture', 'effects.cancelParametricEqGesture',
		'effects.remove', 'effects.reorder', 'effects.copyStack', 'effects.pasteStack', 'effects.setSelectionType',
		'effects.setSelectionParams', 'effects.setControlTrack', 'effects.captureNoiseProfile',
		'effects.captureRackNoiseProfile', 'effects.applySelection', 'effects.previewSelection', 'effects.repeatLast',
		'effects.presets.apply', 'effects.presets.save', 'effects.presets.saveAs', 'effects.presets.delete',
		'effects.presets.import', 'effects.presets.export',
	]) assertRestricted(framescaper, path, 'audioEffects');
	assertRestricted(framescaper, 'macros.run', 'audioMacros');
	for (const path of ['analysis.run', 'analysis.plotSpectrum', 'analysis.findClipping', 'analysis.contrast']) {
		assertRestricted(framescaper, path, 'audioAnalysis');
	}
	assert.throws(() => framescaper.actions.edit.commit({ type: 'effect/remove' }), /does not support audioEffects/u);
	assert.throws(() => framescaper.actions.edit.commit({
		type: 'track/update', trackId: 'missing', changes: { effects: [] },
	}), /does not support audioEffects/u);

	const mixedDocument = structuredClone(framescaper.getSnapshot().project);
	mixedDocument.id = 'framescaper-preservation';
	mixedDocument.opaqueExtensions = { futureProducer: { untouched: ['value', 7] } };
	mixedDocument.tracks[0].effects = [createEffect('delay', { id: 'preserved-audio-effect' })];
	const preserved = JSON.stringify({
		effects: mixedDocument.tracks[0].effects,
		opaqueExtensions: mixedDocument.opaqueExtensions,
		projectBin: mixedDocument.projectBin,
	});
	await framescaper.actions.project.open(mixedDocument);
	framescaper.actions.track.update(mixedDocument.tracks[0].id, { gain: 0.75, pan: -0.2 });
	await framescaper.actions.project.flush();
	const saved = await frameStore.loadProject(mixedDocument.id);
	assert.equal(JSON.stringify({
		effects: saved.tracks[0].effects,
		opaqueExtensions: saved.opaqueExtensions,
		projectBin: saved.projectBin,
	}), preserved);

	await Promise.all([soundscaper.dispose(), framescaper.dispose()]);
});

function assertRestricted(controller, path, capability) {
	const action = path.split('.').reduce((value, key) => value[key], controller.actions);
	assert.equal(typeof action, 'function', `${path} must resolve to a controller action`);
	assert.throws(() => action(), new RegExp(`does not support ${capability}`, 'u'), path);
}
