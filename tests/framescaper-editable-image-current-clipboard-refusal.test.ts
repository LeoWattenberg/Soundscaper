/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { prepareDuplicateSelectionCommand } from '../src/common/editor/controller/edit/internal/duplicate-selection-command.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { preparePasteCommandV7 } from '../src/common/editor/commands/clipboard-runtime-v7.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
type ControllerOptions = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
import { editableImageFixture, openEditableImageFixture, PROFILE } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('current Copy and Duplicate explicitly refuse editable image custody before body I/O or mutation', () => {
	const f = editableImageFixture({ cube: false }), project = f.project(), before = structuredClone(project), selected = createEditorProjectRuntimeSelection(PROFILE);
	const range = { startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: [f.clip.id], exactClips: true };
	assert.throws(() => selected.captureEditClipboardDescriptor(project, range), /editable image.*clipboard/iu);
	assert.throws(() => prepareDuplicateSelectionCommand({ getProject: () => selected.projectForCommandConsumers(project) as never,
		createStableId: () => 'unused', createClipboardDescriptor: (_project, options) => selected.captureEditClipboardDescriptor(project, options),
		prepareDuplicateCommand: (descriptor, command) => selected.prepareEditDuplicateCommand(project, descriptor, command, () => 'unused') as never }, range), /editable image.*clipboard/iu);
	assert.deepEqual(project, before); assert.deepEqual(f.calls, []);
});

test('incoming rich V2 Paste explicitly refuses before allocations, body I/O or destination mutation', () => {
	const f = editableImageFixture({ cube: false }), selected = createEditorProjectRuntimeSelection(PROFILE);
	const current = f.project(), packProject = selected.applyCommand(current, { type: 'image-source/set', sourceId: f.source.id, expectedSource: f.source, source: packSource(f.source) });
	const descriptor = selected.captureEditClipboardDescriptor(packProject, { startFrame: 0, endFrame: 48_000, trackIds: ['video-track'] });
	const clipboard = selected.createEditSessionClipboard(packProject, descriptor), incoming = { ...clipboard, sources: [f.source] };
	const before = structuredClone(current); let allocations = 0, getters = 0;
	assert.throws(() => selected.prepareEditClipboardPaste(current, incoming, { type: 'clipboard/paste', clipboard: descriptor, atFrame: 0, mode: 'overlap' }, () => { allocations++; return 'unexpected'; }), /editable image.*clipboard/iu);
	assert.throws(() => selected.prepareEditClipboardPaste(current, { ...incoming, sources: [Object.defineProperty({ ...f.source }, 'develop', { enumerable: true, get() { getters++; return f.source.develop; } })] },
		{ type: 'clipboard/paste', clipboard: descriptor, atFrame: 0, mode: 'overlap' }, () => { allocations++; return 'unexpected'; }));
	assert.equal(getters, 0); assert.equal(allocations, 0); assert.deepEqual(current, before); assert.deepEqual(f.calls, []);
});

test('current rich V1 Copy/Paste and Duplicate command owners retain an already-owned canonical pack', () => {
	const f = editableImageFixture(), selected = createEditorProjectRuntimeSelection(PROFILE);
	const project = selected.applyCommand(f.project(), { type: 'image-source/set', sourceId: f.source.id, expectedSource: f.source, source: packSource(f.source) });
	const before = structuredClone(project), range = { startFrame: 0, endFrame: 48_000, trackIds: ['video-track'], clipIds: [f.clip.id], exactClips: true };
	let ids = 0; const createId = (prefix = 'copy') => `${prefix}-${++ids}`;
	const descriptor = selected.captureEditClipboardDescriptor(project, range), copied = selected.createEditSessionClipboard(project, descriptor);
	const base = preparePasteCommandV7(descriptor as Parameters<typeof preparePasteCommandV7>[0], { atFrame: 48_000, trackMap: { 'video-track': 'video-track' }, mode: 'overlap' }, createId);
	const command = selected.prepareEditClipboardPasteCommand(project, copied, base, createId);
	const pasted = applyFramescaperProjectCommand(PROFILE, project, command);
	assert.equal(pasted.clips.length, 2); assert.deepEqual(pasted.sources, project.sources);
	const duplicated = prepareDuplicateSelectionCommand({ getProject: () => selected.projectForCommandConsumers(pasted) as never,
		createStableId: createId, createClipboardDescriptor: (_project, options) => selected.captureEditClipboardDescriptor(pasted, options),
		prepareDuplicateCommand: (value, request) => selected.prepareEditDuplicateCommand(pasted, value, request, createId) as never }, range);
	assert.ok(duplicated); const actual = applyFramescaperProjectCommand(PROFILE, pasted, duplicated.command);
	assert.equal(actual.clips.length, 3); assert.deepEqual(actual.sources, project.sources); assert.deepEqual(project, before); assert.deepEqual(f.calls, []);
});

test('real selected controller Copy → New → Paste refuses editable transfer', async t => {
	const f = editableImageFixture({ sourceId: `controller-image-${crypto.randomUUID()}` }), selected = createEditorProjectRuntimeSelection(PROFILE), session = selected.createSessionController();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await store.close(); });
	const project = await openEditableImageFixture(f, store);
	await store.saveSetting('framescaper:last-project-id', project.id);
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		projectRuntime: selected, sessionController: session, store, engine: createMemoryEngine() as unknown as ControllerOptions['engine'],
		engineFactory: createMemoryRenderEngine as unknown as ControllerOptions['engineFactory'], ffmpeg: createMemoryFfmpeg() as unknown as ControllerOptions['ffmpeg'] });
	try {
		await controller.ready; controller.actions.timeline.selectClip(f.clip.id); const before = selected.cloneProject(controller.project);
		controller.actions.edit.copy();
		const copied = session.serialize().clipboard;
		assert.equal(copied, null); assert.match(controller.getSnapshot().status.message, /editable image.*clipboard/iu);
		controller.actions.edit.duplicate(); assert.match(controller.getSnapshot().status.message, /editable image.*clipboard/iu);
		assert.deepEqual(selected.cloneProject(controller.project), before);
		await controller.actions.project.create({ title: 'Image destination', sampleRate: 48_000 });
		assert.deepEqual(controller.project?.clips, []); assert.deepEqual(session.serialize().clipboard, copied);
		await controller.actions.edit.paste();
		const pasted = selected.cloneProject(controller.project);
		assert.deepEqual(pasted.clips, []); assert.deepEqual(pasted.sources, []);
	} finally { await controller.dispose(); }
});

function packSource(source: ReturnType<typeof editableImageFixture>['source']) {
	const { develop: _develop, developed: _developed, provenance: _provenance, ...pack } = source;
	return { ...pack, schemaVersion: 1 as const };
}
