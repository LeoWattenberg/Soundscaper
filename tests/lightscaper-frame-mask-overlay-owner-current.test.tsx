/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperImageDevelopOwnerSurfaceV1 from '../src/common/editor/ui/dialogs/FramescaperImageDevelopOwnerSurfaceV1.tsx';
import { bindFramescaperImageDevelopAuthoringCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';
import { videoPreviewAuthoringPausedV1 } from '../src/common/editor/controller/clip-video/video-preview-authoring-suspension-v1.ts';
import { photoDevelopRepairSpotsCopy } from '../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

// Native selected-session admission and preview suspension are real. The failed
// pack read is deliberate; no canvas, decoder, pixel or body-retirement claim.
async function fixture(hold = false) {
	const canvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	// Model only retirement of empty targets; the failed native pack read never
	// produces a plane. Independent physical canvas proof belongs to browsers.
	class EmptyCanvas {
		get width() { return 0; } set width(value: number) { assert.equal(value, 0); }
		get height() { return 0; } set height(value: number) { assert.equal(value, 0); }
	}
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: EmptyCanvas });
	const restore = () => { if (canvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', canvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement'); };
	const f = editableImageFixture(), project = f.project(), baseline = structuredClone(project), entered = deferred<void>(), release = deferred<void>();
	const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
	let calls = 0, closes = 0;
	const store = { async loadMediaAsset(key: string): Promise<Blob> {
		assert.equal(this, store); assert.equal(key, f.source.storageKey); calls++; entered.resolve();
		if (hold) await release.promise;
		throw proxy;
	} };
	const controller = { project, getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }),
		actions: { edit: { commit: () => assert.fail('A failed preview or Close must not publish.') } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store });
	const mounted = await mountPhotoImportUi(() => <FramescaperImageDevelopOwnerSurfaceV1 controller={controller} locale="en"
		kind="masks" disabled={false} onClose={() => { closes++; }} />).catch((error: unknown) => { restore(); throw error; });
	const clickClose = async () => {
		const button = mounted.dom.container.querySelectorAll('button').filter(node => node.textContent === photoDevelopRepairSpotsCopy('en').close).at(-1);
		assert.ok(button); await act(async () => { reactProps(button).onClick?.({}); await settle(); });
	};
	const joined = () => waitFor(async () => { await act(async () => { await settle(); }); return closes === 1; }, 'failed presentation and native selected owner both join before dismissal');
	return { ...mounted, controller, project: baseline, entered, release, clickClose, joined, calls: () => calls, closes: () => closes,
		async dispose() { release.resolve(); try { await mounted.dispose(); } finally { restore(); } } };
}

test('failed native Frame mask preview preserves its scalar diagnostic and still joins selected-owner Close before dismissal', async () => {
	const f = await fixture();
	try {
		await f.entered.promise;
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.container.querySelectorAll('[role="alert"]').length === 1; }, 'opaque native preview failure');
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), true); assert.equal(f.closes(), 0);
		await f.clickClose(); await f.joined();
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); assert.deepEqual(f.controller.project, f.project); assert.equal(f.calls(), 1);
		assert.equal(f.dom.one('[role="alert"]').textContent, photoDevelopRepairSpotsCopy('en').failed);
		await f.clickClose(); assert.equal(f.closes(), 1);
	} finally { await f.dispose(); }
});

test('Close waits for a held native mask read even when that read fails after cancellation, and dismisses exactly once', async () => {
	const f = await fixture(true);
	try {
		await f.entered.promise; await f.clickClose(); await f.clickClose();
		assert.equal(f.closes(), 0); assert.equal(videoPreviewAuthoringPausedV1(f.controller), true);
		assert.deepEqual(f.controller.project, f.project); f.release.resolve(); await f.joined();
		assert.equal(videoPreviewAuthoringPausedV1(f.controller), false); assert.deepEqual(f.controller.project, f.project); assert.equal(f.calls(), 1);
	} finally { await f.dispose(); }
});
