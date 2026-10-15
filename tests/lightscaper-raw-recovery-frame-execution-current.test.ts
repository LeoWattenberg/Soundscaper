/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { rawDerivedFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-derived-frame-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { editableImageFixture, CORNERS } from './helpers/framescaper-editable-image-current-fixture.ts';
import { openFramescaperCurrentImageFrameSource } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { prepareFramescaperRawImageWorkingCurrentV1 } from '../src/framescaper/internal/timeline-image-raw-working-plan-current-v1.ts';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { withFramescaperImageDevelopFrameV3 } from '../src/framescaper/timeline-image-develop-frame-v3.ts';
import { createPhotoFramescaperHandoffProjectCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-project-current-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { decodeLibRawRecoveryWasmV2, type RawRecoveryProfileV2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';

const OPTIONS = { concurrency: false, timeout: 30_000 };
const CANONICAL = new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url);
const RECOVERY = process.env.LIGHTSCAPER_RECOVERY_WASM ?? new URL('../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url);
let module: Promise<WebAssembly.Module> | undefined;
function recipe(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery', extras: Readonly<Record<string, unknown>> = {}) {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4, repairs: { schemaVersion: 1, spots: [] },
		rawDevelopment: { schemaVersion: 1, mode }, ...extras });
}
function display(value: number): number {
	value = Math.max(0, Math.min(1, value)); return Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
}
function sourceFor(f: Awaited<ReturnType<typeof rawDerivedFrameFixtureCurrentV1>>, develop = recipe()) {
	const source = normalizeFramescaperImageSourceCurrentV1({ ...f.source, develop,
		provenance: createImageDevelopHandoffProvenanceCurrentV1({ original: f.source.provenance.original, origin: f.source.provenance.origin, develop }) });
	if (source.schemaVersion !== 4) throw new TypeError('The recovery fixture requires its actual RAW source.'); return source;
}
async function expected(f: Awaited<ReturnType<typeof rawDerivedFrameFixtureCurrentV1>>, profile: RawRecoveryProfileV2) {
	module ??= readFile(RECOVERY).then(bytes => WebAssembly.compile(bytes));
	const result = decodeLibRawRecoveryWasmV2(await module, f.original, profile);
	try { return [...result.frame.pixels]; } finally { result.frame.pixels.fill(0); }
}

/** The real public defaults remain selected. Only browser Worker transport and
 * the two pinned external binary fetches are adapted for Node; no decoder,
 * Original reader, Session, renderer, or source-processing policy is replaced. */
async function nativeDefaults<Result>(f: Awaited<ReturnType<typeof rawDerivedFrameFixtureCurrentV1>>, consume: () => Promise<Result>): Promise<Result> {
	const saved = ['Worker', 'fetch'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function (_url: URL, options: WorkerOptions) {
		return options.name === 'lightscaper-libraw-recovery' ? f.native.recovery.createWorker() : f.native.canonical.createWorker();
	} });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		assert.ok(url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm'
			|| url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm');
		return new Response(new Uint8Array(await readFile(String(url).includes('recovery-abi2') ? RECOVERY : CANONICAL)), { headers: { 'Content-Type': 'application/wasm' } });
	} });
	try { return await consume(); } finally {
		for (const [index, key] of ['Worker', 'fetch'].entries()) {
			if (saved[index]) Object.defineProperty(globalThis, key, saved[index]!); else Reflect.deleteProperty(globalThis, key);
		}
		await f.close();
	}
}
function bind(f: Awaited<ReturnType<typeof rawDerivedFrameFixtureCurrentV1>>, develop = recipe('canonical')) {
	const source = sourceFor(f, develop), body = new Blob([new Uint8Array(f.pack.bytes)]);
	const project = createPhotoFramescaperHandoffProjectCurrentV1(source, { projectId: 'recovery-frame', sequenceId: 'recovery-sequence',
		trackId: 'recovery-track', clipId: 'recovery-clip', now: '2026-10-01T00:00:00.000Z' });
	let history = createFramescaperProjectHistory(PROFILE, project);
	const commands: FramescaperImageSourceSetCommandTimelineImage[] = [], calls: string[] = [];
	const controller = { project: history.present, getSnapshot() { assert.equal(this, controller); return { selectedClipId: 'recovery-clip' }; }, actions: { edit: {
		commit(command: FramescaperImageSourceSetCommandTimelineImage) { assert.equal(this, controller.actions.edit); commands.push(command);
			history = executeFramescaperProjectCommand(PROFILE, history, command); controller.project = history.present; },
	} } };
	const store = { async loadMediaAsset(key: string) { assert.equal(this, store); calls.push(key); assert.equal(key, source.storageKey); return body; } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store });
	return { source, body, project, store, controller, commands, calls, open: () => framescaperImageDevelopAuthoringForCurrentV1(controller)!.open(),
		undo() { history = undoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; },
		redo() { history = redoFramescaperProjectCommand(PROFILE, history); controller.project = history.present; } };
}

test('Current Frame Source4 selects real recovery before Develop while canonical words and Original remain ABI1', OPTIONS, async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try { await nativeDefaults(f, async () => {
		const develop = recipe('recovery', { effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }] });
		const owner = bind(f, develop), reference = await expected(f, 'highlight-recovery-v1');
		const reader = await openFramescaperCurrentImageFrameSource(owner.store, owner.source); let held: Float32Array | undefined;
		try {
			await reader.withDevelopInputFrame(develop, frame => {
				assert.ok(frame.pixels instanceof Float32Array); held = frame.pixels;
				assert.deepEqual([...frame.pixels], reference); assert.ok(frame.pixels.some(value => value > 1));
				assert.equal(f.native.canonical.active() + f.native.recovery.active(), 0);
			});
			assert.ok(held!.every(value => value === 0));
			await reader.withCanonicalFrame(frame => { assert.ok(frame.pixels instanceof Uint16Array); assert.deepEqual([...frame.pixels], f.canonical.words); });
			const original = await reader.readOriginal(); try { assert.deepEqual(original, f.original); } finally { original.fill(0); }
			const output = await reader.readFrame(0);
			try { assert.deepEqual([...output], reference.map((value, index) => index % 4 === 3 ? 255 : display(Math.fround(value * .5)))); }
			finally { output.fill(0); }
			assert.deepEqual(new Uint8Array(await owner.body.arrayBuffer()), f.pack.bytes); assert.deepEqual(owner.source.raw, f.raw);
		} finally { await reader.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('Current Frame draft captures recovery with Clone, masked exposure and crop before native work; Apply preserves RAW authority through undo/redo', OPTIONS, async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try { await nativeDefaults(f, async () => {
		const owner = bind(f, recipe()), session = await owner.open(), reference = await expected(f, 'highlight-recovery-v1');
		try {
			await session.withOriginalFrame(frame => {
				assert.ok(frame.pixels instanceof Float32Array); assert.deepEqual([...frame.pixels], reference);
			});
			const develop = recipe('recovery', {
				repairs: { schemaVersion: 1, spots: [{ id: 'clone', enabled: true, mode: 'clone', target: { x: 72.5 / 128, y: 40.5 / 96 },
					source: { x: 12.5 / 128, y: 40.5 / 96 }, radius: .0025, feather: 0, opacity: 1 }] },
				effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } },
					{ id: 'crop', type: 'develop-geometry-v1', enabled: true, params: { cropX: .25, cropY: .25, cropWidth: .5, cropHeight: .5 } }],
				masks: [{ schemaVersion: 2, id: 'right', name: 'Right half', kind: 'matte', inputs: [],
					nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: .5, y: 0, width: .5, height: 1 }], outputNodeId: 'shape' }],
				maskBindings: [{ maskId: 'right', effectId: 'tone' }],
			});
			const mutable = structuredClone(develop), work = session.withDraftFrame!({ develop: mutable, maskOverlay: { maskId: 'right', effectId: 'tone' } }, view => ({
				width: view.frame.descriptor.width, height: view.frame.descriptor.height, pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage],
			}));
			Object.defineProperty(mutable, 'rawDevelopment', { value: { schemaVersion: 1, mode: 'headroom' } });
			const observed = await work, pixels: number[] = [], coverage: number[] = [];
			for (let y = 24; y < 72; y++) for (let x = 32; x < 96; x++) {
				const donor = x === 72 && y === 40 ? 12 : x; coverage.push(x >= 64 ? 255 : 0);
				for (let channel = 0; channel < 3; channel++) pixels.push(display(Math.fround(reference[(y * 128 + donor) * 4 + channel]! * (x >= 64 ? .5 : 1))));
				pixels.push(255);
			}
			assert.deepEqual(observed, { width: 64, height: 48, pixels, coverage }); assert.equal(owner.commands.length, 0);
			session.apply(develop); assert.equal(owner.commands.length, 1);
			const committed = owner.controller.project.sources[0]!; assert.ok(committed.kind === 'image' && committed.schemaVersion === 4);
			assert.deepEqual(committed.develop, develop); assert.deepEqual(committed.raw, f.raw);
			assert.deepEqual(committed.original, owner.source.original); assert.equal(committed.contentSha256, owner.source.contentSha256);
			owner.undo(); assert.deepEqual(owner.controller.project.sources, [owner.source]); owner.redo(); assert.deepEqual(owner.controller.project.sources, [committed]);
		} finally { await session.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('Current Frame temporary brush preview selects real headroom before its local adjustment without installing a body', OPTIONS, async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try { await nativeDefaults(f, async () => {
		const owner = bind(f), session = await owner.open(), reference = await expected(f, 'linear-headroom-v1');
		try { await withPreparedBrushMaskResourceV1({ width: 128, height: 96, alpha: Uint8Array.from({ length: 128 * 96 }, (_, i) => i % 128 >= 64 ? 255 : 0) }, async body => {
			const develop = recipe('headroom', { effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } }],
				masks: [{ schemaVersion: 2, id: 'paint', name: 'Paint', kind: 'matte', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: body.reference.storageKey }],
					nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [{ maskId: 'paint', effectId: 'tone' }] });
			const observed = await session.withBrushDraftFrame!({ develop, reference: body.reference, bytes: body.bytes, maskOverlay: { maskId: 'paint', effectId: 'tone' } },
				view => ({ pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage] }));
			assert.deepEqual(observed.coverage, Array.from({ length: 128 * 96 }, (_, i) => i % 128 >= 64 ? 255 : 0));
			assert.deepEqual(observed.pixels, reference.map((value, index) => index % 4 === 3 ? 255 : display(Math.fround(value * (Math.floor(index / 4) % 128 >= 64 ? .5 : 1)))));
			assert.ok(!owner.calls.includes(body.reference.storageKey)); assert.equal(owner.commands.length, 0); assert.deepEqual(owner.controller.project.sources, [owner.source]);
		}); } finally { await session.closeAndJoin(); }
	}); } finally { await f.close(); }
});

test('Current Frame Close joins a held derived display scope and preserves opaque cancellation after physical retirement', OPTIONS, async () => {
	const f = await rawDerivedFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke();
	try { await nativeDefaults(f, async () => {
		const owner = bind(f), session = await owner.open(); let held: Uint8Array | undefined;
		const work = session.withDraftFrame!({ develop: recipe() }, async view => { held = view.frame.pixels; entered.resolve(); await release.promise; }, { signal: stop.signal })
			.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await Promise.race([entered.promise, work.then(() => { throw new Error('Derived draft consumer did not enter.'); })]);
			assert.equal(f.native.canonical.active() + f.native.recovery.active(), 0); stop.abort(opaque.proxy);
			const closing = session.closeAndJoin(); assert.equal(await remainsPending(closing), true); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), true);
			release.resolve(); const result = await work; assert.ok(!result.ok); assert.ok(Object.is(result.error, opaque.proxy)); await closing;
			assert.ok(held!.every(value => value === 0)); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), false); assert.equal(owner.commands.length, 0);
		} finally { release.resolve(); await work; await session.closeAndJoin(); }
	}); } finally { release.resolve(); await f.close(); }
});

test('Current RAW Frame metadata plans the Float32 decode maximum and refuses aggregate overflow before native body I/O', OPTIONS, async () => {
	const f = await rawDerivedFrameFixtureCurrentV1();
	try {
		const source = sourceFor(f), plan = prepareFramescaperRawImageWorkingCurrentV1(source);
		assert.ok(plan.decodePeakBytes >= BigInt(source.assetByteLength) * 3n + 800n * 1024n * 1024n + BigInt(source.original.byteLength) * 2n);
		const oversized = { ...source, assetByteLength: 80 * 1024 * 1024 }; let reads = 0;
		await assert.rejects(openFramescaperCurrentImageFrameSource({ async loadMediaAsset() { reads++; throw new Error('Oversized RAW body was opened.'); } }, oversized), /1 GiB/u);
		assert.equal(reads, 0);
	} finally { await f.close(); }
});

test('Current raster Source3 canonical process4 executes while permanent named Source3 stays strict and noncanonical raster is refused', OPTIONS, async () => {
	const f = editableImageFixture({ crop: false }), develop = recipe('canonical');
	const source = normalizeFramescaperImageSourceCurrentV1({ ...f.source, schemaVersion: 3, develop,
		provenance: createImageDevelopHandoffProvenanceCurrentV1({ original: f.source.provenance.original, develop,
			origin: { ...f.source.provenance.origin, schemaVersion: 3 } }) });
	const reader = await openFramescaperCurrentImageFrameSource(f.store, source);
	try {
		const pixels = await reader.readFrame(0); try { assert.deepEqual([...pixels], CORNERS); } finally { pixels.fill(0); }
		await assert.rejects(withFramescaperImageDevelopFrameV3({ source, read: (offset: number, length: number) => f.pack.bytes.subarray(offset, offset + length) }, () => undefined), /version|process/iu);
		const project = createPhotoFramescaperHandoffProjectCurrentV1(source, { projectId: 'raster-current4', sequenceId: 'raster-sequence', trackId: 'raster-track', clipId: 'raster-clip', now: '2026-10-01T00:00:00.000Z' });
		assert.throws(() => prepareFramescaperImageDevelopSourceCurrentV1(project, 'raster-clip', recipe('recovery')), /raster|Source4|canonical/iu);
	} finally { await reader.closeAndJoin(); }
});
