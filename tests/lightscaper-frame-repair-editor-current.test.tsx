/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ImageRepairSpotsAuthoringV1 } from '../src/common/editor/controller/shared/image-repair-spots-authoring-v1.ts';
import ImageRepairSpotsEditorV1 from '../src/common/editor/ui/dialogs/ImageRepairSpotsEditorV1.tsx';
import FramescaperImageDevelopDialogV1, { type FramescaperImageDevelopDialogPropsV1 } from '../src/common/editor/ui/dialogs/FramescaperImageDevelopDialogV1.tsx';
import FramescaperImageDevelopOwnerSurfaceV1 from '../src/common/editor/ui/dialogs/FramescaperImageDevelopOwnerSurfaceV1.tsx';
import { bindFramescaperImageDevelopAuthoringCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { registerVideoPreviewAuthoringParticipantV1, videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import type { ImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { photoDevelopRepairSpotsCopy } from '../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopMaskManagementCopy } from '../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

type Original = <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) => Promise<Result>;
interface NeutralProps {
	readonly withOriginalFrame: Original;
	readonly develop: ImageDevelopStateCurrentV1;
	readonly locale: string;
	readonly isCurrent: () => boolean;
	readonly onApply: (develop: Readonly<ImageDevelopStateV3>) => void;
	readonly onClose: () => void;
	readonly registerRetirement?: (retire: () => Promise<void>) => () => void;
}
function pixels() {
	const bytes = Array.from({ length: 33 }, (_, index) => { const x = index % 11, v = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0; return [v, v, v, 255]; }).flat();
	bytes.splice(12 * 4, 4, 64, 64, 64, 255); bytes.splice(16 * 4, 4, 192, 192, 192, 255); bytes.splice(20 * 4, 4, 0, 0, 0, 255); return bytes;
}
function original() {
	const borrowed: Uint8Array[] = [], entered = deferred<void>(), release = deferred<void>(); let hold = false, calls = 0;
	const read: Original = async (consume, options) => {
		calls++; const frame = rgbaFrame(pixels()); frame.descriptor = Object.freeze({ ...frame.descriptor, width: 11, height: 3 }); borrowed.push(frame.pixels);
		try { if (hold) { hold = false; entered.resolve(); await release.promise; } options?.signal?.throwIfAborted(); return await consume(frame); }
		finally { frame.pixels.fill(0); }
	};
	return { read, borrowed, entered, release, hold() { hold = true; }, calls: () => calls };
}
// UI/controller callback admission only. Actual Frame pack authentication and
// worker pixels are independently owned by the native reader/browser tests.
function paintBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(_value: unknown) {} }
	class Canvas { get width() { return 0; } set width(_value: number) {} get height() { return 0; } set height(_value: number) {} getContext() { return new Context(); } }
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return () => { for (const [index, key] of keys.entries()) { const saved = previous[index]; if (saved) Object.defineProperty(globalThis, key, saved); else Reflect.deleteProperty(globalThis, key); } };
}
async function editor(locale = 'en', frameDialog = false, develop: ImageDevelopStateCurrentV1 = defaultImageDevelopStateV2()) {
	const f = original(), restore = paintBoundary(), applied: Readonly<ImageDevelopStateV3>[] = [], retirees = new Set<() => Promise<void>>(); let closes = 0, current = true;
	const unchanged: Readonly<ImageDevelopStateCurrentV1>[] = [];
	const props: NeutralProps = { withOriginalFrame: f.read, develop, locale, isCurrent: () => current,
		onApply: value => { applied.push(value); }, onClose: () => { closes++; }, registerRetirement: retire => { retirees.add(retire); return () => { retirees.delete(retire); }; } };
	const mounted = await mountPhotoImportUi(() => frameDialog
		? <FramescaperImageDevelopDialogV1 {...props} kind="repairs" onApply={value => { unchanged.push(value); }} />
		: <ImageRepairSpotsEditorV1 {...props as unknown as React.ComponentProps<typeof ImageRepairSpotsEditorV1>} />)
		.catch((error: unknown) => { restore(); throw error; });
	const text = photoDevelopRepairSpotsCopy(locale), control = (label: string) => {
		const node = mounted.dom.container.querySelectorAll('input,select').find(value => value.getAttribute('aria-label') === label); assert.ok(node, label); return node;
	}, button = (label: string) => { const node = mounted.dom.container.querySelectorAll('button').filter(value => value.textContent === label).at(-1); assert.ok(node, label); return node; };
	const change = async (label: string, value: string) => { await act(async () => { reactProps(control(label)).onChange?.({ currentTarget: { value } }); await settle(); }); };
	const click = async (label: string) => { await act(async () => { reactProps(button(label)).onClick?.({}); await settle(); }); };
	const ready = async () => waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.one('canvas').getAttribute('data-state') === 'ready'; }, 'neutral Original paint joins');
	const add = async (mode: 'clone' | 'heal') => { for (const [label, value] of [[text.mode, mode], [text.targetX, String(9.5 / 11)], [text.targetY, '.5'],
		[text.sourceX, String(1.5 / 11)], [text.sourceY, '.5'], [text.radius, '.2'], [text.feather, '0'], [text.opacity, '1']]) await change(label!, value!); await click(text.add); };
	return { ...mounted, f, props, text, applied, unchanged, control, button, change, click, ready, add, closes: () => closes, retire() { current = false; },
		async dispose() { f.release.resolve(); const pending = [...retirees].map(retire => retire()); try { await mounted.dispose(); await Promise.all(pending); } finally { restore(); } } };
}

test('product-neutral repair owner accepts a bounded Original callback without granting or inventing a Photo identity', async () => {
	const f = original(), options = { withOriginalFrame: f.read, develop: defaultImageDevelopStateV2(), isCurrent: () => true };
	const owner = new ImageRepairSpotsAuthoringV1(options as unknown as ConstructorParameters<typeof ImageRepairSpotsAuthoringV1>[0]);
	try { await owner.open(); assert.equal(owner.snapshot().width, 11); assert.equal(owner.snapshot().height, 3);
		assert.deepEqual(Object.keys(options), ['withOriginalFrame', 'develop', 'isCurrent']); assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await owner.cancelAndJoin(); }
});

for (const locale of ['en', 'de']) test(`${locale}: product-neutral repair editor performs local Clone and screened Heal from numerical controls before explicit Apply`, async () => {
	for (const [mode, expected] of [['clone', 64], ['heal', 138]] as const) {
		const ui = await editor(locale);
		try { await ui.ready(); assert.equal(ui.control(ui.text.visualize).checked, false); await ui.add(mode); assert.equal(ui.applied.length, 0);
			await ui.click(ui.text.apply); assert.equal(ui.applied.length, 1); const develop = ui.applied[0]!; assert.equal(develop.processVersion, 3);
			const frame = rgbaFrame(pixels()); frame.descriptor = { ...frame.descriptor, width: 11, height: 3 };
			const output = await withImageDevelopFrameV3({ frame, develop }, result => [...result.frame.pixels], PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), expectedBytes = pixels();
			expectedBytes.splice(20 * 4, 4, expected, expected, expected, 255); assert.deepEqual(output, expectedBytes);
			assert.deepEqual(ui.props.develop, defaultImageDevelopStateV2()); assert.ok(ui.f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
		} finally { await ui.dispose(); }
	}
});

test('neutral Original source-handle pointer movement retains its content rectangle and discards cancellation before Apply', async () => {
	const ui = await editor();
	try { await ui.ready(); await ui.add('heal'); await ui.change(ui.text.tool, 'source'); const canvas = ui.dom.one('canvas');
		Reflect.set(canvas, 'getBoundingClientRect', () => ({ left: 10, top: 20, width: 440, height: 120 }));
		Reflect.set(canvas, 'setPointerCapture', () => undefined); Reflect.set(canvas, 'releasePointerCapture', () => undefined);
		const at = (x: number) => ({ currentTarget: canvas, pointerId: 1, button: 0, clientX: 10 + 440 * x, clientY: 80, preventDefault() {} });
		await act(async () => { reactProps(canvas).onPointerDown?.(at(1.5 / 11)); reactProps(canvas).onPointerMove?.(at(.5)); reactProps(canvas).onPointerCancel?.(at(.5)); });
		assert.equal(Number(ui.control(ui.text.sourceX).value), 1.5 / 11);
		await act(async () => { reactProps(canvas).onPointerDown?.(at(1.5 / 11)); reactProps(canvas).onPointerMove?.(at(.5)); reactProps(canvas).onPointerUp?.(at(.5)); });
		await ui.click(ui.text.apply); assert.equal(ui.applied[0]!.repairs.spots[0]!.source.x, .5);
	} finally { await ui.dispose(); }
});

test('neutral repair Close joins a held Original validation, blocks retained Apply and returns no local publication', async () => {
	const ui = await editor();
	try { await ui.ready(); await ui.add('heal'); const retained = reactProps(ui.button(ui.text.apply)).onClick;
		ui.f.hold(); await ui.click(ui.text.apply); await ui.f.entered.promise; await ui.click(ui.text.close);
		assert.equal(ui.closes(), 0); await act(async () => { retained?.({}); }); assert.equal(ui.applied.length, 0);
		ui.f.release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return ui.closes() === 1; }, 'neutral Close joins Original validation');
		assert.equal(ui.applied.length, 0); assert.ok(ui.f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await ui.dispose(); }
});

test('neutral repair owner joins its held consumer before Close and preserves the exact opaque native reason', async () => {
	const f = original(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Symbol('repair-cancel');
	const options = { withOriginalFrame: f.read, develop: defaultImageDevelopStateV2(), isCurrent: () => true, signal: stop.signal };
	const owner = new ImageRepairSpotsAuthoringV1(options as unknown as ConstructorParameters<typeof ImageRepairSpotsAuthoringV1>[0]);
	let work: Promise<unknown> | undefined;
	try { await owner.open(); work = owner.withOriginalFrame(async () => { entered.resolve(); await release.promise; }); void work.catch(() => undefined); await entered.promise;
		stop.abort(opaque); const closing = owner.cancelAndJoin(); assert.equal(owner.cancelAndJoin(), closing); assert.equal(await remainsPending(closing), true);
		release.resolve(); await assert.rejects(work, reason => Object.is(reason, opaque)); await closing;
		assert.ok(f.borrowed.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await work?.catch(() => undefined); await owner.cancelAndJoin(); }
});

test('Frame Repair Apply without changed spots preserves an exact legacy recipe and promotes only an authored repair', async () => {
	const before = defaultImageDevelopStateV1(), ui = await editor('en', true, before);
	try { await ui.ready(); await ui.click(ui.text.apply); assert.equal(ui.unchanged.length, 1); assert.equal(ui.unchanged[0], before);
		await ui.add('clone'); await ui.click(ui.text.apply); assert.equal(ui.unchanged.length, 2); assert.equal(ui.unchanged[1]?.processVersion, 3);
		if (ui.unchanged[1]?.processVersion !== 3) assert.fail('Authored repairs require the Current recipe.');
		assert.equal(ui.unchanged[1].repairs.spots[0]?.mode, 'clone');
	} finally { await ui.dispose(); }
});

for (const locale of ['en', 'de']) test(`${locale}: Frame mask editor renames a local graph before Apply and offers only supported presentation choices`, async () => {
	const text = photoDevelopMaskManagementCopy(locale), applied: ImageDevelopStateCurrentV1[] = [], original = defaultImageDevelopStateV2();
	const develop: ImageDevelopStateCurrentV1 = { ...original, masks: [{ schemaVersion: 1, id: 'gradient', kind: 'matte', inputs: [],
		nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }] };
	const props: FramescaperImageDevelopDialogPropsV1 = { kind: 'masks', develop, locale, withOriginalFrame: () => assert.fail('Mask names require no Original body.'),
		isCurrent: () => true, onApply: value => { applied.push(value); }, onClose: () => undefined };
	const mounted = await mountPhotoImportUi(() => <FramescaperImageDevelopDialogV1 {...props} />);
	try {
		assert.equal(mounted.dom.container.querySelectorAll('input').some(node => node.getAttribute('aria-label') === text.showOverlay), false);
		await mounted.event('[data-photo-develop-mask-name]', 'onChange', { currentTarget: { value: 'Native Frame gradient' } });
		await mounted.event('[data-photo-develop-mask-rename]', 'onClick'); assert.equal(applied.length, 0); assert.equal(develop.masks[0]?.schemaVersion, 1);
		const apply = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === text.apply); assert.ok(apply);
		await act(async () => { reactProps(apply).onClick?.({}); }); assert.equal(applied.length, 1);
		assert.equal(applied[0]!.masks[0]?.schemaVersion, 2);
		assert.equal(Reflect.get(applied[0]!.masks[0]!, 'name'), 'Native Frame gradient'); assert.deepEqual(applied[0]!.maskBindings, develop.maskBindings);
	} finally { await mounted.dispose(); }
});

// The Root port and preview suspension protocol are real. A held participant
// supplies this presentation barrier; this makes no video/decoder/body claim.
async function ownerFixture(participant: () => Promise<void>, strict = false) {
	const f = editableImageFixture(), project = f.project(), controller = { project,
		getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }), actions: { edit: { commit: () => assert.fail('Opening/Close must not write a project.') } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: f.store });
	const unregister = registerVideoPreviewAuthoringParticipantV1(controller, participant); let closes = 0;
	let onClose = () => { closes++; };
	const mounted = await mountPhotoImportUi(() => {
		const element = <FramescaperImageDevelopOwnerSurfaceV1 controller={controller} locale="en" kind="masks" disabled={false} onClose={onClose} />;
		return strict ? <React.StrictMode>{element}</React.StrictMode> : element;
	});
	const clickClose = async () => {
		const button = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === photoDevelopRepairSpotsCopy('en').close).at(-1); assert.ok(button);
		await act(async () => { reactProps(button).onClick?.({}); await settle(); });
	};
	return { ...mounted, controller, f, project, clickClose, closes: () => closes,
		async replaceOnClose(next: () => void) { onClose = next; await mounted.render(); },
		async dispose() { try { await mounted.dispose(); } finally { unregister(); } } };
}

test('Frame owner Close seals and joins its actual held preview-suspension open before dismissing or releasing the lease', async () => {
	const entered = deferred<void>(), release = deferred<void>(), ui = await ownerFixture(() => { entered.resolve(); return release.promise; });
	try { await entered.promise; assert.equal(videoPreviewAuthoringPausedV1(ui.controller), true); await ui.clickClose();
		assert.equal(ui.closes(), 0); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), true); assert.deepEqual(ui.f.calls, []);
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return ui.closes() === 1; }, 'the native pending open joins before owner dismissal');
		assert.equal(videoPreviewAuthoringPausedV1(ui.controller), false); assert.deepEqual(ui.controller.project, ui.project);
	} finally { release.resolve(); await ui.dispose(); }
});

test('Frame owner joined Close invokes the latest same-generation dismiss callback after an ordinary parent rerender', async () => {
	const entered = deferred<void>(), release = deferred<void>(), ui = await ownerFixture(() => { entered.resolve(); return release.promise; });
	let latestCloses = 0;
	const dismiss = function(this: { readonly onClose: () => void }) { assert.equal(this.onClose, dismiss); latestCloses++; };
	try {
		await entered.promise; await ui.clickClose(); assert.equal(ui.closes(), 0); assert.equal(latestCloses, 0);
		await ui.replaceOnClose(dismiss); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), true); assert.equal(latestCloses, 0);
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return latestCloses === 1; }, 'held native open joins before the latest parent callback dismisses');
		assert.equal(ui.closes(), 0); assert.equal(latestCloses, 1); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), false);
		assert.deepEqual(ui.controller.project, ui.project); assert.deepEqual(ui.f.calls, []);
	} finally { release.resolve(); await ui.dispose(); }
});

test('StrictMode Frame owner suppresses the cold replay and acquires only one usable native scope', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let calls = 0;
	const ui = await ownerFixture(() => { calls++; if (calls === 1) { entered.resolve(); return release.promise; } return Promise.resolve(); }, true);
	try { await entered.promise; assert.equal(calls, 1); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), true);
		release.resolve(); await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.container.querySelectorAll('[data-photo-develop-mask-manager]').length === 1; }, 'a genuinely reopened Frame mask editor after StrictMode retirement');
		assert.equal(calls, 1); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), true); assert.deepEqual(ui.f.calls, []);
		await ui.clickClose(); await waitFor(async () => { await act(async () => { await settle(); }); return ui.closes() === 1; }, 'the usable replacement owner closes');
		assert.equal(videoPreviewAuthoringPausedV1(ui.controller), false);
	} finally { release.resolve(); await ui.dispose(); }
});

test('Frame owner renders an opaque failed-open fallback without reflective coercion and permits joined Close', async () => {
	const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); const ui = await ownerFixture(() => Promise.reject(proxy));
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.container.querySelectorAll('[role="alert"]').length === 1; }, 'opaque native open failure scalar fallback');
		assert.equal(ui.dom.one('[role="alert"]').textContent, photoDevelopRepairSpotsCopy('en').failed); assert.equal(videoPreviewAuthoringPausedV1(ui.controller), false);
		await ui.clickClose(); await waitFor(async () => { await act(async () => { await settle(); }); return ui.closes() === 1; }, 'failed native open is terminal before Close');
		assert.deepEqual(ui.f.calls, []); assert.deepEqual(ui.controller.project, ui.project);
	} finally { await ui.dispose(); }
});
