/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { armElectronEditingCompletion } from '../scripts/performance/electron-editing-completion.ts';

interface Metrics { start: number | null; finished: boolean; completion: number | null; durationMs?: number }
interface PaintPlan { sourceId: string; waveformIdentity: string }

let paintId = 0;
function freshPaint(): PaintPlan {
	paintId += 1;
	return { sourceId: `source-${String(paintId)}`, waveformIdentity: `audio-${String(paintId)}` };
}

class FakeElement {
	dataset: Record<string, string> = {};
	textContent = 'Apply';
	closest(): FakeElement { return this; }
}
class FakeCanvas extends FakeElement {
	__kwWaveformPlan: PaintPlan | undefined;
	constructor(plan: PaintPlan | undefined = freshPaint()) {
		super(); this.__kwWaveformPlan = plan; this.dataset.waveformRenderer = 'audacity';
	}
}

function probe(canvases: FakeCanvas[] = [new FakeCanvas()]) {
	let time = 1, surfaceVisible = true, state = 'working';
	let scheduled: ((timestamp: number) => void)[] = [];
	let changed: (() => void) | undefined;
	let click: ((event: { target: FakeElement }) => void) | undefined;
	let disconnected = false;
	const context = {
		__editingPerformance: undefined as Metrics | undefined,
		Element: FakeElement, HTMLCanvasElement: FakeCanvas,
		performance: { now: () => time },
		requestAnimationFrame(callback: (timestamp: number) => void) { scheduled.push(callback); return scheduled.length; },
		PerformanceObserver: class {
			observe() { /* Inert deterministic observer. */ }
			disconnect() { /* Inert deterministic observer. */ }
		},
		MutationObserver: class {
			constructor(callback: () => void) { changed = callback; }
			observe() { /* Explicit mutations below drive the observer. */ }
			disconnect() { disconnected = true; }
		},
		document: {
			body: {},
			querySelector(selector: string) {
				if (selector === '[data-operation-dialog]') return surfaceVisible ? {} : null;
				if (selector === '[data-status]') return { dataset: { state } };
				if (selector === '[data-waveform-pending="true"]') return canvases.find(canvas => canvas.dataset.waveformPending === 'true') ?? null;
				return null;
			},
			querySelectorAll() { return canvases; },
			addEventListener(_name: string, callback: typeof click) { click = callback; },
			removeEventListener() { click = undefined; },
		},
	};
	// This reproduces Playwright's function serialization: no module lexical
	// bindings or transpilation helpers are available in the browser context.
	runInNewContext(`(${armElectronEditingCompletion.toString()})({buttonLabel:'Apply',surface:'[data-operation-dialog]'})`, context);
	return {
		canvases,
		click() { click?.({ target: new FakeElement() }); },
		ready() { surfaceVisible = false; state = 'success'; changed?.(); },
		mutation() { changed?.(); },
		status(value: string) { state = value; changed?.(); },
		dialog(visible: boolean) { surfaceVisible = visible; changed?.(); },
		frame() { time += 16; const callbacks = scheduled; scheduled = []; for (const callback of callbacks) callback(time); },
		get metrics() { assert.ok(context.__editingPerformance); return context.__editingPerformance; },
		get disconnected() { return disconnected; },
	};
}

test('Electron completion rejects the prior successful canvas until a fresh operation paint', () => {
	const p = probe(); p.click(); p.ready(); p.frame(); p.frame();
	assert.equal(p.metrics.finished, false, 'old renderer markers cannot complete the new operation');
	p.canvases[0]!.__kwWaveformPlan = freshPaint(); p.mutation(); p.frame(); p.frame();
	assert.equal(p.metrics.finished, true); assert.equal(p.disconnected, true);
});

test('Electron completion rechecks pending state at the first and second frame boundaries', () => {
	for (const boundary of [1, 2]) {
		const p = probe([]); p.click(); p.canvases.push(new FakeCanvas()); p.ready();
		if (boundary === 2) p.frame();
		p.canvases[0]!.dataset.waveformPending = 'true'; p.frame(); p.frame();
		assert.equal(p.metrics.finished, false, `pending appeared at boundary${String(boundary)}`);
		delete p.canvases[0]!.dataset.waveformPending; p.mutation(); p.frame(); p.frame();
		assert.equal(p.metrics.finished, true);
	}
});

test('Electron completion restarts both frame boundaries after a canvas is replaced', () => {
	const p = probe([]); p.click(); p.canvases.push(new FakeCanvas()); p.ready(); p.frame();
	p.canvases.splice(0, 1, new FakeCanvas()); p.frame();
	assert.equal(p.metrics.finished, false, 'detached qualification cannot complete a replacement canvas');
	p.frame(); assert.equal(p.metrics.finished, false, 'replacement requires two frames');
	p.frame(); assert.equal(p.metrics.finished, true);
});

test('Electron completion admits a first blank generator canvas after a successful fresh paint', () => {
	const p = probe([]); p.click(); p.ready(); p.frame(); p.frame();
	assert.equal(p.metrics.finished, false);
	p.canvases.push(new FakeCanvas()); p.mutation(); p.frame();
	assert.equal(p.metrics.finished, false); p.frame();
	assert.equal(p.metrics.finished, true); assert.equal(p.metrics.durationMs, 64);
});

test('Electron completion snapshots audio identity and rejects old-audio redraws or remounts', () => {
	for (const remount of [false, true]) {
		const original = freshPaint(), identity = original.waveformIdentity;
		const p = probe([new FakeCanvas(original)]); p.click();
		original.waveformIdentity = 'mutated-after-click';
		const oldAudio = { sourceId: original.sourceId, waveformIdentity: identity };
		if (remount) p.canvases.splice(0, 1, new FakeCanvas(oldAudio));
		else p.canvases[0]!.__kwWaveformPlan = oldAudio;
		p.ready(); p.frame(); p.frame(); assert.equal(p.metrics.finished, false);
		p.canvases[0]!.__kwWaveformPlan = freshPaint(); p.mutation(); p.frame(); p.frame();
		assert.equal(p.metrics.finished, true);
	}
});

test('Electron completion rejects errors, nonsuccess status and a reopened operation dialog', () => {
	for (const blocker of ['error', 'status', 'dialog']) {
		for (const boundary of [1, 2]) {
			const p = probe([]); p.click(); p.canvases.push(new FakeCanvas()); p.ready();
			if (boundary === 2) p.frame();
			if (blocker === 'error') { p.canvases[0]!.dataset.waveformError = 'paint failed'; p.mutation(); }
			else if (blocker === 'status') p.status('working');
			else p.dialog(true);
			p.frame(); p.frame(); assert.equal(p.metrics.finished, false, blocker);
			delete p.canvases[0]!.dataset.waveformError; p.status('success'); p.dialog(false);
			p.frame(); assert.equal(p.metrics.finished, false); p.frame();
			assert.equal(p.metrics.finished, true);
		}
	}
});
