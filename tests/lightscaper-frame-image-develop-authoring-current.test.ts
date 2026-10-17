/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFramescaperImageDevelopSourceCurrentV1 as prepare } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { withFramescaperImageDevelopFrameV3 } from '../src/framescaper/timeline-image-develop-frame-v3.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { manageImageDevelopMasksCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-management-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import type { FramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { imageDevelopHandoffRecipeSha256V2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { repairFrameHandoffFixture, readRepairFrameEntries } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';
import { repairRecipe } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

async function nativeHandoff(placement: 'active' | 'legacy' | 'brush2' = 'active', resources = false) {
	const f = await repairFrameHandoffFixture(placement, resources);
	try {
		const archive = await f.archive(), entries = await readRepairFrameEntries(archive.blob);
		const project = cloneFramescaperProject(PROFILE, JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as unknown);
		const source = project.sources.find(source => source.kind === 'image'), clip = project.clips.find(clip => clip.kind === 'image');
		assert.ok(source && source.kind === 'image'); assert.ok(clip && clip.kind === 'image');
		const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { assets: readonly { kind: string; entry: string }[] };
		const asset = manifest.assets.find(asset => asset.kind === 'framescaper-image-asset'), pack = asset ? entries.get(asset.entry) : undefined;
		assert.ok(pack, 'A genuine exported immutable image pack is required.');
		return { project, source, clip, pack, original: new Uint8Array(await f.records[0]!.original.arrayBuffer()), bodies: new Map(f.bodies) };
	} finally { await f.close(); }
}
type Handoff = Awaited<ReturnType<typeof nativeHandoff>>;
function immutable(source: FramescaperImageSourceCurrentV1) {
	return { kind: source.kind, id: source.id, name: source.name, mimeType: source.mimeType, storageKey: source.storageKey,
		contentSha256: source.contentSha256, assetByteLength: source.assetByteLength, original: source.original,
		canonical: source.canonical, conversionReceiptSha256: source.conversionReceiptSha256 };
}
function promoted(f: Handoff) {
	assert.notEqual(f.source.schemaVersion, 1);
	if (f.source.schemaVersion === 1) throw new Error('Editable native handoff required.');
	return f.source;
}
function literalRepairs() { return repairRecipe(); }
async function rendered(source: unknown, pack: Uint8Array<ArrayBuffer>, bodies: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()) {
	const sourcePort = { withBytes: async <Result>(reference: { storageKey: string }, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>) => {
		const stored = bodies.get(reference.storageKey); assert.ok(stored); const bytes = stored.slice();
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	return withFramescaperImageDevelopFrameV3({ source, read: (offset: number, length: number) => pack.slice(offset, offset + length) },
		view => ({ width: view.frame.descriptor.width, height: view.frame.descriptor.height, pixels: Array.from(view.frame.pixels) }),
		{ source: sourcePort, maskSource: sourcePort });
}

test('native Source1 repair authoring explicitly promotes to Source3 with truthful Frame provenance and immutable Original pack', async () => {
	const f = await nativeHandoff('legacy'), legacy = promoted(f);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = legacy;
	const source = normalizeFramescaperImageSourceV1({ ...packed, schemaVersion: 1 });
	const project = applyFramescaperProjectCommand(PROFILE, f.project, { type: 'image-source/set', sourceId: source.id, expectedSource: legacy, source });
	const before = structuredClone(project), bytes = f.pack.slice(), command = prepare(project, f.clip.id, literalRepairs());
	assert.equal(command.type, 'image-source/set'); assert.deepEqual(command.expectedSource, source); assert.equal(command.source?.schemaVersion, 3);
	assert.ok(command.source && command.source.schemaVersion === 3);
	assert.deepEqual(immutable(command.source), immutable(source)); assert.equal(command.source.develop.processVersion, 3);
	if (command.source.develop.processVersion !== 3) throw new Error('Explicit repairs must retain process3.');
	assert.deepEqual(command.source.develop.repairs, literalRepairs().repairs);
	assert.deepEqual(command.source.provenance.origin, { schemaFamily: 'framescaper', schemaVersion: 1, projectId: project.id,
		revision: project.revision, sourceId: source.id, sequenceId: f.clip.sequenceId, clipId: f.clip.id });
	assert.equal(command.source.provenance.developSha256, imageDevelopHandoffRecipeSha256V2(command.source.develop));
	assert.deepEqual(command.source.developed, { width: 3, height: 1 }); assert.deepEqual(project, before); assert.deepEqual(f.pack, bytes);
	assert.deepEqual(await rendered(command.source, f.pack), { width: 3, height: 1, pixels: [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255] });
});

test('Source1 no-op authoring and unchanged Source2/3 recipes retain their exact existing schema and provenance', async () => {
	const f = await nativeHandoff('legacy'), source = promoted(f);
	assert.deepEqual(prepare(f.project, f.clip.id, source.develop).source, source);
	const { develop: _develop, developed: _developed, provenance: _provenance, ...packed } = source;
	const plain = normalizeFramescaperImageSourceV1({ ...packed, schemaVersion: 1 });
	const project = applyFramescaperProjectCommand(PROFILE, f.project, { type: 'image-source/set', sourceId: plain.id, expectedSource: source, source: plain });
	const command = prepare(project, f.clip.id, defaultImageDevelopStateV1()); assert.deepEqual(command.source, plain); assert.deepEqual(command.expectedSource, plain);
	const current = await nativeHandoff('active', true), actual = promoted(current);
	assert.deepEqual(prepare(current.project, current.clip.id, actual.develop).source, actual);
});

test('Source2 mask naming preserves graph identity and makes an explicit Current Frame edit', async () => {
	const f = await nativeHandoff('legacy'), source = promoted(f);
	const graph = { schemaVersion: 1, id: 'rectangle', kind: 'matte', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'shape' };
	const baseline = { ...source, develop: normalizeImageDevelopStateCurrentV1({ ...source.develop, masks: [graph] }) };
	const withMask = { ...baseline, provenance: { ...source.provenance, developSha256: imageDevelopHandoffRecipeSha256V2(baseline.develop) } };
	const project = applyFramescaperProjectCommand(PROFILE, f.project, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: withMask });
	const develop = manageImageDevelopMasksCurrentV1(baseline.develop, { type: 'rename', maskId: graph.id, name: 'Frame region' });
	const command = prepare(project, f.clip.id, develop); assert.ok(command.source && command.source.schemaVersion === 3);
	assert.equal(command.source.develop.processVersion, 2); assert.equal(command.source.provenance.origin.schemaFamily, 'framescaper');
	assert.deepEqual(immutable(command.source), immutable(source)); assert.deepEqual(command.source.develop.masks[0], { ...graph, schemaVersion: 2, name: 'Frame region' });
	assert.deepEqual(command.source.develop.maskBindings, source.develop.maskBindings);
});

test('Source3 mask rename retains complete disabled LUT, unused brush, repairs and pack bindings with byte-equal pixels', async () => {
	const f = await nativeHandoff('active', true), source = promoted(f), before = await rendered(source, f.pack, f.bodies);
	const graph = source.develop.masks[0]!;
	const develop = manageImageDevelopMasksCurrentV1(source.develop, { type: 'rename', maskId: graph.id, name: 'Frame paint' });
	const command = prepare(f.project, f.clip.id, develop); assert.ok(command.source && command.source.schemaVersion === 3);
	assert.deepEqual(immutable(command.source), immutable(source)); assert.deepEqual(command.source.develop.effects, source.develop.effects);
	assert.deepEqual(command.source.develop.masks[0], { ...graph, schemaVersion: 2, name: 'Frame paint' });
	assert.deepEqual(command.source.develop.maskBindings, source.develop.maskBindings);
	assert.equal(command.source.develop.processVersion, 3);
	if (source.develop.processVersion !== 3 || command.source.develop.processVersion !== 3) throw new Error('Explicit Current repairs required.');
	assert.deepEqual(command.source.develop.repairs, source.develop.repairs);
	assert.deepEqual(await rendered(command.source, f.pack, f.bodies), before);
});

test('removing the last repair remains process3 and genuine Frame history undo/redo restores complete saved source metadata', async () => {
	const f = await nativeHandoff('active', true), source = promoted(f);
	const develop = replaceImageDevelopRepairSpotsV1(source.develop, { schemaVersion: 1, spots: [] }), command = prepare(f.project, f.clip.id, develop);
	assert.ok(command.source && command.source.schemaVersion === 3); assert.equal(command.source.develop.processVersion, 3);
	if (command.source.develop.processVersion !== 3) throw new Error('Removing repairs must retain process3.');
	assert.deepEqual(command.source.develop.repairs.spots, []); assert.deepEqual(immutable(command.source), immutable(source));
	const initial = createFramescaperProjectHistory(PROFILE, f.project), history = executeFramescaperProjectCommand(PROFILE, initial, command);
	assert.deepEqual(history.present.sources, [command.source]); assert.equal(history.undoStack.length, 1);
	const undone = undoFramescaperProjectCommand(PROFILE, history); assert.deepEqual(undone.present.sources, f.project.sources);
	assert.deepEqual(redoFramescaperProjectCommand(PROFILE, undone).present.sources, history.present.sources);
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, history.present, command), /stale/);
});

test('moved Clone donor renders the independently expected immutable pixel and geometry runs after repair', async () => {
	const f = await nativeHandoff('active'), source = promoted(f);
	const recipe = literalRepairs(), moved = replaceImageDevelopRepairSpotsV1(source.develop, { schemaVersion: 1,
		spots: recipe.repairs.spots.map(spot => ({ ...spot, source: { x: 2.5 / 3, y: .5 } })) });
	const develop = normalizeImageDevelopStateCurrentV1({ ...moved, geometry: { ...moved.geometry, flipHorizontal: true } });
	const command = prepare(f.project, f.clip.id, develop); assert.ok(command.source);
	assert.deepEqual(await rendered(command.source, f.pack), { width: 3, height: 1, pixels: [0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255] });
	assert.deepEqual(immutable(command.source), immutable(source));
});

test('full project and selected static image admission refuse malformed or mismatched inputs without changing the project', async () => {
	const f = await nativeHandoff('active'), before = structuredClone(f.project), develop = literalRepairs();
	assert.throws(() => prepare({ ...f.project, schemaFamily: 'soundscaper' }, f.clip.id, develop));
	assert.throws(() => prepare(f.project, 'missing', develop));
	assert.throws(() => prepare(f.project, f.clip.id, { ...develop, effects: [{ id: 'bad', type: 'not-an-effect', enabled: true, params: {} }] }));
	assert.throws(() => prepare({ ...f.project, sources: [...f.project.sources, { kind: 'image', id: 'foreign', schemaVersion: 999 }] }, f.clip.id, develop));
	assert.deepEqual(f.project, before);
});

test('selected locked timeline image refuses an otherwise valid source edit', async () => {
	const f = await nativeHandoff('active'), project = { ...f.project, tracks: f.project.tracks.map(track => ({ ...track, locked: true })) };
	assert.throws(() => prepare(project, f.clip.id, replaceImageDevelopRepairSpotsV1(promoted(f).develop, { schemaVersion: 1, spots: [] })), /locked/);
});

test('complete retained resource namespace and natural geometry bounds refuse before any source command escapes', async () => {
	const f = await nativeHandoff('active', true), source = promoted(f), graph = source.develop.masks[0]!;
	assert.throws(() => prepare(f.project, f.clip.id, { ...source.develop,
		masks: [{ ...graph, inputs: [...graph.inputs, { name: 'unused-foreign', kind: 'alpha', sourceRef: 'foreign' }] }] }));
	assert.throws(() => prepare(f.project, f.clip.id, { ...source.develop, geometry: { ...source.develop.geometry,
		crop: { x: 0, y: 0, width: 0, height: 1 } } }));
});
