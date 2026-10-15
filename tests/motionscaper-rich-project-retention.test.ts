/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import type { MotionscaperProject } from '../src/motionscaper/editor-project-types.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { richMotionProjectFixture, rational } from './helpers/motionscaper-rich-project-fixture.ts';

function assertSavedAuthority(project: MotionscaperProject): void {
	assert.deepEqual(project.compositions[0]!.layers.map(layer => layer.kind),
		['footage', 'image', 'text', 'shapes', 'solid', 'null', 'adjustment', 'precomp', 'camera', 'light']);
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: rational(1, 2) });
	assert.deepEqual(frame.frame, rational(15)); assert.deepEqual(frame.samplePosition, rational(24000));
	const find = (id: string) => { const layer = frame.layers.find(layer => layer.state.id === id); assert.ok(layer); return layer; };
	const text = find('text').state; assert.equal(text.kind, 'text');
	if (text.kind !== 'text') throw new Error('Text authority was lost.');
	assert.equal(text.document.runs[0]!.fontAssetId, 'font'); assert.equal(text.document.runs[0]!.fontSize, 20);
	assert.deepEqual(text.document.runs[0]!.color, [0.5, 0.25, 0.5, 0.75]); assert.deepEqual(text.document.boxSize, [150, 80]);
	const shape = find('shapes').state; assert.equal(shape.kind, 'shapes');
	if (shape.kind !== 'shapes') throw new Error('Path authority was lost.');
	assert.deepEqual(shape.shapes[0]!.path.vertices[0]!.point, [2, 0]); assert.equal(shape.shapes[0]!.stroke!.width, 2);
	assert.deepEqual(find('null').state.transform.position, [15, 4, 0]);
	assert.deepEqual([...find('image').worldMatrix.slice(12, 15)], [15, 4, 0]);
	assert.deepEqual(find('precomp').sourceTime, rational(5, 2)); assert.deepEqual(find('precomp').precomposition!.frame, rational(60));
	const camera = find('camera').state, light = find('light').state;
	assert.ok(camera.kind === 'camera' && light.kind === 'light'); assert.equal(camera.zoom, 1000); assert.equal(light.intensity, 2);
	assert.equal(frame.audio.find(audio => audio.assetId === 'footage')!.gain, 0.5);
	assert.deepEqual(frame.audio.find(audio => audio.assetId === 'audio')!.sourceTime, rational(3, 4));
	assert.equal(frame.audio.find(audio => audio.assetId === 'audio')!.gain, 0.75);
}

test('M02 every declared layer and animated property survives durable reopen and streamed portable archive retention', async () => {
	const { project, bodies } = richMotionProjectFixture(); const expected = structuredClone(project);
	const originals = new Map([...bodies].map(([id, bytes]) => [id, bytes.slice()]));
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const source = createMotionscaperProjectStore({ indexedDB });
	let savedDigest: string;
	try {
		for (const asset of project.assets) await source.putAsset(asset, new Blob([new Uint8Array(bodies.get(asset.id)!)]));
		savedDigest = (await source.save(project, null)).digest;
	} finally { await source.close(); }
	// Destroy caller-owned bytes before either reopening or exporting.
	for (const bytes of bodies.values()) bytes.fill(0);
	const reopened = createMotionscaperProjectStore({ indexedDB }); const chunks: Uint8Array[] = [];
	try {
		const saved = await reopened.load(project.id); assert.ok(saved); assert.equal(saved.digest, savedDigest);
		assert.deepEqual(saved.project, expected); assertSavedAuthority(saved.project);
		for (const asset of saved.project.assets) {
			const body = await reopened.loadAsset(asset); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), originals.get(asset.id));
		}
		assert.equal(await exportMotionscaperArchive(saved.project, asset => reopened.readAsset(asset), {
			writable: new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice()); } }),
		}), null);
	} finally { await reopened.close(); }
	const targetFactory = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const target = createMotionscaperProjectStore({ indexedDB: targetFactory });
	try {
		const imported = await importMotionscaperArchive(new Blob(chunks.map(chunk => new Uint8Array(chunk))), value => target.beginImport(value));
		assert.equal(imported.kind, 'current');
	} finally { await target.close(); }
	const portable = createMotionscaperProjectStore({ indexedDB: targetFactory });
	try {
		const saved = await portable.load(project.id); assert.ok(saved); assert.equal(saved.digest, savedDigest);
		assert.deepEqual(saved.project, expected); assertSavedAuthority(saved.project);
		for (const asset of saved.project.assets) {
			const body = await portable.loadAsset(asset); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), originals.get(asset.id));
		}
	} finally { await portable.close(); }
});
