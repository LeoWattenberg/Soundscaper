/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperCompositionCommands } from '../src/motionscaper/editor-composition-commands.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';
const settings = { name: 'Child', width: 40, height: 30, frameRate: { num: 24, den: 1 }, durationFrames: 12 };
const project = createMotionscaperProject({ id: 'p', title: 'Main', compositionId: 'main', width: 64, height: 64, durationFrames: 60 });
test('additional compositions retain identity and nest across exact frame rates without changing primary or project title', () => {
	const history = createMotionscaperHistory(project);
	const added = history.commit(createMotionscaperCompositionCommands({ project, edit: { type: 'add', id: 'child', settings } }));
	assert.equal(added.primaryCompositionId, 'main'); assert.equal(added.title, 'Main'); assert.equal(added.compositions[1]!.name, 'Child');
	const renamed = history.commit(createMotionscaperCompositionCommands({ project: added, edit: { type: 'settings', compositionId: 'child', settings: { ...settings, name: 'Renamed' } } }));
	assert.equal(renamed.compositions[1]!.id, 'child'); assert.equal(renamed.title, 'Main');
	const nested = history.commit(createMotionscaperCompositionCommands({ project: renamed, edit: { type: 'nest', compositionId: 'main', sourceCompositionId: 'child', layerId: 'nested' } }));
	const layer = nested.compositions[0]!.layers[0]!; assert.equal(layer.kind, 'precomp'); assert.deepEqual(layer.outFrame, { num: 15, den: 1 });
	assert.throws(() => createMotionscaperCompositionCommands({ project: nested, edit: { type: 'nest', compositionId: 'child', sourceCompositionId: 'main', layerId: 'cycle' } }), /cycle/iu);
	assert.throws(() => createMotionscaperCompositionCommands({ project: nested, edit: { type: 'remove', compositionId: 'child' } }), /missing/iu);
	history.undo(); assert.equal(history.snapshot().project.compositions[0]!.layers.length, 0);
	const primary = applyMotionscaperCommands(renamed, createMotionscaperCompositionCommands({ project: renamed, edit: { type: 'primary', compositionId: 'child' } })); assert.equal(primary.primaryCompositionId, 'child');
});
test('composition settings preserve authored work area and refuse invalid shortening before history', () => {
	const authored = { ...project, compositions: [{ ...project.compositions[0]!, workArea: { startFrame: { num: 10, den: 1 }, endFrame: { num: 50, den: 1 } } }] };
	assert.throws(() => createMotionscaperCompositionCommands({ project: authored, edit: { type: 'settings', compositionId: 'main', settings: { ...settings, durationFrames: 20 } } }), /work area|duration/iu);
	const edited = applyMotionscaperCommands(authored, createMotionscaperCompositionCommands({ project: authored, edit: { type: 'settings', compositionId: 'main', settings: { ...settings, durationFrames: 60 } } }));
	assert.deepEqual(edited.compositions[0]!.workArea, authored.compositions[0]!.workArea);
});
test('layer and retained media insertion honor an explicit composition and keep the primary untouched', async () => {
	const indexedDB = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: indexedDB as unknown as IDBFactory }); const session = new MotionscaperDocumentSession(store);
	try {
		await session.create({ ...settings, title: 'Main' }); await session.edit(createMotionscaperCompositionCommands({ project: session.getSnapshot().project, edit: { type: 'add', id: 'child', settings } }));
		const draft = { kind: 'solid' as const, name: 'Child Solid', x: 0, y: 0, width: 40, height: 30, color: '#ff0000', opacity: 100, text: '', fontSize: 12 };
		await session.addLayer(draft, 'child'); await session.importMedia(new Blob([motionWavFixture()]), 'Tone.wav', 'child');
		const after = session.getSnapshot().project!; assert.equal(after.compositions[0]!.layers.length, 0); assert.equal(after.compositions[0]!.audio.length, 0);
		assert.equal(after.compositions[1]!.layers[0]!.name, 'Child Solid'); assert.equal(after.compositions[1]!.audio.length, 1); assert.deepEqual(after.compositions[1]!.audio[0]!.outFrame, { num: 12, den: 5 });
		const before = session.getSnapshot(); await assert.rejects(session.addLayer(draft, 'missing'), /composition/iu); assert.deepEqual(session.getSnapshot(), before);
		await session.save(); await session.open(after.id); assert.deepEqual(session.getSnapshot().project!.compositions, after.compositions);
	} finally { await store.close(); }
});
