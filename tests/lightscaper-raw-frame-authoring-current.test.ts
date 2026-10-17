/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { imageDevelopHandoffRecipeSha256V2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function display(value: number): number {
	value = Math.max(0, Math.min(1, value)); return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
}
function clone(develop: ImageDevelopStateCurrentV1) {
	return replaceImageDevelopRepairSpotsV1(develop, { schemaVersion: 1, spots: [{ id: 'clone', enabled: true, mode: 'clone',
		target: { x: 24.5 / 32, y: 24.5 / 32 }, source: { x: 8.5 / 32, y: 24.5 / 32 }, radius: .0125, feather: 0, opacity: 1 }] });
}
function bind(f: Awaited<ReturnType<typeof createRawFrameFixtureCurrentV1>>, additional: ReadonlyMap<string, Blob> = new Map()) {
	let history = createFramescaperProjectHistory(PROFILE, f.project());
	const commands: FramescaperImageSourceSetCommandTimelineImage[] = [], calls: string[] = [], selected = { selectedClipId: 'raw-image-clip', readOnly: false };
	const controller = { project: history.present, getSnapshot() { assert.equal(this, controller); return selected; }, actions: { edit: {
		commit(command: FramescaperImageSourceSetCommandTimelineImage) { assert.equal(this, controller.actions.edit); commands.push(command);
			history = executeFramescaperProjectCommand(PROFILE, history, command); controller.project = history.present; },
	} } };
	const store = { async loadMediaAsset(key: string) { assert.equal(this, store); calls.push(key); return key === f.source.storageKey ? f.body : additional.get(key) ?? null; } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store });
	return { controller, selected, commands, calls, open: () => framescaperImageDevelopAuthoringForCurrentV1(controller)!.open(),
		history: () => history,
		undo() { history = undoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; },
		redo() { history = redoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; } };
}

test('actual Source4 selected Session retains native Original identity on no-op and commits Current repairs through real undo/redo', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1({ orientation: 6 });
	try { await f.withDefaultTransport(async () => {
		const owner = bind(f), first = await owner.open();
		try { assert.equal(first.nativeCurrent, true); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), true);
			first.apply(first.develop); assert.equal(owner.commands.length, 0); assert.equal(owner.history().undoStack.length, 0); assert.deepEqual(owner.controller.project.sources, [f.source]);
		} finally { await first.closeAndJoin(); }
		assert.equal(videoPreviewAuthoringPausedV1(owner.controller), false);
		const session = await owner.open();
		try {
			await session.withOriginalFrame(frame => { assert.equal(frame.descriptor.sampleFormat, 'unorm16'); assert.equal(frame.descriptor.transfer, 'linear'); assert.deepEqual([...frame.pixels], f.native.words); assert.equal(f.workers.active(), 0); });
			const develop = clone(session.develop); session.apply(develop); assert.equal(owner.commands.length, 1); assert.equal(owner.history().undoStack.length, 1);
			const source = owner.controller.project.sources[0]!; assert.ok(source.kind === 'image' && source.schemaVersion === 4);
			assert.deepEqual(source.raw, f.source.raw); assert.deepEqual(source.original, f.source.original); assert.deepEqual(source.canonical, f.source.canonical);
			for (const key of ['storageKey', 'contentSha256', 'assetByteLength', 'conversionReceiptSha256'] as const) assert.equal(source[key], f.source[key]);
			assert.equal(source.develop.processVersion, 3); assert.deepEqual(source.develop, develop); assert.equal(source.provenance.origin.schemaFamily, 'framescaper');
			assert.equal(source.provenance.developSha256, imageDevelopHandoffRecipeSha256V2(develop));
			const committed = structuredClone(source); owner.undo(); assert.deepEqual(owner.controller.project.sources, [f.source]); owner.redo(); assert.deepEqual(owner.controller.project.sources, [committed]);
			assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
		} finally { await session.closeAndJoin(); }
		assert.equal(videoPreviewAuthoringPausedV1(owner.controller), false);
	}); } finally { await f.close(); }
});

test('Source4 native draft renders local Clone and gradient-covered exposure without changing history or the RAW pack', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try { await f.withDefaultTransport(async () => {
		const owner = bind(f), session = await owner.open();
		try {
			const develop = normalizeImageDevelopStateCurrentV1({ ...clone(session.develop), effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } }],
				masks: [{ schemaVersion: 2, id: 'half', name: 'Half frame', kind: 'matte', inputs: [], nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: .5, y: 0, width: .5, height: 1 }], outputNodeId: 'shape' }],
				maskBindings: [{ maskId: 'half', effectId: 'tone' }] });
			assert.ok(session.withDraftFrame);
			const observed = await session.withDraftFrame({ develop, maskOverlay: { maskId: 'half', effectId: 'tone' } }, view => ({ pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage], samples: view.histogram.sampledPixels }));
			const expected: number[] = [], coverage: number[] = [];
			for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
				const donorX = x === 24 && y === 24 ? 8 : x; coverage.push(x >= 16 ? 255 : 0);
				for (let c = 0; c < 3; c++) expected.push(display(Math.fround(Math.fround(f.native.words[(y * 32 + donorX) * 4 + c]! / 65535) * (x >= 16 ? 2 : 1))));
				expected.push(255);
			}
			assert.deepEqual(observed, { pixels: expected, coverage, samples: 1024 }); assert.equal(owner.commands.length, 0);
			assert.deepEqual(owner.controller.project.sources, [f.source]); assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
		} finally { await session.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('Source4 temporary brush draft authenticates an unused genuine body, preserves native repair precision and projects coverage through suffix mirror', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try { await f.withDefaultTransport(async () => {
		await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(63) }, async unused => {
			const bodies = new Map([[unused.reference.storageKey, new Blob([new Uint8Array(unused.bytes)])]]), owner = bind(f, bodies), session = await owner.open();
			try { await withPreparedBrushMaskResourceV1({ width: 32, height: 32, alpha: Uint8Array.from({ length: 1024 }, (_, i) => i % 32 >= 16 ? 255 : 0) }, async body => {
				const graph = (id: string, key: string) => ({ schemaVersion: 2, id, name: id, kind: 'matte', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: key }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' });
				const develop = normalizeImageDevelopStateCurrentV1({ ...clone(session.develop), effects: [
					{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } },
					{ id: 'mirror', type: 'develop-geometry-v1', enabled: true, params: { flipHorizontal: 1 } }],
					masks: [graph('paint', body.reference.storageKey), graph('unused', unused.reference.storageKey)], maskBindings: [{ maskId: 'paint', effectId: 'tone' }] });
				assert.ok(session.withBrushDraftFrame);
				const observed = await session.withBrushDraftFrame({ develop, reference: body.reference, bytes: body.bytes, maskOverlay: { maskId: 'paint', effectId: 'tone' } },
					view => ({ pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage] }));
				const expected: number[] = [], coverage: number[] = [];
				for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
					const fromX = 31 - x, donorX = fromX === 24 && y === 24 ? 8 : fromX; coverage.push(fromX >= 16 ? 255 : 0);
					for (let c = 0; c < 3; c++) expected.push(display(Math.fround(Math.fround(f.native.words[(y * 32 + donorX) * 4 + c]! / 65535) * (fromX >= 16 ? 2 : 1)))); expected.push(255);
				}
				assert.deepEqual(observed, { pixels: expected, coverage }); assert.ok(owner.calls.includes(unused.reference.storageKey)); assert.ok(!owner.calls.includes(body.reference.storageKey));
				assert.equal(owner.commands.length, 0); assert.deepEqual(owner.controller.project.sources, [f.source]);
			}); } finally { await session.closeAndJoin(); }
		});
	}); } finally { await f.close(); }
});

test('Source4 selected Close joins native draft/display/coverage before preview resumes and cannot publish a retained Apply', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>();
	try { await f.withDefaultTransport(async () => {
		const owner = bind(f), session = await owner.open(); assert.ok(session.withDraftFrame); let held: Uint8Array | undefined;
		const work = session.withDraftFrame({ develop: clone(session.develop) }, async view => { held = view.frame.pixels; entered.resolve(); await release.promise; })
			.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try { await entered.promise; assert.equal(f.workers.active(), 0); assert.throws(() => session.apply(clone(session.develop)), /join before Apply/u);
			const closing = session.closeAndJoin(); assert.equal(await remainsPending(closing), true); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), true);
			assert.throws(() => session.apply(session.develop), /changed/u); release.resolve(); const outcome = await work; assert.equal(outcome.ok, false); await closing;
			assert.ok(held!.every(value => value === 0)); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), false); assert.equal(owner.commands.length, 0);
		} finally { release.resolve(); await work; await session.closeAndJoin(); }
	}); } finally { release.resolve(); await f.close(); }
});

test('Source4 scalar authoring refuses an oversized changed recipe without rewriting the existing native receipt', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1();
	try { const project = f.project(), before = structuredClone(project), command = prepareFramescaperImageDevelopSourceCurrentV1(project, 'raw-image-clip', clone(f.source.develop));
		assert.equal(command.source?.schemaVersion, 4); assert.deepEqual(project, before); assert.deepEqual(command.expectedSource, f.source);
		const oversized = { ...project, sources: [{ ...project.sources[0]!, assetByteLength: 128 * 1024 * 1024 }] };
		assert.throws(() => prepareFramescaperImageDevelopSourceCurrentV1(oversized, 'raw-image-clip', clone(f.source.develop)), /1 GiB/u); assert.deepEqual(project, before);
	} finally { await f.close(); }
});
