/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { compileMotionCompositionLink, renderMotionCompositionLink } from '../src/common/editor/motion-link-rendering.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { openFramescaperCompositionLinkRepository } from '../src/framescaper/editor-composition-link-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';

const kit = await CanvasKitInit(); const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No asset expected.'); } });
function offer(revision = 1) {
	const project = createMotionscaperProject({ id: 'motion', title: 'Linked', compositionId: 'main', width: 16, height: 8 });
	const card = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 0.5]), size: motionVector([4, 8]) } });
	const animated = { ...card, transform: { ...card.transform, position: { ...motionVector([0, 0, 0]), expression: { source: '[frame * 8, 0, 0]', enabled: true, references: [] } } } };
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, revision, compositions: [{ ...project.compositions[0], layers: [animated], temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 } }] }));
}

test('M10 linked rendering pins a verified saved revision and uses the shared shutter evaluator for arbitrary exact source times', async () => {
	const value = offer(); const plan = compileMotionCompositionLink(value); let acquired = 0; let released = 0;
	const acquire = async (retained: typeof value) => { acquired++; assert.equal(retained.revision.digest, value.revision.digest); return { rasterizer, async release() { released++; } }; };
	const first = await renderMotionCompositionLink(plan, { num: 1, den: 30 }, { purpose: 'final', acquire });
	await renderMotionCompositionLink(compileMotionCompositionLink(offer(2)), 0, { purpose: 'final', acquire: async () => ({ rasterizer, async release() {} }) });
	const repeated = await renderMotionCompositionLink(plan, { num: 1, den: 30 }, { purpose: 'preview', acquire });
	assert.deepEqual(first.surface.pixels, repeated.surface.pixels); assert.equal(first.identity.revisionDigest, value.revision.digest); assert.deepEqual(first.time, { num: 1, den: 30 });
	assert.ok(first.surface.consumedOperationIds.every((id) => id.startsWith('sample:'))); assert.equal(acquired, 2); assert.equal(released, 2);
	const reduced = await renderMotionCompositionLink(plan, { num: 1, den: 30 }, { purpose: 'preview', quality: { temporalSamples: 1 }, acquire });
	assert.notDeepEqual(first.surface.pixels, reduced.surface.pixels); assert.equal(plan.offer.revision.revision, 1); assert.ok(Object.isFrozen(plan));
});

test('M10 malformed plans, source time and final quality reductions refuse before resource acquisition', async () => {
	let acquired = 0; const acquire = async () => { acquired++; return { rasterizer, async release() {} }; }; const plan = compileMotionCompositionLink(offer());
	await assert.rejects(renderMotionCompositionLink({ ...plan }, 0, { purpose: 'final', acquire }), /compiled/u);
	await assert.rejects(renderMotionCompositionLink(plan, -1, { purpose: 'final', acquire }), /source time/u);
	await assert.rejects(renderMotionCompositionLink(plan, 10, { purpose: 'final', acquire }), /source time/u);
	await assert.rejects(renderMotionCompositionLink(plan, 0, { purpose: 'final', quality: { temporalSamples: 1 }, acquire } as unknown as Parameters<typeof renderMotionCompositionLink>[2]), /final.*quality/u);
	await assert.rejects(renderMotionCompositionLink(plan, 0, { purpose: 'preview', quality: { temporalSamples: 5 }, acquire }), /quality/u);
	await assert.rejects(renderMotionCompositionLink(plan, 0, { purpose: 'final', maximumWorkingBytes: 1, acquire }), /budget/u);
	assert.equal(acquired, 0); assert.throws(() => compileMotionCompositionLink({ ...offer(), version: 2 }), /version/u);
});

test('M10 linked frame cancellation and raster failure release the pinned closure without publishing a partial result', async () => {
	const plan = compileMotionCompositionLink(offer()); const controller = new AbortController(); let released = 0;
	await assert.rejects(renderMotionCompositionLink(plan, 0, { purpose: 'final', signal: controller.signal, acquire: async () => { controller.abort(); return { rasterizer, async release() { released++; } }; } }), { name: 'AbortError' });
	assert.equal(released, 1);
	const primary = new Error('raster failure'); const cleanup = new Error('release failure');
	await assert.rejects(renderMotionCompositionLink(plan, 0, { purpose: 'final', acquire: async () => ({ rasterizer: { ...rasterizer, async rasterize() { throw primary; } }, async release() { throw cleanup; } }) }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});

test('M10 an accepted image composition renders from receiver-owned original bytes after offline reopen', async () => {
	const source = kit.MakeSurface(2, 2); assert.ok(source); source.getCanvas().clear(kit.Color(255, 0, 0, 0.5)); source.flush();
	const image = source.makeImageSnapshot(); const encoded = image.encodeToBytes(); assert.ok(encoded); const bytes = new Uint8Array(encoded); image.delete(); source.delete();
	const digest = digestScapeBytes(bytes); const asset: MotionAsset = { id: 'image', kind: 'image', name: 'Retained.png', mimeType: 'image/png', width: 2, height: 2, hasAlpha: true,
		sha256: digest, byteLength: bytes.length, storageKey: `motion-sha256:${digest}` };
	const project = createMotionscaperProject({ id: 'offline', title: 'Offline', compositionId: 'main', width: 2, height: 2 });
	const layer = createMotionLayer({ id: 'image-layer', name: 'Retained', durationFrames: 300, content: { kind: 'image', assetId: asset.id } });
	const value = createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, assets: [asset], compositions: [{ ...project.compositions[0], layers: [layer] }] }));
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory; const receiver = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	await receiver.receive('frame', 'linked', value, { readAsset: async () => ({ size: bytes.length, stream: () => new Blob([bytes]).stream() }) }); await receiver.close();
	const reopened = await openFramescaperCompositionLinkRepository({ indexedDB, line: 'successor' });
	try {
		const state = await reopened.load('frame', 'linked'); assert.ok(state);
		const result = await renderMotionCompositionLink(compileMotionCompositionLink(state.accepted), 0, { purpose: 'final', acquire: async (retained) => ({
			rasterizer: createCanvasKitMotionRasterizer(kit, { assets: retained.revision.project.assets, fallbackFonts: [], async loadAsset(entry) {
				const body = await reopened.readAsset(entry); if (!body) throw new Error('Retained source is missing.'); return new Uint8Array(await new Response(body.stream()).arrayBuffer());
			} }), async release() {},
		}) });
		const [red, green, blue, alpha] = result.surface.pixels; assert.equal(red, alpha); assert.equal(green, 0); assert.equal(blue, 0); assert.ok(alpha! > 0.49 && alpha! < 0.51);
	} finally { await reopened.close(); }
});
