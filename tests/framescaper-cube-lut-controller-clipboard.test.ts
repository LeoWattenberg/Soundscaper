/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardEditService, type ClipboardEditProject, type ClipboardEditState } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { bindControllerEditClipboardRuntime, resolveControllerProjectRuntime } from '../src/common/editor/controller/document/project-runtime.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import type { CurrentAudioEditorMutationCommandV2 } from '../src/common/editor/commands/clipboard-command-v2.ts';
import { prepareDuplicateSelectionCommand } from '../src/common/editor/controller/edit/internal/duplicate-selection-command.ts';

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const RANGE = { startFrame: 0, endFrame: 24_000, trackIds: ['video-track'] };
function projects() {
	const options = framescaperV20Options();
	const origin = createFramescaperProject(PROFILE, { ...options, clips: (options.clips as readonly Record<string, unknown>[])
		.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 0.5 } },
			{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: REF } },
		] } : clip) });
	const destination = createFramescaperProject(PROFILE, { ...options, id: 'destination', sources: [], clips: [], projectBin: { clips: [] },
		tracks: (options.tracks as readonly Record<string, unknown>[]).map(track => ({ ...track, clipIds: [] })) });
	return { origin, destination };
}
function effectsOf(clip: Readonly<Record<string, unknown>>) {
	assert.ok(Array.isArray(clip.videoEffects));
	return clip.videoEffects as readonly { id: string; type: string; enabled: boolean; params: unknown }[];
}
function pasteOf(command: CurrentAudioEditorMutationCommandV2): Extract<CurrentAudioEditorMutationCommandV2, { type: 'clipboard/paste' }> {
	if (command.type === 'clipboard/paste') return command;
	if (command.type === 'batch') for (const child of command.commands) {
		if (child.type === 'clipboard/paste') return child;
	}
	throw new Error('The prepared command must contain its complete paste.');
}

test('the current controller clipboard copies, switches tabs, closes its origin and pastes full ordered resource leaves through real Frame history', () => {
	const { origin, destination } = projects(), original = structuredClone(origin);
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	const runtime = resolveControllerProjectRuntime(selected);
	assert.equal(typeof runtime.captureEditClipboardDescriptor, 'function');
	let active = origin, ids = 0;
	const session = selected.createSessionController();
	session.openProject(origin); session.openProject(destination);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const state: ClipboardEditState = { selectedTrackId: 'video-track', selectedClipId: 'video-clip', clipboard: null };
	const service = createClipboardEditService({ lifetime, state, copy: { noSilencesFound: 'None', track: 'Track' }, session,
		getProject: () => selected.projectForCommandConsumers(active) as ClipboardEditProject,
		getPositionFrames: () => 48_000, normalizeFrame: Number, snapFrame: Number,
		editingBlocked: () => false, createId: prefix => `${prefix}-${String(++ids)}`,
		sourceBuffers: new Map(), commit: () => { throw new Error('Preparation must not publish.'); }, setStatus: () => {},
		...bindControllerEditClipboardRuntime(runtime, () => active) });
	const descriptor = runtime.captureEditClipboardDescriptor!(origin, RANGE);
	assert.equal(descriptor.schemaVersion, 7);
	const copied = service.setSessionClipboard(descriptor);
	assert.deepEqual(copied, descriptor);
	assert.equal(session.serialize().clipboard!.schemaVersion, 2);
	active = destination; session.switchProject(destination.id);
	session.closeProject(origin.id, { force: true });
	assert.deepEqual([...session.getHistoryStorageKeys()], [REF.storageKey]);
	state.selectedClipId = null;
	const prepared = service.prepareControllerPaste('overlap', 48_000);
	const paste = pasteOf(prepared);
	assert.equal(paste.clipboard.schemaVersion, 7);
	const descriptorClip = paste.clipboard.tracks[0]!.clips[0]!;
	assert.deepEqual((descriptorClip.videoEffects as readonly { params: unknown }[])[1]!.params, { lut: REF });
	const firstHistory = selected.createHistory(destination);
	const pastedHistory = selected.executeCommand(firstHistory, prepared);
	const pasted = pastedHistory.present;
	const clip = pasted.clips.find(item => item.id === paste.clipIds![descriptorClip.key as string])!;
	assert.ok(clip); assert.equal(clip.sequenceStartFrame, 10);
	const effects = effectsOf(clip);
	assert.deepEqual(effects.map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(effects.map(effect => effect.id), paste.videoEffectIds![descriptorClip.key as string]);
	assert.equal(new Set(effects.map(effect => effect.id)).size, 2);
	assert.deepEqual(effects[1]!.params, { lut: REF }); assert.equal(effects[1]!.enabled, false);
	assert.deepEqual(pasted.sources.map(source => source.id), ['video-source']);
	assert.deepEqual(origin, original);
	const undone = selected.undo(pastedHistory); assert.deepEqual(undone.present.clips, destination.clips);
	const redone = selected.redo(undone); assert.deepEqual(redone.present.clips, pasted.clips);
	assert.deepEqual(effectsOf(redone.present.clips[0]!)[1]!.params, { lut: REF });
	assert.equal(session.clearClipboard().releasedSourceIds.includes('video-source'), true);
	assert.deepEqual([...session.getHistoryStorageKeys()], []);
	session.dispose();
});

test('current Duplicate preserves the clipboard, complete disabled resources and independent effect IDs in the destination track', () => {
	const { origin } = projects(), original = structuredClone(origin);
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	let ids = 0;
	const createId = (prefix = 'id') => `${prefix}-${String(++ids)}`;
	const prepared = prepareDuplicateSelectionCommand({
		getProject: () => selected.projectForCommandConsumers(origin) as { tracks: readonly { id: string; name: string; type: string }[] },
		createStableId: createId,
		createClipboardDescriptor: (_project, options) => selected.captureEditClipboardDescriptor(origin, options),
		prepareDuplicateCommand: (descriptor, command) => selected.prepareEditDuplicateCommand(origin, descriptor, command, createId) as CurrentAudioEditorMutationCommandV2,
	}, { ...RANGE, clipIds: ['video-clip'], exactClips: true });
	assert.ok(prepared);
	const result = selected.applyCommand(origin, prepared.command);
	const added = result.clips.find(clip => clip.id === prepared.selectClipId)!;
	assert.ok(added);
	assert.deepEqual(effectsOf(added).map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(effectsOf(added)[1]!.params, { lut: REF }); assert.equal(effectsOf(added)[1]!.enabled, false);
	assert.equal(effectsOf(added).some(effect => ['tone', 'cube'].includes(effect.id)), false);
	assert.deepEqual(origin, original);
});

test('canonical clipboard bindings retain the selected runtime method receivers for capture and paste', () => {
	const { origin } = projects();
	const selected = createEditorProjectRuntimeSelection(PROFILE);
	let captured = 0, prepared = 0;
	const owner = {
		createEditSessionClipboard(project: unknown, descriptor: Parameters<typeof selected.createEditSessionClipboard>[1]) {
			assert.equal(this, owner); captured++;
			return selected.createEditSessionClipboard(project, descriptor);
		},
		prepareEditClipboardPasteCommand(project: unknown, clipboard: unknown, command: CurrentAudioEditorMutationCommandV2,
			createId: (prefix?: string) => string) {
			assert.equal(this, owner); prepared++;
			return selected.prepareEditClipboardPasteCommand(project, clipboard, command, createId);
		},
	};
	const bound = bindControllerEditClipboardRuntime(owner, () => origin);
	const descriptor = selected.captureEditClipboardDescriptor(origin, RANGE);
	const carrier = bound.createEditSessionClipboard!(null, descriptor);
	assert.equal(carrier.descriptor.schemaVersion, 7); assert.equal(captured, 1);
	assert.throws(() => bound.prepareEditClipboardPasteCommand!(null, carrier,
		{ type: 'project/rename', title: 'Refusing non-paste' }, () => 'unused'), /exactly one|paste/iu);
	assert.equal(prepared, 1);
});
