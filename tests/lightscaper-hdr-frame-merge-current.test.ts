/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { ImageHdrMergePreviewCurrentV1 } from '../src/common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts';
import type { withImageHdrPixelStagingV1 as Staging } from '../src/common/editor/storage/image-hdr-pixel-staging-v1.ts';
import { withImageHdrPixelStagingV1 } from '../src/common/editor/storage/image-hdr-pixel-staging-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { withDecodedImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { normalizeFramescaperImageSourceCurrentV1, type FramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { cloneFramescaperProject, createFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, type FramescaperProjectHistory } from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore, framescaperProjectStoreAuthority } from '../src/framescaper/editor-project-store.ts';
import { createProjectSaveService } from '../src/common/editor/controller/document/project-save-service.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { hdrFrameFixtureCurrentV1 } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { hdrOpfsStagingFixture } from './helpers/lightscaper-hdr-opfs-staging-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const OWNER = new URL('../src/framescaper/editor-selected-image-hdr-merge-current-v1.ts', import.meta.url);
const TIME = '2026-10-16T14:00:00.000Z';
const OPTIONS = { schemaVersion: 1, referenceIndex: 0, exposureMultipliers: [1, .25], alignment: 'none', deghost: { mode: 'off', threshold: .15 }, fileName: 'Merged HDR.lshdr' } as const;
interface Receipt { readonly schemaVersion: 1; readonly projectId: string; readonly revision: number; readonly sourceId: string; readonly clipId: string; readonly notices: readonly string[]; }
interface MergeSession {
	readonly selection: Readonly<{ projectId: string; revision: number; inputs: readonly Readonly<{ key: string; width: number; height: number }>[] }>;
	isCurrent(): boolean;
	withPreview<Result>(options: unknown, consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>, options2?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
	merge(options: unknown, options2?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Receipt>>;
	closeAndJoin(): Promise<void>;
}
interface OwnerModule {
	bindFramescaperImageHdrMergeCurrentV1(options: unknown): void;
	framescaperImageHdrMergeForCurrentV1(controller: object): Readonly<{ open(options?: Readonly<{ signal?: AbortSignal }>): Promise<MergeSession> }> | null;
}
async function owner(): Promise<OwnerModule> {
	assert.ok(existsSync(OWNER), 'The Current Frame HDR selection/merge owner is missing.');
	return await import(OWNER.href) as OwnerModule;
}

async function byteSource(id: string, pixels: Uint8Array<ArrayBuffer>) {
	const descriptor = { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;
	const original = await encodePixelFramePngV1({ descriptor, pixels });
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, decoder: { id: 'browser-native', version: '1' } },
		width: 2, height: 1, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: pixels }] });
	const source = normalizeFramescaperImageSourceCurrentV1({ schemaVersion: 1, kind: 'image', id, storageKey: id, name: id,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
		original: { fileName: `${id}.png`, mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.length, sha256: pack.originalSha256 },
		canonical: { width: 2, height: 1, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' }, conversionReceiptSha256: pack.conversionReceiptSha256 });
	return { source, body: new Blob([new Uint8Array(pack.bytes)], { type: source.mimeType }), pixels };
}

function project(sources: readonly Readonly<FramescaperImageSourceCurrentV1>[]) {
	const f = createFramescaperBaselineImageFixture({ imageOnly: true }), track = f.project.tracks.find(item => item.type === 'video'); assert.ok(track);
	let value = applyFramescaperProjectCommand(PROFILE, f.project, { type: 'batch', commands: [
		{ type: 'image-clip/set', clipId: f.clip.id, expectedClip: f.clip, expectedPlacement: { scope: 'timeline', trackId: track.id }, clip: null, placement: null },
		{ type: 'image-source/set', sourceId: f.source.id, expectedSource: f.source, source: null },
		...sources.flatMap((source, index) => [{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
			{ type: 'image-clip/set', clipId: `bracket-clip-${index}`, expectedClip: null, expectedPlacement: null,
				clip: { schemaVersion: 1, kind: 'image', id: `bracket-clip-${index}`, sourceId: source.id, sequenceId: f.project.primarySequenceId,
					sequenceStartFrame: index * 150, sequenceFrameCount: 150, sourceStartTicks: '0' }, placement: { scope: 'timeline', trackId: track.id } }]),
	] }, { now: TIME });
	value = cloneFramescaperProject(PROFILE, { ...value, selection: { ...value.selection, clipIds: sources.map((_, index) => `bracket-clip-${index}`) } });
	return value;
}

/** Canonical media bodies and the shared numerical/storage owners are real.
 * The filesystem transport and active editor/history adoption are modeled. */
async function harness(module: OwnerModule, sources: readonly Readonly<FramescaperImageSourceCurrentV1>[], bodies: ReadonlyMap<string, Blob>, initialProject?: FramescaperProject) {
	let history = createFramescaperProjectHistory(PROFILE, initialProject ?? project(sources)); const token = {}, storage: ReturnType<typeof hdrOpfsStagingFixture>[] = [];
	const publications: Array<Readonly<{ expected: FramescaperProject; project: FramescaperProject; bytes: Uint8Array<ArrayBuffer> }>> = [];
	const reads: string[] = [], hooks: { beforeLoad?: () => Promise<void>; prepare?: () => Promise<unknown>;
		publish?: (request: Readonly<{ expected: FramescaperProject; project: FramescaperProject; bytes: Uint8Array<ArrayBuffer>; signal?: AbortSignal }>) => Promise<FramescaperProject | null> } = {}; let sequence = 0;
	const controller = { project: history.present, getSnapshot: () => ({ readOnly: false, selectedClipId: 'bracket-clip-0' }),
		actions: { project: { async openById(id: string) { assert.equal(id, history.present.id); controller.project = history.present; } } } };
	const withStaging: typeof Staging = (consume, options) => {
		const f = hdrOpfsStagingFixture(); storage.push(f);
		return withImageHdrPixelStagingV1(consume, { ...options, backend: f.backend, acquireLease: f.acquireLease });
	};
	module.bindFramescaperImageHdrMergeCurrentV1({ controller,
		async prepareCurrentProject() { await hooks.prepare?.(); },
		store: { async loadMediaAsset(key: string) { reads.push(key); await hooks.beforeLoad?.(); return bodies.get(key) ?? null; } },
		session: { captureProjectHistory: () => ({ history, token }), assertProjectHistoryToken(_id: string, value: unknown) { assert.equal(value, token); },
			updateProjectHistory(_id: string, next: FramescaperProjectHistory) { history = next; }, markProjectSaved() {}, getProjectHistory: () => history },
		executeCommand: (value: FramescaperProjectHistory, command: unknown, options: { now: Date | string }) => executeFramescaperProjectCommand(PROFILE, value, command, options),
		async publishIfCurrent(request: { expected: FramescaperProject; project: FramescaperProject; bytes: Uint8Array<ArrayBuffer> }) {
			assert.deepEqual(controller.project, request.expected); publications.push({ ...request, bytes: request.bytes.slice() });
			return hooks.publish ? await hooks.publish(request) : request.project;
		}, withStaging, now: () => '2026-10-16T14:00:01.000Z', createId: (prefix: string) => `${prefix}-hdr-${++sequence}`,
	});
	const runtime = module.framescaperImageHdrMergeForCurrentV1(controller); assert.ok(runtime, 'Frame must bind a menu-owned HDR runtime.');
	return { controller, publications, storage, reads, hooks, runtime, get history() { return history; } };
}

const decode = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
function fused(a: number, b: number): number {
	const wa = Math.min(a, 1 - a), wb = Math.min(b, 1 - b);
	return Math.fround(wa + wb ? (wa * a + wb * b * 4) / (wa + wb) : Math.max(a, b * 4));
}
const display = (n: number) => Math.round(255 * (n <= 0 ? 0 : n >= 1 ? 1 : n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055));

test('Frame still Originals create a fresh native HDR Source5 in ProjectBin with exact merge provenance and default Develop', async () => {
	const module = await owner(), inputs = await Promise.all([
		byteSource('bracket-a', Uint8Array.of(188, 64, 0, 255, 255, 128, 32, 255)),
		byteSource('bracket-b', Uint8Array.of(188, 64, 0, 255, 255, 128, 32, 255)),
	]);
	const f = await harness(module, inputs.map(value => value.source), new Map(inputs.map(value => [value.source.storageKey, value.body])));
	const before = structuredClone(f.controller.project), session = await f.runtime.open();
	try {
		assert.deepEqual(session.selection.inputs.map(value => value.key), ['bracket-clip-0', 'bracket-clip-1']);
		assert.equal(f.reads.length, 0, 'Selection capture is scalar, without loading pixel bodies.');
		const ack = await session.merge(OPTIONS); assert.equal(ack.projectId, before.id); assert.equal(ack.revision, before.revision + 1);
		assert.equal(f.publications.length, 1); const published = f.publications[0]!, source = published.project.sources.find(value => value.id === ack.sourceId);
		assert.ok(source?.kind === 'image' && source.schemaVersion === 5); assert.deepEqual(source.develop, defaultImageDevelopStateV1());
		assert.deepEqual(published.project.clips, before.clips); assert.deepEqual(published.project.sources.filter(value => value.id !== source.id), before.sources);
		assert.equal(published.project.projectBin.clips.find(value => value.id === ack.clipId)?.sourceId, source.id);
		const { openFramescaperCurrentImageFrameSource } = await import('../src/framescaper/timeline-image-current-frame-source.ts');
		const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => new Blob([published.bytes]) }, source);
		try {
			await reader.withCanonicalFrame(frame => {
				const values = Array.from(inputs[0]!.pixels, (_, index) => index % 4 === 3 ? 1 : fused(decode(inputs[0]!.pixels[index]! / 255), decode(inputs[1]!.pixels[index]! / 255)));
				assert.deepEqual([...frame.pixels], values); assert.ok(frame.pixels[0]! > 1, 'The generated Original must retain reconstructed scene radiance above one.');
			});
			const bytes = await reader.readOriginal();
			try { await withDecodedImageHdrOriginalV1({ bytes }, view => {
				assert.deepEqual(view.provenance.inputs.map(value => [value.product, value.ownerId, value.sourceId, value.revision]), inputs.map(value => ['framescaper', before.id, value.source.id, before.revision]));
				assert.deepEqual(view.provenance.inputs.map(value => value.exposureMultiplier), [1, .25]);
			}); } finally { bytes.fill(0); }
		} finally { await reader.closeAndJoin(); }
		assert.ok(f.storage.every(value => value.files.size === 0 && value.leases.size === 0 && value.closed));
	} finally { await session.closeAndJoin(); for (const value of f.publications) value.bytes.fill(0); }
});

test('Frame HDR prepares a clean live selection through the real save service before its exact native project CAS', async t => {
	const previousRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	t.after(() => { if (previousRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
	const module = await owner(), inputs = await Promise.all([
		byteSource('native-save-a', Uint8Array.of(188, 64, 32, 255, 188, 64, 32, 255)),
		byteSource('native-save-b', Uint8Array.of(188, 64, 32, 255, 188, 64, 32, 255)),
	]);
	const selected = project(inputs.map(value => value.source));
	let persisted = createFramescaperProject(PROFILE, { id: selected.id, now: TIME, sources: [], clips: [],
		tracks: selected.tracks.map(track => ({ ...track, clipIds: [] })),
		sequences: selected.sequences, primarySequenceId: selected.primarySequenceId });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	t.after(() => store.close()); await store.ready(); assert.ok(await store.createProjectIfAbsent(persisted));
	const authority = framescaperProjectStoreAuthority(PROFILE, store), track = persisted.tracks.find(value => value.type === 'video'); assert.ok(track);
	for (const [index, input] of inputs.entries()) {
		assert.equal(input.source.schemaVersion, 1); const clip = selected.clips.find(value => value.id === `bracket-clip-${index}`); assert.ok(clip?.kind === 'image');
		const next = applyFramescaperProjectCommand(PROFILE, persisted, { type: 'batch', commands: [
			{ type: 'image-source/set', sourceId: input.source.id, expectedSource: null, source: input.source },
			{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'timeline', trackId: track.id } },
		] }, { now: `2026-10-16T14:00:00.00${index + 1}Z` });
		const saved = await authority.timelineImages.publishIfCurrent({ expected: persisted, project: next, bytes: new Uint8Array(await input.body.arrayBuffer()) });
		assert.ok(saved); persisted = cloneFramescaperProject(PROFILE, saved);
	}
	const live = cloneFramescaperProject(PROFILE, { ...persisted, selection: { ...persisted.selection, clipIds: ['bracket-clip-0', 'bracket-clip-1'] } });
	const root = await store.loadProject(live.id); assert.ok(root);
	assert.deepEqual(cloneFramescaperProject(PROFILE, root).selection.clipIds, []); assert.equal(live.revision, persisted.revision);
	const f = await harness(module, inputs.map(value => value.source), new Map(inputs.map(value => [value.source.storageKey, value.body])), live);
	const events: string[] = [];
	const saves = createProjectSaveService({
		getProject: () => f.controller.project, hasHistory: () => true, hasUnsavedProjectChanges: () => false, isReadOnly: () => false,
		cloneProject: value => cloneFramescaperProject(PROFILE, value),
		prepareSnapshot(snapshot, purpose) { assert.equal(purpose, 'project-save'); events.push('prepared'); return cloneFramescaperProject(PROFILE, snapshot); },
		admitProjectPublication: async () => undefined,
		async saveProject(snapshot) { const saved = await store.saveProjectIfCurrent(persisted, snapshot); assert.ok(saved); persisted = cloneFramescaperProject(PROFILE, saved); events.push('saved'); },
		persistActiveProjectId: async () => undefined, isCurrentProject: id => id === live.id, hasSessionTab: () => true,
		markProjectSaved() {}, publish() {}, garbageCollect: async () => undefined, refreshStorageUsage: async () => undefined,
		handleError(error: unknown) { throw error; },
	});
	f.hooks.prepare = async () => { await saves.flushProject({ forceCurrentSnapshot: true, prepareCurrentSnapshot: true }); };
	f.hooks.beforeLoad = async () => { assert.deepEqual(await store.loadProject(live.id), live, 'The exact selected snapshot must already be durable before canonical body I/O.'); events.push('read'); };
	f.hooks.publish = async request => { events.push('publish'); const saved = await authority.hdrImages.publishIfCurrent(request); return saved ? cloneFramescaperProject(PROFILE, saved) : null; };
	const session = await f.runtime.open();
	try {
		assert.deepEqual(events, ['prepared', 'saved']); assert.equal(f.reads.length, 0);
		const ack = await session.merge(OPTIONS), savedRoot = await store.loadProject(live.id); assert.ok(savedRoot);
		const saved = cloneFramescaperProject(PROFILE, savedRoot);
		assert.equal(ack.revision, live.revision + 1); assert.equal(saved.revision, ack.revision); assert.equal(ack.notices.length, 0);
		const generated = saved.sources.find(value => value.id === ack.sourceId); assert.ok(generated?.kind === 'image' && generated.schemaVersion === 5);
		assert.equal(saved.projectBin.clips.find(value => value.id === ack.clipId)?.sourceId, ack.sourceId);
		assert.deepEqual(saved.clips, live.clips); assert.deepEqual(saved.sources.filter(value => value.id !== ack.sourceId), live.sources);
		assert.equal(events.filter(value => value === 'publish').length, 1); assert.equal(events.indexOf('publish') > events.indexOf('saved'), true);
		for (const input of inputs) assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(input.source.storageKey))!.arrayBuffer()), new Uint8Array(await input.body.arrayBuffer()));
		assert.ok(f.storage.every(value => value.files.size === 0 && value.leases.size === 0 && value.closed));
	} finally { await session.closeAndJoin(); for (const value of f.publications) value.bytes.fill(0); }
});

test('Frame HDR joins held project preparation and rejects a same-revision selection change before canonical I/O', async () => {
	const module = await owner(), input = await byteSource('prepare-selection', Uint8Array.of(128, 64, 32, 255, 128, 64, 32, 255));
	const f = await harness(module, [input.source, { ...input.source, id: 'prepare-other', storageKey: 'prepare-other' }], new Map());
	const entered = deferred<void>(), release = deferred<void>(); f.hooks.prepare = async () => { entered.resolve(); await release.promise; };
	const opening = f.runtime.open(); void opening.catch(() => undefined);
	try {
		await entered.promise; f.controller.project = cloneFramescaperProject(PROFILE, { ...f.controller.project,
			selection: { ...f.controller.project.selection, clipIds: [...f.controller.project.selection.clipIds].reverse() } });
		assert.equal(await remainsPending(opening), true); release.resolve(); await assert.rejects(opening, /changed|stale|selection/u);
		assert.equal(f.reads.length, 0); assert.equal(f.storage.length, 0); assert.equal(f.publications.length, 0);
	} finally { release.resolve(); await Promise.allSettled([opening]); }
});

test('Frame HDR joins held project preparation before returning the exact opaque abort without canonical I/O', async () => {
	const module = await owner(), input = await byteSource('prepare-abort', Uint8Array.of(128, 64, 32, 255, 128, 64, 32, 255));
	const f = await harness(module, [input.source, { ...input.source, id: 'abort-other', storageKey: 'abort-other' }], new Map());
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ hdrPrepare: 'cancelled' });
	f.hooks.prepare = async () => { entered.resolve(); await release.promise; };
	const opening = f.runtime.open({ signal: stop.signal }); void opening.catch(() => undefined);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(opening), true);
		release.resolve(); await assert.rejects(opening, error => Object.is(error, reason));
		assert.equal(f.reads.length, 0); assert.equal(f.storage.length, 0); assert.equal(f.publications.length, 0);
	} finally { release.resolve(); await Promise.allSettled([opening]); }
});

test('Frame HDR preview is the actual shared merge, publishes nothing, and Close joins and wipes a held preview consumer', async () => {
	const module = await owner(), a = await byteSource('a', Uint8Array.of(188, 64, 0, 255, 188, 64, 0, 255)), b = await byteSource('b', a.pixels.slice());
	const f = await harness(module, [a.source, b.source], new Map([[a.source.id, a.body], [b.source.id, b.body]]));
	const session = await f.runtime.open(), entered = deferred<void>(), release = deferred<void>(); let pixels: Uint8Array | undefined;
	const work = session.withPreview(OPTIONS, async view => {
		assert.equal(view.descriptor.sampleFormat, 'float32'); assert.equal(view.frame.descriptor.sampleFormat, 'unorm8');
		assert.deepEqual([...view.frame.pixels], [display(fused(decode(188 / 255), decode(188 / 255))), display(fused(decode(64 / 255), decode(64 / 255))), 0, 255,
			display(fused(decode(188 / 255), decode(188 / 255))), display(fused(decode(64 / 255), decode(64 / 255))), 0, 255]);
		assert.equal(f.publications.length, 0); assert.ok(f.storage.every(value => value.files.size === 0)); pixels = view.frame.pixels; entered.resolve(); await release.promise;
	}); void work.catch(() => undefined);
	try { await entered.promise; const closed = session.closeAndJoin(); assert.equal(await remainsPending(closed), true); assert.ok(pixels?.some(value => value !== 0));
		release.resolve(); await assert.rejects(work); await closed; assert.ok(pixels?.every(value => value === 0)); assert.equal(f.publications.length, 0);
	} finally { release.resolve(); await Promise.allSettled([work, session.closeAndJoin()]); }
});

test('Frame RAW brackets use pinned ABI1 canonical words while saved recovery, crop and exposure remain unchanged', async () => {
	const module = await owner(), raw = await createRawFrameFixtureCurrentV1();
	try { await raw.withDefaultTransport(async () => {
		const inputs = ['headroom', 'recovery'].map((mode, index) => {
			const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
				rawDevelopment: { schemaVersion: 1, mode }, repairs: { schemaVersion: 1, spots: [] },
				geometry: { ...defaultImageDevelopStateV1().geometry, crop: { x: .25, y: 0, width: .75, height: 1 } },
				effects: [{ id: 'creative', type: 'tone-ladder-v1', enabled: true, params: { exposure: 3 } }] });
			return normalizeFramescaperImageSourceCurrentV1({ ...raw.source, id: `raw-${index}`, storageKey: `raw-${index}`, develop, developed: { width: 24, height: 32 },
				provenance: createImageDevelopHandoffProvenanceCurrentV1({ develop, origin: raw.source.provenance.origin,
					original: { exactName: raw.source.original.fileName, sha256: raw.source.original.sha256, byteLength: raw.original.length } }) });
		});
		const f = await harness(module, inputs, new Map(inputs.map(value => [value.id, raw.body]))), before = structuredClone(f.controller.project), session = await f.runtime.open();
		try {
			const ack = await session.merge(OPTIONS), result = f.publications[0]!, source = result.project.sources.find(value => value.id === ack.sourceId);
			assert.ok(source?.kind === 'image' && source.schemaVersion === 5); assert.deepEqual(source.developed, { width: 32, height: 32 });
			const { openFramescaperCurrentImageFrameSource } = await import('../src/framescaper/timeline-image-current-frame-source.ts');
			const reader = await openFramescaperCurrentImageFrameSource({ loadMediaAsset: async () => new Blob([result.bytes]) }, source);
			try { await reader.withCanonicalFrame(frame => {
				assert.deepEqual([...frame.pixels], raw.native.words.map((word, index) => index % 4 === 3 ? 1 : fused(word / 65535, word / 65535)));
			}); } finally { await reader.closeAndJoin(); }
			assert.deepEqual(result.project.sources.filter(value => value.id !== source.id), before.sources);
			assert.equal(raw.workers.active(), 0); assert.deepEqual(new Uint8Array(await raw.body.arrayBuffer()), raw.pack.bytes);
		} finally { await session.closeAndJoin(); for (const value of f.publications) value.bytes.fill(0); }
	}); } finally { await raw.close(); }
});

test('Frame HDR refuses generated HDR inputs and changed selection before loading or staging any source', async () => {
	const module = await owner(), hdr = await hdrFrameFixtureCurrentV1(), ordinary = await byteSource('ordinary', Uint8Array.of(128, 64, 32, 255, 128, 64, 32, 255));
	const f = await harness(module, [hdr.source, ordinary.source], new Map());
	await assert.rejects(() => f.runtime.open(), /canonical|HDR|generated|Source5/u); assert.equal(f.reads.length, 0); assert.equal(f.storage.length, 0); assert.equal(f.publications.length, 0);
	const valid = await harness(module, [ordinary.source, { ...ordinary.source, id: 'other', storageKey: 'other' }], new Map());
	const session = await valid.runtime.open();
	try { valid.controller.project = cloneFramescaperProject(PROFILE, { ...valid.controller.project, selection: { ...valid.controller.project.selection, clipIds: ['bracket-clip-0'] } });
		await assert.rejects(() => session.merge(OPTIONS), /changed|stale|selection/u); assert.equal(valid.reads.length, 0); assert.equal(valid.publications.length, 0);
	} finally { await session.closeAndJoin(); }
});

test('Frame HDR open captures the exact selection synchronously before its first await and refuses a same-revision reversal before I/O', async t => {
	const module = await owner(), ordinary = await byteSource('open-selection', Uint8Array.of(128, 64, 32, 255, 128, 64, 32, 255));
	const f = await harness(module, [ordinary.source, { ...ordinary.source, id: 'open-selection-other', storageKey: 'open-selection-other' }], new Map());
	let accepted: MergeSession | undefined; t.after(async () => { await accepted?.closeAndJoin(); });
	const opening = f.runtime.open().then(value => { accepted = value; return value; });
	f.controller.project = cloneFramescaperProject(PROFILE, { ...f.controller.project,
		selection: { ...f.controller.project.selection, clipIds: [...f.controller.project.selection.clipIds].reverse() } });
	await assert.rejects(opening, /changed|stale|selection/u);
	assert.equal(f.reads.length, 0); assert.equal(f.storage.length, 0); assert.equal(f.publications.length, 0);
});

test('Frame HDR admits its complete native source phase before loading packs or allocating staged pixel planes', async () => {
	const module = await owner(), raw = await createRawFrameFixtureCurrentV1();
	try {
		// These are scalar size sentinels, not forged body evidence: opening either
		// missing body would be a test failure. Three retained 160 MiB packs plus
		// the fixed512 MiB heap,128 MiB native output and32 MiB proof reserve
		// already exceed the named1 GiB phase before guides or Original copies.
		const inputs = [0, 1].map(index => normalizeFramescaperImageSourceCurrentV1({ ...raw.source,
			id: `large-${index}`, storageKey: `large-${index}`, assetByteLength: 160 * 1024 * 1024 }));
		const f = await harness(module, inputs, new Map());
		await assert.rejects(() => f.runtime.open(), /1 GiB|budget|working|capacity/u);
		assert.equal(f.reads.length, 0); assert.equal(f.storage.length, 0); assert.equal(f.publications.length, 0);
	} finally { await raw.close(); }
});
