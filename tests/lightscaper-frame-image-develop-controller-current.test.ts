/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { registerVideoPreviewAuthoringParticipantV1, videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { editableImageFixture, CORNERS, PROFILE, LUT } from './helpers/framescaper-editable-image-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

/** Model-original fixture with genuine native Blob pack bodies. These controller
 * cases exercise existing project commands; they make no image-codec/UI claim. */
function fixture(cube?: boolean) {
	const f = editableImageFixture(cube === undefined ? {} : { cube }), commands: FramescaperImageSourceSetCommandTimelineImage[] = [];
	const selected: { selectedClipId: string; readOnly: boolean } = { selectedClipId: f.clip.id, readOnly: false };
	const controller = { project: f.project(), getSnapshot() { assert.equal(this, controller); return selected; },
		actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
			assert.equal(this, controller.actions.edit); commands.push(command); controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command);
		} } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: f.store });
	return { ...f, controller, selected, commands, port: framescaperImageDevelopAuthoringForCurrentV1(controller)! };
}
test('selected Frame controller lends raw canonical pixels, joins held work, wipes it and resumes preview', async () => {
	const f = fixture(), session = await f.port.open(), entered = deferred<void>(), release = deferred<void>();
	let plane: PixelFrameV1['pixels'] | undefined;
	const work = session.withOriginalFrame(async frame => {
		assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [2, 2]); assert.deepEqual([...frame.pixels], CORNERS);
		plane = frame.pixels; entered.resolve(); await release.promise;
	});
	try {
		await entered.promise; assert.equal(videoPreviewAuthoringPausedV1(f.controller), true);
		assert.throws(() => session.apply(session.develop), /join before Apply/u); assert.equal(f.commands.length, 0);
		const close = session.closeAndJoin(); assert.equal(session.closeAndJoin(), close); assert.equal(await remainsPending(close), true);
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); release.resolve(); await assert.rejects(work, /changed/u); await close;
		assert.deepEqual([...plane!], Array(16).fill(0)); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); assert.equal(f.commands.length, 0);
	} finally { release.resolve(); await Promise.allSettled([work, session.closeAndJoin()]); }
});

test('Frame composition pins native body methods and authenticates retained inputs before Original', async () => {
	const f = fixture(false); f.store.loadMediaAsset = () => assert.fail('The captured native reader must retain its method and receiver.');
	const session = await f.port.open();
	try {
		assert.deepEqual(f.calls, [LUT.storageKey]);
		await session.withOriginalFrame(frame => { assert.deepEqual([...frame.pixels], CORNERS); });
		assert.deepEqual(f.calls, [LUT.storageKey, f.source.storageKey]);
	} finally { await session.closeAndJoin(); }
});
test('an outer cancellation revokes session availability with its exact native reason', async () => {
	const f = fixture(), stop = new AbortController(), session = await f.port.open({ signal: stop.signal }), reason = Symbol('cancelled');
	try {
		stop.abort(reason); assert.equal(session.isCurrent(), false);
		const outcome = await session.withOriginalFrame(() => undefined).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, reason), true); assert.equal(f.commands.length, 0);
	} finally { await session.closeAndJoin(); }
});
test('mask-name Apply uses the real Frame command and provenance while preserving Original and pack', async () => {
	const f = fixture(), session = await f.port.open();
	try {
		const next = normalizeImageDevelopStateV3({ ...session.develop, processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
			masks: [{ schemaVersion: 2, id: 'named', name: 'Window', kind: 'matte', inputs: [],
				nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }] });
		session.apply(next); assert.equal(f.commands.length, 1); const source = f.controller.project.sources.find(value => value.id === f.source.id)!;
		assert.equal(source.kind, 'image'); if (source.kind !== 'image') throw new Error('Expected image'); assert.equal(source.schemaVersion, 3);
		if (source.schemaVersion !== 3) throw new Error('Expected Source3');
		assert.equal(source.storageKey, f.source.storageKey); assert.equal(source.contentSha256, f.source.contentSha256); assert.deepEqual(source.original, f.source.original);
		assert.equal(source.provenance.origin.schemaFamily, 'framescaper'); assert.equal(session.isCurrent(), false);
	} finally { await session.closeAndJoin(); }
});
test('unchanged recipe closes without promotion, publication or Original acquisition', async () => {
	const f = fixture(), session = await f.port.open();
	try { session.apply(session.develop); assert.equal(f.commands.length, 0); assert.deepEqual(f.controller.project.sources[0], f.source); assert.deepEqual(f.calls, []); }
	finally { await session.closeAndJoin(); }
});
test('same-revision project or selected-clip drift fences both Original and history', async () => {
	for (const mode of ['project', 'selection', 'readOnly'] as const) {
		const f = fixture(), session = await f.port.open();
		try {
			if (mode === 'project') f.controller.project = { ...f.controller.project, name: 'Changed without revision' };
			if (mode === 'selection') f.selected.selectedClipId = 'gone'; if (mode === 'readOnly') f.selected.readOnly = true;
			assert.equal(session.isCurrent(), false); await assert.rejects(session.withOriginalFrame(() => undefined), /changed/u);
			assert.throws(() => session.apply(session.develop), /changed/u); assert.equal(f.commands.length, 0); assert.deepEqual(f.calls, []);
		} finally { await session.closeAndJoin(); }
	}
});
test('declared disabled LUT is authenticated before Frame Original and a corrupt body releases preview', async () => {
	const f = fixture(false), native = f.store.loadMediaAsset;
	f.store.loadMediaAsset = async key => key === LUT.storageKey ? new Blob([new Uint8Array(LUT.byteLength)]) : native.call(f.store, key);
	// A second native composition captures the new exact method before opening.
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller: f.controller, store: f.store });
	const port = framescaperImageDevelopAuthoringForCurrentV1(f.controller)!;
	await assert.rejects(port.open(), /cube LUT/iu); assert.deepEqual(f.calls, []); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
});

test('Source1 canonical authoring rejects its complete byte bound before any native load', async () => {
	const f = fixture(); const { develop: _develop, developed: _developed, provenance: _provenance, ...base } = f.source;
	const source = normalizeFramescaperImageSourceV1({ ...base, schemaVersion: 1, assetByteLength: 160 * 1024 * 1024,
		canonical: { ...base.canonical, width: 4096, height: 4096 } });
	f.controller.project = applyFramescaperProjectCommand(PROFILE, f.controller.project, { type: 'image-source/set', sourceId: source.id, expectedSource: f.source, source });
	await assert.rejects(f.port.open(), /512 MiB/u); assert.deepEqual(f.calls, []); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
});
test('opaque caller cancellation wins over source drift during an accepted native pack read', async () => {
	const f = fixture(), native = f.store.loadMediaAsset, entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	f.store.loadMediaAsset = async key => { entered.resolve(); await release.promise; return native.call(f.store, key); };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller: f.controller, store: f.store });
	const session = await framescaperImageDevelopAuthoringForCurrentV1(f.controller)!.open(); let consumed = 0;
	const work = session.withOriginalFrame(() => { consumed++; }, { signal: stop.signal }).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; const reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
		f.controller.project = { ...f.controller.project, name: 'Concurrent valid drift' }; release.resolve(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason.proxy), true); assert.equal(consumed, 0);
	} finally { release.resolve(); await work; await session.closeAndJoin(); }
	assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
});
test('selected Frame open checks cancellation and joins accepted preview before native acquisition', async () => {
	const f = fixture(), release = deferred<void>(), entered = deferred<void>(), stop = new AbortController();
	const unregister = registerVideoPreviewAuthoringParticipantV1(f.controller, async () => { entered.resolve(); await release.promise; });
	const opening = f.port.open({ signal: stop.signal }).then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; assert.equal(await remainsPending(opening), true); const reason = Symbol('stop'); stop.abort(reason);
		assert.equal(await remainsPending(opening), true); release.resolve(); const result = await opening;
		assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, reason), true);
		assert.deepEqual(f.calls, []); assert.equal(videoPreviewAuthoringPausedV1(f.controller), false);
	} finally { release.resolve(); const result = await opening; if (result.ok) await result.value.closeAndJoin(); unregister(); }
});
