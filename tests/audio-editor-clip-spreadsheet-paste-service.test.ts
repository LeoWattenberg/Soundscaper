/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import { getClipSpreadsheetRows } from '../src/common/editor/clip-spreadsheet.ts';
import { peakCacheKey } from '../src/common/editor/source-analysis-cache.ts';
import { createClipSpreadsheetPasteService } from '../src/common/editor/controller/import/internal/clip-spreadsheet-paste-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';

function fixture() {
	const initial = applyEditorCommand(createCurrentAudioEditorProject({ id: 'sheet', sampleRate: 48_000 }), { type: 'batch', commands: [
		{ type: 'source/add', source: { id: 'existing', storageKey: 'existing', name: 'Existing.wav', sampleRate: 48_000, originalSampleRate: 48_000, frameCount: 480_000, channelCount: 1 } },
		{ type: 'track/add', track: { id: 'track', name: 'Voice' } },
		{ type: 'clip/add', trackId: 'track', clip: { id: 'original', sourceId: 'existing', title: 'Original', durationFrames: 48_000, sourceDurationFrames: 48_000 } },
	] });
	let history = createEditorHistory(initial);
	const initialDocument = history.present;
	let blocked = false;
	let importing = false;
	let sequence = 0;
	let importHook: (() => Promise<void> | void) | null = null;
	let importedHook: (() => void) | null = null;
	let cleanupHook: (() => void) | null = null;
	let failCommit = false;
	let invalidSource = false;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(initial.id);
	const sourceBuffers = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const missingSourceIds = new Set<string>();
	const protectedSourceIds = new Set<string>();
	const deleted: string[] = [];
	const deletedAnalyses: string[] = [];
	const retired: string[] = [];
	const imports: string[] = [];
	const taskProgress = createEditorTaskProgressCoordinator();
	const commit = (command: AudioEditorCommand): unknown => {
		if (failCommit) throw new Error('Commit refused');
		history = executeEditorCommand(history, command);
		return history.present;
	};
	const paste = createClipSpreadsheetPasteService({
		lifetime, taskProgress, importingLabel: 'Importing', protectedSourceIds, sourceBuffers, sourcePeaks, missingSourceIds,
		getProject: () => history.present,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		editingBlocked: () => blocked || importing,
		setImporting: value => { importing = value; },
		createId: prefix => `${prefix}-${++sequence}`,
		commit, publish: () => {},
		retireSourceChunkProvider: id => { retired.push(id); cleanupHook?.(); },
		store: {
			deleteSource: id => { deleted.push(id); return Promise.resolve(); },
			deleteAnalysis: key => { deletedAnalyses.push(key); return Promise.resolve(); },
		},
		prepareAudioSource: async (file, { signal, onSourcePrepared }) => {
			imports.push(file.name);
			await importHook?.();
			signal.throwIfAborted();
			const sourceId = `imported-${imports.length}`;
			sourceBuffers.set(sourceId, {}); sourcePeaks.set(sourceId, {});
			onSourcePrepared(sourceId);
			importedHook?.();
			return { id: sourceId, storageKey: sourceId, name: file.name, sampleRate: 44_100, originalSampleRate: 44_100, frameCount: 441_000, channelCount: invalidSource ? 0 : 2 };
		},
	});
	return {
		paste, initial: initialDocument, imports, deleted, deletedAnalyses, retired, sourceBuffers, sourcePeaks, missingSourceIds, protectedSourceIds, taskProgress,
		get history() { return history; }, get importing() { return importing; },
		setBlocked: (value: boolean) => { blocked = value; },
		setImportHook: (hook: () => Promise<void> | void) => { importHook = hook; },
		setImportedHook: (hook: () => void) => { importedHook = hook; },
		setCleanupHook: (hook: () => void) => { cleanupHook = hook; },
		startAnotherImport: () => { importing = true; },
		failFinalCommit: () => { failCommit = true; },
		invalidateImportedMetadata: () => { invalidSource = true; },
		editProject: () => commit({ type: 'clip/update', clipId: 'original', changes: { title: 'Later edit' } }),
		switchProject: () => { history = createEditorHistory(createCurrentAudioEditorProject({ id: 'other' })); generation.activate('other'); importing = false; },
	};
}

test('loaded-source rows and existing edits paste as one undo entry without importing', async () => {
	const f = fixture();
	await f.paste('sheet', [{ clipId: 'original', column: 'name', value: 'Edited' }], [{ source: 'Existing.wav', track: 'Voice', position: '3', duration: '2' }]);
	assert.deepEqual(f.imports, []);
	assert.equal(f.history.undoStack.length, 1);
	assert.equal(getClipSpreadsheetRows(f.history.present).length, 2);
	assert.deepEqual(getClipSpreadsheetRows(undoEditorCommand(f.history).present), getClipSpreadsheetRows(f.initial));
});

test('source edits import replacement files and join other pasted edits in one undo entry', async () => {
	const f = fixture();
	const file = new File(['audio'], 'Replacement.wav', { type: 'audio/wav' });
	await f.paste('sheet', [
		{ clipId: 'original', column: 'source', value: '/disk/Replacement.wav' },
		{ clipId: 'original', column: 'name', value: 'Replacement' },
	], [], [{ reference: '/disk/Replacement.wav', file }]);
	assert.deepEqual(f.imports, ['Replacement.wav']);
	assert.equal(f.history.undoStack.length, 1);
	assert.equal(f.history.present.clips[0].sourceId, 'imported-1');
	assert.equal(f.history.present.clips[0].sourceDurationFrames, 44_100);
	assert.equal(f.history.present.clips[0].durationFrames, 48_000);
	assert.equal(getClipSpreadsheetRows(f.history.present)[0]?.cells.name, 'Replacement');
	assert.deepEqual(f.history.present.sources.map((source: { id: string }) => source.id), ['existing', 'imported-1']);
	assert.deepEqual(getClipSpreadsheetRows(undoEditorCommand(f.history).present), getClipSpreadsheetRows(f.initial));
	assert.equal(redoEditorCommand(undoEditorCommand(f.history)).present.clips[0].sourceId, 'imported-1');
});

test('ordinary audio-only WebM passes spreadsheet file admission and retains one undo entry', async () => {
	const bytes = Uint8Array.from(Buffer.from(readFileSync(new URL('./fixtures/chromium-audio-only.webm.base64', import.meta.url), 'utf8'), 'base64'));
	for (const type of ['audio/webm', 'video/webm']) {
		const f = fixture();
		const file = new File([bytes], 'Voice memo.webm', { type });
		await f.paste('sheet', [{ clipId: 'original', column: 'source', value: file.name }], [], [{ reference: file.name, file }]);
		assert.deepEqual(f.imports, [file.name]);
		assert.equal(f.history.present.clips[0].sourceId, 'imported-1');
		assert.equal(f.history.undoStack.length, 1);
		assert.deepEqual(getClipSpreadsheetRows(undoEditorCommand(f.history).present), getClipSpreadsheetRows(f.initial));
	}
});

test('replacement edits and inserted rows sharing a disk reference import and add their source once', async () => {
	const f = fixture();
	const file = new File(['audio'], 'Shared.wav', { type: 'audio/wav' });
	await f.paste('sheet', [{ clipId: 'original', column: 'source', value: '/disk/Shared.wav' }],
		[{ source: '/disk/Shared.wav', track: 'track', position: '2', duration: '1' }],
		[{ reference: '/disk/Shared.wav', file }]);
	assert.deepEqual(f.imports, ['Shared.wav']);
	assert.equal(f.history.present.sources.length, 2);
	assert.deepEqual(f.history.present.clips.map((clip: { sourceId: string }) => clip.sourceId), ['imported-1', 'imported-1']);
	assert.equal(f.history.undoStack.length, 1);
});

test('invalid replacement edits fail before importing and invalid final bounds discard staged media', async () => {
	const f = fixture();
	const file = new File(['audio'], 'Replacement.wav', { type: 'audio/wav' });
	const files = [{ reference: '/disk/Replacement.wav', file }];
	await assert.rejects(f.paste('sheet', [
		{ clipId: 'original', column: 'source', value: '/disk/Replacement.wav' },
		{ clipId: 'original', column: 'speed', value: '0' },
	], [], files), /speed/i);
	assert.deepEqual(f.imports, []);
	await assert.rejects(f.paste('sheet', [
		{ clipId: 'original', column: 'source', value: '/disk/Replacement.wav' },
		{ clipId: 'original', column: 'duration', value: '11' },
	], [], files), /exceed/i);
	assert.deepEqual(f.imports, ['Replacement.wav']);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.deepEqual(f.history.present, f.initial);
	assert.equal(f.history.undoStack.length, 0);
});

test('missing sources prepare once without changing the project and remain available for undo and redo', async () => {
	const f = fixture();
	f.setImportedHook(() => { assert.equal(f.history.present, f.initial); assert.equal(f.history.undoStack.length, 0); });
	const file = new File(['audio'], 'Imported.wav', { type: 'audio/wav' });
	await f.paste('sheet', [], [{ source: '/chosen/Imported.wav', position: '1', duration: '2' }, { source: '/chosen/Imported.wav', position: '4', duration: '1' }], [{ reference: '/chosen/Imported.wav', file }]);
	assert.deepEqual(f.imports, ['Imported.wav']);
	assert.equal(f.history.undoStack.length, 1);
	assert.equal(getClipSpreadsheetRows(f.history.present).length, 3);
	assert.equal(f.history.present.projectBin.clips.length, 0);
	assert.ok(f.sourceBuffers.has('imported-1'));
	assert.deepEqual([...f.protectedSourceIds], []);
	assert.deepEqual(f.deleted, []);
	const undone = undoEditorCommand(f.history).present;
	assert.deepEqual(getClipSpreadsheetRows(undone), getClipSpreadsheetRows(f.initial));
	assert.deepEqual(undone.sources, f.initial.sources);
	assert.deepEqual(getClipSpreadsheetRows(redoEditorCommand(undoEditorCommand(f.history)).present), getClipSpreadsheetRows(f.history.present));
});

test('invalid rows, blocked ownership and absent files fail before any import', async () => {
	const f = fixture();
	await assert.rejects(f.paste('wrong', [], []), /project/i);
	f.setBlocked(true);
	await assert.rejects(f.paste('sheet', [], [{ source: 'Existing.wav' }]), /unavailable|blocked/i);
	f.setBlocked(false);
	await assert.rejects(f.paste('sheet', [], [{ source: 'Missing.wav' }]), /Missing.wav/);
	await assert.rejects(f.paste('sheet', [], [{ source: 'Missing.wav', speed: '0' }], [{ reference: 'Missing.wav', file: new File(['audio'], 'Missing.wav') }]), /speed/i);
	assert.deepEqual(f.imports, []);
	assert.equal(f.history.undoStack.length, 0);
});

test('source-bound validation failure leaves history unchanged and removes prepared media', async () => {
	const f = fixture();
	await assert.rejects(f.paste('sheet', [], [{ source: 'Short.wav', offset: '50', duration: '1' }], [{ reference: 'Short.wav', file: new File(['audio'], 'Short.wav') }]), /source|offset|bound|duration/i);
	assert.equal(f.history.present, f.initial);
	assert.equal(f.history.undoStack.length, 0);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.deepEqual(f.deletedAnalyses, [peakCacheKey('imported-1')]);
	assert.deepEqual(f.retired, ['imported-1']);
	assert.equal(f.sourceBuffers.size, 0);
	assert.equal(f.sourcePeaks.size, 0);
	assert.equal(f.importing, false);
	assert.equal(f.protectedSourceIds.size, 0);
});

test('cancellation and project switches cannot publish a late paste', async () => {
	const cancelled = fixture();
	cancelled.setImportHook(() => { cancelled.taskProgress.cancelActive(); });
	await assert.rejects(cancelled.paste('sheet', [], [{ source: 'Missing.wav' }], [{ reference: 'Missing.wav', file: new File(['audio'], 'Missing.wav') }]), /abort|cancel|superseded/i);
	assert.equal(cancelled.history.present, cancelled.initial);
	assert.equal(cancelled.importing, false);
	const switched = fixture();
	switched.setImportHook(() => { switched.switchProject(); throw new Error('The project changed'); });
	await assert.rejects(switched.paste('sheet', [], [{ source: 'Missing.wav' }], [{ reference: 'Missing.wav', file: new File(['audio'], 'Missing.wav') }]), /project/i);
	assert.equal(switched.history.present.id, 'other');
	assert.equal(switched.history.undoStack.length, 0);
});

test('a second import failure removes the first prepared source without changing history', async () => {
	const f = fixture();
	f.setImportHook(() => {
		assert.equal(f.history.present, f.initial);
		if (f.imports.length === 2) throw new Error('Second source decode failed');
	});
	await assert.rejects(f.paste('sheet', [], [{ source: 'First.wav' }, { source: 'Second.wav' }], [
		{ reference: 'First.wav', file: new File(['audio'], 'First.wav') },
		{ reference: 'Second.wav', file: new File(['audio'], 'Second.wav') },
	]), /Second source decode failed/);
	assert.equal(f.history.present, f.initial);
	assert.equal(f.history.undoStack.length, 0);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.deepEqual(f.deletedAnalyses, [peakCacheKey('imported-1')]);
	assert.deepEqual(f.retired, ['imported-1']);
	assert.equal(f.sourceBuffers.size, 0);
	assert.equal(f.sourcePeaks.size, 0);
	assert.equal(f.protectedSourceIds.size, 0);
	assert.equal(f.importing, false);
});

test('a project switch after one staged source cleans that source without restoring the old document', async () => {
	const f = fixture();
	f.setImportHook(() => { if (f.imports.length === 2) { f.switchProject(); throw new Error('The project changed'); } });
	await assert.rejects(f.paste('sheet', [], [{ source: 'First.wav' }, { source: 'Second.wav' }], [
		{ reference: 'First.wav', file: new File(['audio'], 'First.wav') },
		{ reference: 'Second.wav', file: new File(['audio'], 'Second.wav') },
	]), /project changed/);
	assert.equal(f.history.present.id, 'other');
	assert.equal(f.history.undoStack.length, 0);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.equal(f.sourceBuffers.size, 0);
	assert.equal(f.protectedSourceIds.size, 0);
});

test('missing cached media and video or project files are refused before import', async () => {
	const f = fixture();
	f.missingSourceIds.add('existing');
	await assert.rejects(f.paste('sheet', [], [{ source: 'Existing.wav' }]), /Relink.*Existing.wav/);
	for (const name of ['Video.mp4', 'Project.aup', 'Project.sscape', 'Project.sesx']) {
		await assert.rejects(f.paste('sheet', [], [{ source: name }], [{ reference: name, file: new File(['invalid'], name) }]), /audio file/);
	}
	assert.deepEqual(f.imports, []);
});

test('sources are cleaned when cancellation or a switch happens after preparation but before it returns', async () => {
	for (const switched of [false, true]) {
		const f = fixture();
		f.setImportedHook(() => {
			if (switched) f.switchProject();
			else f.taskProgress.cancelActive();
		});
		await assert.rejects(f.paste('sheet', [], [{ source: 'Late.wav' }], [{ reference: 'Late.wav', file: new File(['audio'], 'Late.wav') }]));
		assert.equal(f.history.present.id, switched ? 'other' : 'sheet');
		assert.equal(f.history.undoStack.length, 0);
		assert.deepEqual(f.deleted, ['imported-1']);
		assert.deepEqual(f.retired, ['imported-1']);
		assert.equal(f.sourceBuffers.size, 0);
		assert.equal(f.protectedSourceIds.size, 0);
	}
});

test('invalid imported metadata or final commit failure cleans prepared sources and leaves history unchanged', async () => {
	for (const failure of ['metadata', 'commit']) {
		const f = fixture();
		f.setImportedHook(() => {
			if (failure === 'metadata') f.invalidateImportedMetadata();
			else f.failFinalCommit();
		});
		await assert.rejects(f.paste('sheet', [], [{ source: 'Late.wav' }], [{ reference: 'Late.wav', file: new File(['audio'], 'Late.wav') }]));
		assert.equal(f.history.present, f.initial);
		assert.equal(f.history.undoStack.length, 0);
		assert.deepEqual(f.deleted, ['imported-1']);
		assert.equal(f.sourceBuffers.size, 0);
		assert.equal(f.protectedSourceIds.size, 0);
		assert.equal(f.importing, false);
	}
});

test('an unrelated edit during source preparation is preserved and refuses the stale paste', async () => {
	const f = fixture();
	f.setImportedHook(() => { f.editProject(); });
	await assert.rejects(f.paste('sheet', [], [{ source: 'Late.wav' }], [{ reference: 'Late.wav', file: new File(['audio'], 'Late.wav') }]), /project changed/i);
	assert.equal(getClipSpreadsheetRows(f.history.present)[0]?.cells.name, 'Later edit');
	assert.equal(f.history.undoStack.length, 1);
	assert.equal(f.history.present.clips.length, 1);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.equal(f.protectedSourceIds.size, 0);
});

test('a write lock acquired during preparation blocks the final commit and discards prepared audio', async () => {
	const f = fixture();
	f.setImportedHook(() => { f.setBlocked(true); });
	await assert.rejects(f.paste('sheet', [], [{ source: 'Late.wav' }], [{ reference: 'Late.wav', file: new File(['audio'], 'Late.wav') }]), /unavailable/i);
	assert.equal(f.history.present, f.initial);
	assert.equal(f.history.undoStack.length, 0);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.equal(f.importing, false);
	assert.equal(f.protectedSourceIds.size, 0);
});

test('cleanup after a final commit failure preserves a newer import flag', async () => {
	const f = fixture();
	f.setImportedHook(() => { f.failFinalCommit(); });
	f.setCleanupHook(() => { f.startAnotherImport(); });
	await assert.rejects(f.paste('sheet', [], [{ source: 'Late.wav' }], [{ reference: 'Late.wav', file: new File(['audio'], 'Late.wav') }]), /Commit refused/);
	assert.equal(f.history.present, f.initial);
	assert.equal(f.importing, true);
	assert.deepEqual(f.deleted, ['imported-1']);
	assert.equal(f.protectedSourceIds.size, 0);
});
