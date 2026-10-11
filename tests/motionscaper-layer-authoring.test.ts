/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createAuthoredMotionLayer, type MotionLayerDraft } from '../src/motionscaper/editor-layer-authoring.ts';

const composition = createMotionscaperProject({ id: 'p', compositionId: 'c', title: 'Test', width: 640, height: 360 }).compositions[0]!;
const draft: MotionLayerDraft = { kind: 'rectangle', name: 'Card', x: 12, y: 34, width: 200, height: 100, color: '#808080', opacity: 50, text: '', fontSize: 48 };

test('authored motion shapes keep editable geometry, linear color and independent alpha', () => {
	const layer = createAuthoredMotionLayer('card', composition, draft);
	assert.equal(layer.kind, 'shapes');
	assert.deepEqual(layer.transform.position.value, [12, 34, 0]);
	assert.equal(layer.transform.opacity.value, 0.5);
	if (layer.kind !== 'shapes') return;
	assert.deepEqual(layer.shapes[0]!.path.value.vertices.map(({ point }) => point), [[0, 0], [200, 0], [200, 100], [0, 100]]);
	const fill = layer.shapes[0]!.fill!;
	assert.equal(fill.kind, 'color');
	if (fill.kind === 'color') assert.ok(Math.abs(fill.value[0] - 0.2158605) < 1e-6);
	assert.deepEqual(layer.outFrame, { num: 300, den: 1 });
	assert.ok(Object.isFrozen(layer));
});

test('motion ellipse and star author ordinary Bezier paths and text requires retained font identity', () => {
	const ellipse = createAuthoredMotionLayer('oval', composition, { ...draft, kind: 'ellipse' });
	const star = createAuthoredMotionLayer('star', composition, { ...draft, kind: 'star' });
	assert.equal(ellipse.kind === 'shapes' && ellipse.shapes[0]!.path.value.vertices.length, 4);
	assert.equal(star.kind === 'shapes' && star.shapes[0]!.path.value.vertices.length, 10);
	assert.throws(() => createAuthoredMotionLayer('text', composition, { ...draft, kind: 'text', text: 'Hello' }), /font/u);
	const text = createAuthoredMotionLayer('text', composition, { ...draft, kind: 'text', text: 'Hello' }, 'font');
	assert.equal(text.kind === 'text' && text.document.runs[0]!.fontAssetId, 'font');
	assert.equal(text.kind === 'text' && text.document.lineHeight.value, 1.2);
});

test('motion layer authoring rejects invalid geometry and color before document mutation', () => {
	for (const invalid of [{ width: 0 }, { height: Infinity }, { opacity: 101 }, { color: 'red' }, { name: '' }]) {
		assert.throws(() => createAuthoredMotionLayer('bad', composition, { ...draft, ...invalid }));
	}
});
