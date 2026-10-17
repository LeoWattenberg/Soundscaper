/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectedLabelClipboardService } from '../src/common/editor/controller/edit/internal/selected-label-clipboard.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { normalizeAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';
import type { SelectedLabelState } from '../src/common/editor/label-clipboard-selection.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

test('native label paste preserves musical anchor authority at a new tempo and sample rate', () => {
	const origin = createSoundscaperProject({ id: 'origin', sampleRate: 48_000, tracks: [createLabelTrack({
		id: 'labels', labels: [{ id: 'musical', title: 'Beat cue', anchor: 'musical',
			startBeat: { num: 2, den: 1 }, endBeat: { num: 3, den: 1 }, color: 'orange',
			opaqueExtensions: { 'example.test': { retained: true } } }],
	})] });
	let history = createSoundscaperProjectHistory(origin);
	const state: SelectedLabelState & { clipboard: AudioEditorClipboard | null; selectedTrackId: string | null;
		selectedClipId: string | null } = { clipboard: null, selectedTrackId: 'labels', selectedClipId: null };
	let nextId = 0;
	const service = createSelectedLabelClipboardService({ state,
		getProject: () => resolveRuntimeProjectProjection(history.present), getPositionFrames: () => 24_000,
		createId: prefix => `${prefix}-${String(++nextId)}`,
		updateSelection: command => { history = { ...history, present: applySoundscaperProjectCommand(history.present, command) }; },
		commit: command => { history = executeSoundscaperProjectCommand(history, command); },
		prepareClipboard: descriptor => {
			const detached = normalizeAudioEditorSessionClipboard(JSON.parse(JSON.stringify({ schemaVersion: 1,
				originProjectId: history.present.id, descriptor, sources: [] })));
			return () => { state.clipboard = detached.descriptor; };
		}, publish() {}, copy: { labelTrackMissing: 'Label track missing' }, setStatus() {},
	});
	service.select('labels', 'musical');
	assert.equal(service.handle('copy'), true);
	const destination = createSoundscaperProject({ id: 'destination', sampleRate: 24_000, tempo: { bpm: 90 },
		tracks: [createLabelTrack({ id: 'destination-labels' })] });
	history = createSoundscaperProjectHistory(destination);
	state.selectedTrackId = 'destination-labels';
	assert.equal(service.handle('paste'), true);
	assert.equal(history.undoStack.length, 1);
	const track = history.present.tracks[0];
	assert.ok(track?.type === 'label');
	const label = track.labels[0];
	assert.ok(label);
	assert.equal(label.anchor, 'musical');
	assert.deepEqual(label.startBeat, { num: 3, den: 2 });
	assert.deepEqual(label.endBeat, { num: 9, den: 4 });
	assert.equal(Object.hasOwn(label, 'startFrame'), false);
	assert.equal(Object.hasOwn(label, 'endFrame'), false);
	assert.equal(label.color, 'orange');
	assert.deepEqual(label.opaqueExtensions, { 'example.test': { retained: true } });
	assert.equal(validateSoundscaperProject(JSON.parse(JSON.stringify(history.present))), true);
	const resolved = resolveRuntimeProjectProjection(history.present).tracks[0];
	assert.ok(resolved?.type === 'label');
	assert.deepEqual(resolved.labels.map(label => [label.startFrame, label.endFrame]), [[24_000, 36_000]]);
	const undone = undoSoundscaperProjectCommand(history).present;
	assert.deepEqual(undone.tracks, destination.tracks);
	assert.deepEqual(undone.tempoMap, destination.tempoMap);
	assert.equal(undone.sampleRate, destination.sampleRate);
});

test('authored musical label additions still undergo native clock admission', () => {
	const project = createSoundscaperProject({ tracks: [createLabelTrack({ id: 'labels' })] });
	const label = { id: 'new', title: 'Authored', anchor: 'musical', startBeat: { num: 0, den: 1 }, endBeat: { num: 1, den: 1 } };
	assert.throws(() => applySoundscaperProjectCommand(project, { type: 'label/add', trackId: 'labels',
		label: { ...label, startBeat: { num: 2, den: 1 } } }), /endBeat|precede|range|ordered/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, { type: 'label/add', trackId: 'labels',
		label: { ...label, endBeat: { num: 1, den: 0 } } }), /denominator|den|positive/iu);
});

test('Framescaper uses the same label-only native commands and retains target lock admission', () => {
	let project = createFramescaperProject(PROFILE, { id: 'frames', tracks: [createLabelTrack({ id: 'labels',
		labels: [{ id: 'point', title: 'Frame cue', startFrame: 1200, endFrame: 1200 }] })] });
	const state: SelectedLabelState & { clipboard: AudioEditorClipboard | null; selectedTrackId: string | null;
		selectedClipId: string | null } = { clipboard: null, selectedTrackId: 'labels', selectedClipId: null };
	let nextId = 0;
	const service = createSelectedLabelClipboardService({ state,
		getProject: () => resolveRuntimeProjectProjection(project), getPositionFrames: () => 24_000,
		createId: prefix => `${prefix}-${String(++nextId)}`,
		updateSelection: command => { project = applyFramescaperProjectCommand(PROFILE, project, command); },
		commit: command => { project = applyFramescaperProjectCommand(PROFILE, project, command); },
		prepareClipboard: descriptor => () => { state.clipboard = descriptor; },
		publish() {}, copy: { labelTrackMissing: 'Label track missing' }, setStatus() {},
	});
	service.select('labels', 'point');
	assert.equal(service.handle('copy'), true);
	assert.equal(service.handle('paste'), true);
	const track = project.tracks[0];
	assert.ok(track?.type === 'label');
	assert.deepEqual(track.labels.map(label => [label.title, label.startFrame, label.endFrame]),
		[['Frame cue', 1200, 1200], ['Frame cue', 24_000, 24_000]]);
	assert.equal(validateFramescaperProject(PROFILE, JSON.parse(JSON.stringify(project))), true);
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'track/update', trackId: 'labels', changes: { locked: true } });
	const before = project;
	assert.throws(() => service.handle('paste'), /locked/iu);
	assert.equal(project, before);
});
