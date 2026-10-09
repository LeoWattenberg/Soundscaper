/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoColorWheelControl, { normalizeVideoColorWheelValueV1, type VideoColorWheelValueV1 } from '../src/common/editor/ui/inspector/VideoColorWheelControl.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const messages = { hue: 'Hue', saturation: 'Saturation', luminance: 'Luminance', exact: 'Exact value', reset: 'Reset wheel',
	instructions: 'Left and right change hue; up and down change saturation; Home removes color.', invalid: 'Enter a value within the wheel bounds.' };
const zero = (): VideoColorWheelValueV1 => ({ hue: 0, saturation: 0, luminance: 0 });
const bounds = { left: 20, top: 40, width: 200, height: 200 };
const key = (name: string, shiftKey = false) => ({ key: name, shiftKey, preventDefault() {}, stopPropagation() {} });

test('polar pointer capture authors exact hue/saturation and commits one controlled gesture', async () => {
	let value = zero(), begins = 0, commits = 0, captures = 0, releases = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => { begins++; }} onPreview={next => { value = next; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
	const target = { getBoundingClientRect: () => bounds, setPointerCapture: () => { captures++; }, releasePointerCapture: () => { releases++; } };
	try {
		const wheel = mounted.dom.one('[data-video-color-wheel]');
		await act(async () => { reactProps(wheel).onPointerDown?.({ currentTarget: target, pointerId: 4, button: 0, clientX: 220, clientY: 140, preventDefault() {} }); });
		assert.deepEqual(value, { hue: 0, saturation: 100, luminance: 0 }); assert.ok(Object.isFrozen(value));
		await mounted.render();
		await act(async () => { reactProps(wheel).onPointerMove?.({ currentTarget: target, pointerId: 4, clientX: 120, clientY: 40, preventDefault() {} }); });
		assert.deepEqual(value, { hue: -90, saturation: 100, luminance: 0 });
		await mounted.render(); await act(async () => { reactProps(wheel).onPointerUp?.({ currentTarget: target, pointerId: 4 }); });
		assert.equal(begins, 1); assert.equal(commits, 1); assert.equal(captures, 1); assert.equal(releases, 1);
		assert.equal(wheel.getAttribute('aria-valuenow'), '100'); assert.match(wheel.getAttribute('aria-valuetext') ?? '', /-90/);
	} finally { await mounted.dispose(); }
});

test('keyboard axes wrap hue, bound radius, preserve luminance and reset all three controlled scalars', async () => {
	let value: VideoColorWheelValueV1 = { hue: 179, saturation: 95, luminance: -20 }, commits = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Midtones" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={next => { value = next; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
	try {
		const wheel = mounted.dom.one('[data-video-color-wheel]');
		await act(async () => { reactProps(wheel).onKeyDown?.(key('ArrowRight', true)); });
		assert.deepEqual(value, { hue: -171, saturation: 95, luminance: -20 }); await mounted.render();
		await act(async () => { reactProps(wheel).onKeyDown?.(key('ArrowUp', true)); });
		assert.deepEqual(value, { hue: -171, saturation: 100, luminance: -20 }); await mounted.render();
		await act(async () => { reactProps(wheel).onKeyDown?.(key('Home')); });
		assert.deepEqual(value, { hue: -171, saturation: 0, luminance: -20 }); await mounted.render();
		await act(async () => { reactProps(mounted.dom.one('button')).onClick?.({}); });
		assert.deepEqual(value, zero()); assert.equal(commits, 4);
	} finally { await mounted.dispose(); }
});

test('exact numeric fields reject out-of-bound previews and cancel the invalid gesture on Enter', async () => {
	let value = zero(), previews = 0, commits = 0, cancels = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Highlights" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={next => { value = next; previews++; }} onCommit={() => { commits++; }} onCancel={() => { cancels++; }} />);
	try {
		const numeric = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === 'Exact value: Highlights: Luminance'); assert.ok(numeric);
		await act(async () => { reactProps(numeric).onFocus?.({}); reactProps(numeric).onChange?.({ currentTarget: { value: '101', valueAsNumber: 101 } }); });
		assert.equal(previews, 0); assert.equal(mounted.dom.one('[role="alert"]').textContent, messages.invalid);
		await mounted.render(); await act(async () => { reactProps(numeric).onKeyDown?.(key('Enter')); });
		assert.equal(cancels, 1); assert.equal(commits, 0); assert.deepEqual(value, zero());
		await mounted.render(); await act(async () => { reactProps(numeric).onFocus?.({}); reactProps(numeric).onChange?.({ currentTarget: { value: '-12.5', valueAsNumber: -12.5 } }); });
		await mounted.render(); await act(async () => { reactProps(numeric).onKeyDown?.(key('Enter')); });
		assert.deepEqual(value, { hue: 0, saturation: 0, luminance: -12.5 }); assert.equal(commits, 1);
	} finally { await mounted.dispose(); }
});

test('cancel joins the captured gesture, foreign pointers refuse and lost capture cannot commit it later', async () => {
	let previews = 0, commits = 0, cancels = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={() => { previews++; }} onCommit={() => { commits++; }} onCancel={() => { cancels++; }} />);
	const target = { getBoundingClientRect: () => bounds, setPointerCapture() {}, releasePointerCapture() {} };
	try {
		const wheel = mounted.dom.one('[data-video-color-wheel]'), events = reactProps(wheel);
		await act(async () => { events.onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} });
			events.onPointerMove?.({ currentTarget: target, pointerId: 2, clientX: 220, clientY: 140, preventDefault() {} }); });
		assert.equal(previews, 1);
		await act(async () => { events.onPointerCancel?.({ pointerId: 1 }); events.onPointerUp?.({ currentTarget: target, pointerId: 1 }); });
		assert.equal(cancels, 1); assert.equal(commits, 0);
		await act(async () => { events.onPointerDown?.({ currentTarget: target, pointerId: 3, button: 0, clientX: 170, clientY: 140, preventDefault() {} });
			events.onLostPointerCapture?.({ pointerId: 3 }); });
		assert.equal(cancels, 2); assert.equal(commits, 0);
	} finally { await mounted.dispose(); }
});

test('disabled, retired rendered bindings and unmounted handlers cannot publish or cancel a later gesture', async () => {
	let disabled = false, current = true, previews = 0, cancels = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={disabled}
		isCurrent={() => current} onBegin={() => undefined} onPreview={() => { previews++; }} onCommit={() => undefined} onCancel={() => { cancels++; }} />);
	const old = reactProps(mounted.dom.one('[data-video-color-wheel]'));
	try {
		disabled = true; await mounted.render(); await act(async () => { old.onKeyDown?.(key('ArrowUp')); }); assert.equal(previews, 0);
		disabled = false; await mounted.render(); await act(async () => { old.onKeyDown?.(key('ArrowUp')); }); assert.equal(previews, 0);
		current = false; const fresh = reactProps(mounted.dom.one('[data-video-color-wheel]'));
		await act(async () => { fresh.onKeyDown?.(key('ArrowUp')); }); assert.equal(previews, 0);
	} finally { await mounted.dispose(); }
	old.onKeyDown?.(key('ArrowUp')); old.onPointerCancel?.({ pointerId: 1 }); assert.equal(previews, 0); assert.equal(cancels, 0);
});

test('a held gesture cancels its captured owner once on disable and stale cancellation cannot retire its replacement', async () => {
	let disabled = false, owner = 'first', first = 0, second = 0;
	const mounted = await mountPhotoImportUi(() => {
		const captured = owner;
		return <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={disabled}
			isCurrent={() => true} onBegin={() => undefined} onPreview={() => undefined} onCommit={() => undefined}
			onCancel={() => { if (captured === 'first') first++; else second++; }} />;
	});
	const target = { getBoundingClientRect: () => bounds, setPointerCapture() {}, releasePointerCapture() {} };
	try {
		const wheel = mounted.dom.one('[data-video-color-wheel]'), old = reactProps(wheel);
		await act(async () => { old.onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} }); });
		disabled = true; owner = 'second'; await mounted.render(); assert.equal(first, 1); assert.equal(second, 0);
		disabled = false; await mounted.render(); const next = reactProps(wheel);
		await act(async () => { next.onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} });
			old.onPointerCancel?.({ pointerId: 1 }); }); assert.equal(second, 0);
	} finally { await mounted.dispose(); }
	assert.equal(first, 1); assert.equal(second, 1);
});

test('host gesture callback reentry cannot admit a second interaction or replace the owning preview', async () => {
	let previews = 0, begins = 0, commits = 0, value = zero(), reenter: (() => void) | undefined;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => { begins++; reenter?.(); }} onPreview={next => { previews++; value = next; }}
		onCommit={() => { commits++; }} onCancel={() => undefined} />);
	try {
		const handler = reactProps(mounted.dom.one('[data-video-color-wheel]')).onKeyDown!;
		reenter = () => { handler(key('ArrowUp')); };
		await act(async () => { handler(key('ArrowRight')); });
		assert.deepEqual(value, { hue: 1, saturation: 0, luminance: 0 }); assert.equal(begins, 1); assert.equal(previews, 1); assert.equal(commits, 1);
	} finally { await mounted.dispose(); }
});

test('native capture release failure still joins captured cancellation and preserves both opaque failures', async () => {
	let cancels = 0, inspections = 0;
	const primary = new Proxy({}, { getPrototypeOf() { inspections++; throw new Error('Opaque release was inspected.'); } });
	const cleanup = new Proxy({}, { get() { inspections++; throw new Error('Opaque cancellation was inspected.'); } });
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={() => undefined} onCommit={() => undefined} onCancel={() => { cancels++; throw cleanup; }} />);
	const target = { getBoundingClientRect: () => bounds, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() { throw primary; } };
	try {
		const events = reactProps(mounted.dom.one('[data-video-color-wheel]'));
		await act(async () => { events.onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} }); });
		let failure: unknown;
		await act(async () => { try { events.onPointerCancel?.({ pointerId: 1 }); } catch (error) { failure = error; } });
		assert.equal(cancels, 1); assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], primary);
		assert.equal(failure.errors[1], cleanup); assert.equal(failure.cause, cleanup); assert.equal(inspections, 0);
	} finally { await mounted.dispose(); }
});

test('pointer capture or host preview failure preserves its opaque primary beside retirement failure', async () => {
	for (const stage of ['capture', 'preview'] as const) {
		let inspections = 0, cancels = 0;
		const opaque = () => new Proxy({}, { get() { inspections++; throw Error(); }, getPrototypeOf() { inspections++; throw Error(); } });
		const primary = opaque(), cleanup = opaque();
		const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={false}
			isCurrent={() => true} onBegin={() => undefined} onPreview={() => { if (stage === 'preview') throw primary; }}
			onCommit={() => undefined} onCancel={() => { cancels++; }} />);
		const target = { getBoundingClientRect: () => bounds, hasPointerCapture: () => true,
			setPointerCapture() { if (stage === 'capture') throw primary; }, releasePointerCapture() { throw cleanup; } };
		try {
			let failure: unknown;
			await act(async () => { try { reactProps(mounted.dom.one('[data-video-color-wheel]')).onPointerDown?.({ currentTarget: target,
				pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} }); } catch (error) { failure = error; } });
			assert.equal(failure === cleanup, false, 'Retirement must not replace the original pointer failure.');
			assert.ok(failure instanceof AggregateError); assert.equal(failure.errors[0], primary); assert.equal(failure.errors[1], cleanup);
			assert.equal(failure.cause, cleanup); assert.equal(cancels, 1); assert.equal(inspections, 0);
		} finally { await mounted.dispose(); }
	}
});

test('synchronous native capture and release reentry cannot publish another interaction before settlement', async () => {
	for (const stage of ['capture', 'release'] as const) {
		let previews = 0, begins = 0, commits = 0, reenter: (() => void) | undefined;
		const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={zero()} messages={messages} disabled={false}
			isCurrent={() => true} onBegin={() => { begins++; }} onPreview={() => { previews++; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
		const target = { getBoundingClientRect: () => bounds, hasPointerCapture: () => true,
			setPointerCapture() { if (stage === 'capture') reenter?.(); }, releasePointerCapture() { if (stage === 'release') reenter?.(); } };
		try {
			const events = reactProps(mounted.dom.one('[data-video-color-wheel]'));
			reenter = () => { if (stage === 'capture') events.onPointerMove?.({ currentTarget: target, pointerId: 1, clientX: 220, clientY: 140, preventDefault() {} });
				else events.onKeyDown?.(key('ArrowUp')); };
			await act(async () => { events.onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 170, clientY: 140, preventDefault() {} });
				events.onPointerUp?.({ currentTarget: target, pointerId: 1 }); });
			assert.equal(previews, 1); assert.equal(begins, 1); assert.equal(commits, 1);
		} finally { await mounted.dispose(); }
	}
});

test('the first pointer drag after an exact numeric edit settles that field before capturing the new wheel gesture', async () => {
	let value = zero(), begins = 0, commits = 0, captures = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => { begins++; }} onPreview={next => { value = next; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
	try {
		const number = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === 'Exact value: Shadows: Hue'); assert.ok(number);
		await act(async () => { reactProps(number).onFocus?.({}); reactProps(number).onChange?.({ currentTarget: { value: '20', valueAsNumber: 20 } }); });
		await mounted.render();
		const target = { getBoundingClientRect: () => bounds, setPointerCapture() { captures++; }, releasePointerCapture() {},
			focus() { reactProps(number).onBlur?.({}); } };
		const wheel = mounted.dom.one('[data-video-color-wheel]');
		await act(async () => { reactProps(wheel).onPointerDown?.({ currentTarget: target, pointerId: 1, button: 0, clientX: 220, clientY: 140, preventDefault() {} }); });
		assert.equal(captures, 1); assert.equal(begins, 2); assert.equal(commits, 1); assert.deepEqual(value, { hue: 0, saturation: 100, luminance: 0 });
		await mounted.render(); await act(async () => { reactProps(wheel).onPointerUp?.({ currentTarget: target, pointerId: 1 }); });
		assert.equal(commits, 2);
	} finally { await mounted.dispose(); }
});

test('a new pointer gesture derives from settled original values after canceling an invalid numeric preview', async () => {
	let value = zero(), cancels = 0;
	const mounted = await mountPhotoImportUi(() => <VideoColorWheelControl label="Shadows" value={value} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={next => { value = next; }} onCommit={() => undefined}
		onCancel={() => { cancels++; value = zero(); }} />);
	try {
		const number = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === 'Exact value: Shadows: Luminance'); assert.ok(number);
		await act(async () => { reactProps(number).onFocus?.({}); reactProps(number).onChange?.({ currentTarget: { value: '20', valueAsNumber: 20 } }); });
		await mounted.render(); await act(async () => { reactProps(number).onChange?.({ currentTarget: { value: '101', valueAsNumber: 101 } }); });
		await mounted.render();
		const target = { getBoundingClientRect: () => bounds, setPointerCapture() {}, releasePointerCapture() {}, focus() { reactProps(number).onBlur?.({}); } };
		await act(async () => { reactProps(mounted.dom.one('[data-video-color-wheel]')).onPointerDown?.({ currentTarget: target,
			pointerId: 1, button: 0, clientX: 220, clientY: 140, preventDefault() {} }); });
		assert.equal(cancels, 1); assert.deepEqual(value, { hue: 0, saturation: 100, luminance: 0 });
	} finally { await mounted.dispose(); }
});

test('closed finite-value admission detaches data and refuses getters, extras, coercion and every axis bound', () => {
	const source = { hue: 12.25, saturation: 50, luminance: -0 }, result = normalizeVideoColorWheelValueV1(source);
	source.hue = 90; assert.deepEqual(result, { hue: 12.25, saturation: 50, luminance: 0 }); assert.ok(Object.isFrozen(result));
	let reads = 0; const accessor = { ...zero(), get hue() { reads++; return 0; } };
	assert.throws(() => normalizeVideoColorWheelValueV1(accessor)); assert.equal(reads, 0);
	for (const value of [{ ...zero(), future: 1 }, { ...zero(), hue: '1' }, { ...zero(), hue: 181 }, { ...zero(), hue: -181 },
		{ ...zero(), saturation: -1 }, { ...zero(), saturation: 101 }, { ...zero(), luminance: -101 }, { ...zero(), luminance: 101 }, { ...zero(), hue: NaN }]) {
		assert.throws(() => normalizeVideoColorWheelValueV1(value));
	}
});
