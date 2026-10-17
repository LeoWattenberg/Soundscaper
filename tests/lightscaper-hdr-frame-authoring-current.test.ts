/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand, redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES, hdrFrameDisplay } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('Source5 selected authoring commits native Clone through genuine history without changing its Original or HDR receipt', async () => {
	const f = await hdrFrameFixtureCurrentV1(); let history = createFramescaperProjectHistory(PROFILE, f.project()), commits = 0;
	const controller = { project: history.present, getSnapshot: () => ({ selectedClipId: 'hdr-clip', readOnly: false }), actions: { edit: {
		commit(command: FramescaperImageSourceSetCommandTimelineImage) { commits++; history = executeFramescaperProjectCommand(PROFILE, history, command); controller.project = history.present; },
	} } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: { loadMediaAsset: async () => f.body } });
	const first = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open();
	try { first.apply(first.develop); assert.equal(commits, 0); assert.deepEqual(controller.project.sources, [f.source]); }
	finally { await first.closeAndJoin(); }
	const session = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open();
	try {
		assert.equal(session.nativeCurrent, true); assert.equal(videoPreviewAuthoringPausedV1(controller), true);
		await session.withOriginalFrame(frame => { assert.ok(frame.pixels instanceof Float32Array); assert.deepEqual([...frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]); });
		const develop = replaceImageDevelopRepairSpotsV1(session.develop, { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
			target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .2, feather: 0, opacity: 1 }] });
		assert.ok(session.withDraftFrame);
		const output = await session.withDraftFrame({ develop }, view => [...view.frame.pixels]);
		assert.deepEqual(output, [...HDR_FRAME_SAMPLES.slice(0, 4), ...HDR_FRAME_SAMPLES.slice(0, 4)].map((value, index) => index % 4 === 3 ? 255 : hdrFrameDisplay(value)));
		assert.equal(commits, 0); session.apply(develop); assert.equal(commits, 1);
		const changed = controller.project.sources[0]; assert.ok(changed?.kind === 'image' && changed.schemaVersion === 5);
		assert.deepEqual(changed.hdr, f.source.hdr); assert.deepEqual(changed.original, f.source.original); assert.equal(changed.contentSha256, f.source.contentSha256);
		history = undoFramescaperProjectCommand(PROFILE, history); assert.deepEqual(history.present.sources, [f.source]);
		history = redoFramescaperProjectCommand(PROFILE, history); assert.deepEqual(history.present.sources, [changed]);
	} finally { await session.closeAndJoin(); }
	assert.equal(videoPreviewAuthoringPausedV1(controller), false); assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
});

test('Source5 temporary brush preview renders native HDR with effect-aligned coverage without installing or publishing the draft', async () => {
	const f = await hdrFrameFixtureCurrentV1(); let commits = 0;
	const controller = { project: f.project(), getSnapshot: () => ({ selectedClipId: 'hdr-clip', readOnly: false }), actions: { edit: { commit() { commits++; } } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: { loadMediaAsset: async () => f.body } });
	const session = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open();
	try { await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, async body => {
		const develop = normalizeImageDevelopStateThroughV4({ ...defaultImageDevelopStateV2(), effects: [
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -2 } },
			{ id: 'mirror', type: 'develop-geometry-v1', enabled: true, params: { flipHorizontal: 1 } }],
			masks: [{ schemaVersion: 2, id: 'paint', name: 'Paint', kind: 'matte', inputs: [{ name: 'body', kind: 'alpha', sourceRef: body.reference.storageKey }],
				nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'body' }], outputNodeId: 'alpha' }], maskBindings: [{ maskId: 'paint', effectId: 'tone' }] });
		assert.ok(session.withBrushDraftFrame);
		const result = await session.withBrushDraftFrame({ develop, reference: body.reference, bytes: body.bytes, maskOverlay: { maskId: 'paint', effectId: 'tone' } },
			view => ({ pixels: [...view.frame.pixels], coverage: [...view.maskOverlay!.coverage] }));
		assert.deepEqual(result, { pixels: [0, 0, 0, 255, 255, 188, 0, 255], coverage: [255, 0] });
		assert.equal(commits, 0); assert.deepEqual(controller.project.sources, [f.source]);
	}); } finally { await session.closeAndJoin(); }
});

test('Source5 selected Close joins a stale held native callback before preview resumes and native pixels wipe', async () => {
	const f = await hdrFrameFixtureCurrentV1(), entered = deferred<void>(), release = deferred<void>(), selected = { selectedClipId: 'hdr-clip', readOnly: false };
	const controller = { project: f.project(), getSnapshot: () => selected, actions: { edit: { commit() { assert.fail('No stale edit may publish.'); } } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: { loadMediaAsset: async () => f.body } });
	const session = await framescaperImageDevelopAuthoringForCurrentV1(controller)!.open(); let pixels: Float32Array | undefined;
	const work = session.withOriginalFrame(async frame => { assert.ok(frame.pixels instanceof Float32Array); pixels = frame.pixels; entered.resolve(); await release.promise; });
	void work.catch(() => undefined);
	try {
		await entered.promise; selected.readOnly = true; const close = session.closeAndJoin();
		assert.equal(await remainsPending(close), true); assert.equal(videoPreviewAuthoringPausedV1(controller), true); assert.equal(pixels?.[0], 3);
		release.resolve(); await assert.rejects(work); await close;
		assert.ok(pixels?.every(value => value === 0)); assert.equal(videoPreviewAuthoringPausedV1(controller), false);
	} finally { release.resolve(); await Promise.allSettled([work, session.closeAndJoin()]); }
});
