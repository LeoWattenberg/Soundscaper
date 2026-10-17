/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoCurveControl from '../src/common/editor/ui/inspector/VideoCurveControl.tsx';
import type { VideoCurvePointsV1 } from '../src/common/editor/video-curve-types-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const messages = { addPoint: 'Add point', removePoint: 'Remove point', input: 'Input', output: 'Output', invalid: 'Invalid curve points' };
const initial = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];

test('opted-in curve control authors bounded dimensionless coordinates with complete array gestures', async () => {
	let points: VideoCurvePointsV1 = initial(), previews = 0, commits = 0;
	const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Master" points={points} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={next => { points = next; previews++; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
	try {
		const add = mounted.dom.one('button'); await act(async () => { reactProps(add).onClick?.({}); }); await mounted.render();
		assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
		assert.equal(commits, 1); assert.ok(Object.isFrozen(points));
		const input = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === 'Master: Output 2'); assert.ok(input);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: '0.25', valueAsNumber: 0.25 } }); });
		await mounted.render(); await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		assert.equal(points[1]!.y, 0.25); assert.equal(previews, 2); assert.equal(commits, 2);
		const remove = mounted.dom.container.querySelectorAll('button').find(value => value.getAttribute('aria-label') === 'Remove point: Master 2'); assert.ok(remove);
		await act(async () => { reactProps(remove).onClick?.({}); }); assert.deepEqual(points, initial());
	} finally { await mounted.dispose(); }
});

test('invalid crossing coordinates retain the last canonical array and explain the bounded refusal', async () => {
	const points = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]; let previews = 0;
	const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Red" points={points} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => undefined} onPreview={() => { previews++; }} onCommit={() => undefined} onCancel={() => undefined} />);
	try {
		const input = mounted.dom.container.querySelectorAll('input').find(value => value.getAttribute('aria-label') === 'Red: Input 2'); assert.ok(input);
		await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: '0', valueAsNumber: 0 } }); });
		assert.equal(previews, 0); assert.deepEqual(points.map(point => point.x), [0, 0.5, 1]);
		assert.equal(mounted.dom.one('[role="alert"]').textContent, messages.invalid);
		assert.equal(mounted.dom.container.querySelectorAll('input')[0]!.hasAttribute('disabled'), true);
	} finally { await mounted.dispose(); }
});

test('retained handlers have no authority after disable/replacement/unmount, and the32-point limit applies before callbacks', async () => {
	let disabled = false, previews = 0, points: VideoCurvePointsV1 = initial();
	const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Blue" points={points} messages={messages} disabled={disabled}
		isCurrent={() => true} onBegin={() => undefined} onPreview={() => { previews++; }} onCommit={() => undefined} onCancel={() => undefined} />);
	const retained = reactProps(mounted.dom.one('button')).onClick!;
	try {
		disabled = true; await mounted.render(); await act(async () => { retained({}); }); assert.equal(previews, 0);
		disabled = false; points = Array.from({ length: 32 }, (_, n) => ({ x: n / 31, y: n / 31 })); await mounted.render();
		const full = mounted.dom.one('button'); assert.equal(full.hasAttribute('disabled'), true);
		await act(async () => { reactProps(full).onClick?.({}); }); assert.equal(previews, 0);
	} finally { await mounted.dispose(); }
	retained({}); assert.equal(previews, 0);
});

for (const phase of ['begin', 'preview']) test(`synchronous host retirement during ${phase} prevents subsequent curve gesture callbacks`, async () => {
		let current = true, previews = 0, commits = 0;
		const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Master" points={initial()} messages={messages} disabled={false}
			isCurrent={() => current} onBegin={() => { if (phase === 'begin') current = false; }}
			onPreview={() => { previews++; if (phase === 'preview') current = false; }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
		try {
			await act(async () => { reactProps(mounted.dom.one('button')).onClick?.({}); });
			assert.equal(previews, phase === 'begin' ? 0 : 1); assert.equal(commits, 0);
		} finally { await mounted.dispose(); }
});

for (const phase of ['begin', 'preview']) test(`curve ${phase} callback reentry cannot start a second discrete gesture`, async () => {
	let begins = 0, previews = 0, commits = 0, reentered = false, repeat = () => undefined;
	const reenter = () => { if (!reentered) { reentered = true; repeat(); } };
	const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Master" points={initial()} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={() => { begins++; if (phase === 'begin') reenter(); }}
		onPreview={() => { previews++; if (phase === 'preview') reenter(); }} onCommit={() => { commits++; }} onCancel={() => undefined} />);
	try {
		const click = reactProps(mounted.dom.one('button')).onClick!; repeat = () => { click({}); };
		await act(async () => { click({}); }); assert.equal(begins, 1); assert.equal(previews, 1); assert.equal(commits, 1);
	} finally { await mounted.dispose(); }
});

test('a complete discrete curve edit uses one acknowledged callback and excludes callback reentry', async () => {
	let changes = 0, points: VideoCurvePointsV1 = initial(), repeat = () => undefined;
	const unexpected = () => { throw new Error('The complete edit must not borrow preview gesture callbacks.'); };
	const mounted = await mountPhotoImportUi(() => <VideoCurveControl label="Master" points={points} messages={messages} disabled={false}
		isCurrent={() => true} onBegin={unexpected} onPreview={unexpected} onCommit={unexpected} onCancel={unexpected}
		onChange={next => { points = next; changes++; repeat(); }} />);
	try {
		const click = reactProps(mounted.dom.one('button')).onClick!; repeat = () => { click({}); };
		await act(async () => { click({}); }); assert.equal(changes, 1);
		assert.deepEqual(points, [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]); assert.ok(Object.isFrozen(points));
	} finally { await mounted.dispose(); }
});
