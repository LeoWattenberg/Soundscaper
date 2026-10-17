/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperImageDevelopOwnerSurfaceV1 from '../src/common/editor/ui/dialogs/FramescaperImageDevelopOwnerSurfaceV1.tsx';
import ImageRepairSpotsEditorV1 from '../src/common/editor/ui/dialogs/ImageRepairSpotsEditorV1.tsx';
import { bindFramescaperImageDevelopAuthoringCurrentV1, framescaperImageDevelopAuthoringForCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperImageSourceSetCommandTimelineImage } from '../src/framescaper/editor-project-timeline-image-image-command.ts';
import type { WithImageRepairSpotsOriginalFrameV1 } from '../src/common/editor/controller/shared/image-repair-spots-authoring-v1.ts';
import { photoDevelopRepairSpotsCopy } from '../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

// Only the native Canvas boundary is modeled. RAW decoding, Source4 proof,
// selected Session and Original-space authoring use their actual owners.
function canvasBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const paintings: number[][] = [];
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(value: { data: Uint8ClampedArray }) { paintings.push([...value.data]); } }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { paintings, restore() { for (const [index, key] of keys.entries()) { const saved = previous[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } } };
}
function selected(f: Awaited<ReturnType<typeof createRawFrameFixtureCurrentV1>>) {
	const commands: FramescaperImageSourceSetCommandTimelineImage[] = [], state = { selectedClipId: 'raw-image-clip', readOnly: false };
	const controller = { project: f.project(), getSnapshot: () => state, actions: { edit: { commit(command: FramescaperImageSourceSetCommandTimelineImage) {
		commands.push(command); controller.project = applyFramescaperProjectCommand(PROFILE, controller.project, command);
	} } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: { loadMediaAsset: async () => f.body } });
	return { controller, state, commands, port: framescaperImageDevelopAuthoringForCurrentV1(controller)! };
}
async function ready(ui: Awaited<ReturnType<typeof mountPhotoImportUi>>) {
	await waitForView(() => ui.dom.container.querySelectorAll('[data-photo-repair-original]').some(node => node.getAttribute('data-state') === 'ready'), 'actual Source4 native Original editor is painted');
}
async function waitForView(predicate: () => boolean, description: string) {
	// Keep actual Worker completion and its React publications inside act,
	// including timer/immediate turns used while waiting for that completion.
	for (let turn = 0; turn < 1000; turn++) {
		await act(async () => { await settle(1, { delayMs: 2 }); }); if (predicate()) return;
	}
	assert.fail(`Timed out waiting for ${description}.`);
}
function button(ui: Awaited<ReturnType<typeof mountPhotoImportUi>>, label: string) {
	const node = ui.dom.container.querySelectorAll('button').filter(value => value.textContent === label).at(-1); assert.ok(node, label); return node;
}
async function click(ui: Awaited<ReturnType<typeof mountPhotoImportUi>>, label: string) {
	await act(async () => { reactProps(button(ui, label)).onClick?.({}); await settle(); });
}

for (const locale of ['en', 'de']) test(`${locale}: actual Frame owner routes Source4 native Original to numerical repair Apply without changing the RAW pack`, { timeout: 30_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1({ orientation: 6 }), boundary = canvasBoundary();
	try { await f.withDefaultTransport(async () => {
		const owner = selected(f), text = photoDevelopRepairSpotsCopy(locale); let closes = 0;
		const ui = await mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={owner.controller} kind="repairs" locale={locale} disabled={false} onClose={() => { closes++; }} />);
		try {
			await ready(ui); assert.ok(boundary.paintings.length > 0); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), true);
			const expected = f.native.words.map((word, index) => { if (index % 4 === 3) return 255; const v = word / 65535;
				return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)); });
			assert.deepEqual(boundary.paintings.at(-1), expected);
			for (const [label, value] of [[text.targetX, String(24.5 / 32)], [text.targetY, String(24.5 / 32)], [text.sourceX, String(8.5 / 32)],
				[text.sourceY, String(24.5 / 32)], [text.radius, '.0125'], [text.feather, '0'], [text.opacity, '1']] as const) {
				const node = ui.dom.container.querySelectorAll('input').find(item => item.getAttribute('aria-label') === label); assert.ok(node);
				await act(async () => { reactProps(node).onChange?.({ currentTarget: { value } }); await settle(); });
			}
			await click(ui, text.add); assert.equal(owner.commands.length, 0); await click(ui, text.apply);
			await waitForView(() => closes === 1, 'native repair Apply joins before dismissal');
			assert.equal(owner.commands.length, 1); const source = owner.controller.project.sources[0]!; assert.ok(source.kind === 'image' && source.schemaVersion === 4);
			assert.equal(source.develop.processVersion, 3); assert.deepEqual(source.raw, f.source.raw); assert.deepEqual(source.original, f.source.original);
			if (source.develop.processVersion !== 3) assert.fail('Native repaired recipe must remain process3.');
			assert.equal(source.develop.repairs.spots[0]!.mode, 'clone'); assert.equal(source.provenance.origin.schemaFamily, 'framescaper');
			assert.equal(source.contentSha256, f.source.contentSha256); assert.equal(videoPreviewAuthoringPausedV1(owner.controller), false);
			assert.deepEqual(new Uint8Array(await f.body.arrayBuffer()), f.pack.bytes);
		} finally { await ui.dispose(); }
	}); } finally { boundary.restore(); await f.close(); }
});

test('Current native repair Close joins held actual RAW validation despite source staleness and uses latest same-generation callback', { timeout: 30_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), boundary = canvasBoundary(), entered = deferred<void>(), release = deferred<void>();
	try { await f.withDefaultTransport(async () => {
		const host = selected(f), session = await host.port.open(), text = photoDevelopRepairSpotsCopy('en');
		let hold = false, current = true, oldCloses = 0, latestCloses = 0, applied = 0, nativeClosing: Promise<void> | undefined;
		const retirees = new Set<() => Promise<void>>();
		const original: WithImageRepairSpotsOriginalFrameV1 = (consume, options) => session.withOriginalFrame(async frame => {
			if (hold) { hold = false; entered.resolve(); await release.promise; } options?.signal?.throwIfAborted(); return consume(frame);
		}, options);
		let onClose = () => { oldCloses++; };
		const ui = await mountPhotoImportUi(() => <ImageRepairSpotsEditorV1 nativeCurrent develop={session.develop} withOriginalFrame={original} locale="en"
			isCurrent={() => current && session.isCurrent()} onApply={() => { applied++; }} onClose={onClose}
			registerRetirement={retire => { retirees.add(retire); return () => { retirees.delete(retire); }; }} />);
		try {
			await ready(ui); hold = true; await click(ui, text.apply); await entered.promise;
			current = false; onClose = () => { nativeClosing = Promise.allSettled([...retirees].map(retire => retire())).then(() => session.closeAndJoin()).then(() => { latestCloses++; }); };
			await ui.render(); await click(ui, text.close); assert.equal(latestCloses, 0); assert.equal(videoPreviewAuthoringPausedV1(host.controller), true);
			await act(async () => { release.resolve(); await settle(); }); await waitForView(() => latestCloses === 1, 'stale native editor hands joined Close to latest outer callback');
			await nativeClosing; assert.equal(oldCloses, 0); assert.equal(applied, 0); assert.equal(host.commands.length, 0); assert.equal(videoPreviewAuthoringPausedV1(host.controller), false);
		} finally { release.resolve(); await ui.dispose(); await nativeClosing; await session.closeAndJoin(); }
	}); } finally { release.resolve(); boundary.restore(); await f.close(); }
});

test('Current native repair failed Original retirement still hands Close to the outer Session after physical work joins', { timeout: 30_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), boundary = canvasBoundary(), opaque = Symbol('native-display-consumer-failure');
	try { await f.withDefaultTransport(async () => {
		const host = selected(f), session = await host.port.open(), text = photoDevelopRepairSpotsCopy('en'); let calls = 0, closed = false;
		let joining: Promise<void> | undefined; const retirement = new Set<() => Promise<void>>();
		const original: WithImageRepairSpotsOriginalFrameV1 = (consume, options) => session.withOriginalFrame(frame => { calls++; if (calls === 2) throw opaque; return consume(frame); }, options);
		const ui = await mountPhotoImportUi(() => <ImageRepairSpotsEditorV1 nativeCurrent develop={session.develop} withOriginalFrame={original} locale="en" isCurrent={() => session.isCurrent()}
			onApply={() => assert.fail('Failed native preview cannot publish.')} onClose={() => {
				joining = Promise.allSettled([...retirement].map(retire => retire())).then(async outcomes => { assert.ok(outcomes.some(value => value.status === 'rejected' && Object.is(value.reason, opaque))); await session.closeAndJoin(); closed = true; });
			}} registerRetirement={retire => { retirement.add(retire); return () => { retirement.delete(retire); }; }} />);
		try { await waitForView(() => ui.dom.container.querySelectorAll('[role="alert"]').length > 0, 'actual native borrowed display failure');
			assert.equal(Object.getOwnPropertyDescriptor(reactProps(button(ui, text.apply)), 'disabled')?.value, true);
			await click(ui, text.close); await waitForView(() => closed, 'failed native editor Close joins outer Session');
			await joining; assert.equal(host.commands.length, 0); assert.equal(videoPreviewAuthoringPausedV1(host.controller), false);
		} finally { await ui.dispose(); await joining; await session.closeAndJoin(); }
	}); } finally { boundary.restore(); await f.close(); }
});
