/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearCurveMetadataCurrentV1 } from '../src/common/editor/imaging/linear-curve-metadata-current-v1.ts';
import { prepareLinearCurvesV1, writeLinearCurvesEncodedV1 } from '../src/common/editor/imaging/pixel-frame-linear-curves-v1.ts';

test('shared native curve metadata detaches authored knots and preserves channel identity without byte tables', () => {
	const points = [{ x: 0, y: 0 }, { x: .125, y: .25 }, { x: 1, y: 1 }];
	const metadata = prepareLinearCurveMetadataCurrentV1({ id: 'curve', type: 'point-curves-v1', enabled: true, params: { master: points } });
	points[1]!.y = .75;
	assert.deepEqual(metadata.channels.master.points, [{ x: 0, y: 0 }, { x: .125, y: .25 }, { x: 1, y: 1 }]);
	assert.equal(metadata.channels.master.identity, false); assert.equal(metadata.channels.red.identity, true);
	assert.ok(Object.isFrozen(metadata)); assert.ok(Object.isFrozen(metadata.effect)); assert.ok(Object.isFrozen(metadata.channels));
	for (const channel of Object.values(metadata.channels)) {
		assert.ok(Object.isFrozen(channel)); assert.ok(Object.isFrozen(channel.points)); assert.ok(channel.points.every(Object.isFrozen));
	}
	const prepared = prepareLinearCurvesV1({ id: metadata.effect.id, type: metadata.effect.type,
		enabled: metadata.effect.enabled, params: metadata.effect.params }), result = { red: 0, green: 0, blue: 0 };
	writeLinearCurvesEncodedV1(prepared, .125, -.125, 1.125, result);
	assert.equal(result.red, .25); assert.equal(result.green, -.25); assert.equal(result.blue, 1 + .125 * (1 - .25) / (1 - .125));
});

test('shared parametric knots retain exact Q16 gains and duplicate subnormal centers of the permanent native sampler', () => {
	const metadata = prepareLinearCurveMetadataCurrentV1({ id: 'q16', type: 'parametric-curves-v1', enabled: true, params: { masterShadows: 33.333 } });
	const gain = Math.round(33.333 / 100 * 65536) / 65536;
	assert.deepEqual(metadata.channels.master.points, [{ x: 0, y: 0 }, { x: .125, y: .125 + gain * .125 },
		{ x: .375, y: .375 }, { x: .625, y: .625 }, { x: .875, y: .875 }, { x: 1, y: 1 }]);
	const tiny = prepareLinearCurveMetadataCurrentV1({ id: 'tiny', type: 'parametric-curves-v1', enabled: true,
		params: { shadowSplit: Number.MIN_VALUE, midtoneSplit: Number.MIN_VALUE * 2, highlightSplit: Number.MIN_VALUE * 3, masterShadows: 100 } });
	assert.deepEqual(tiny.channels.master.points.slice(0, 2), [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
	const prepared = prepareLinearCurvesV1({ id: tiny.effect.id, type: tiny.effect.type,
		enabled: tiny.effect.enabled, params: tiny.effect.params }), output = { red: 0, green: 0, blue: 0 };
	writeLinearCurvesEncodedV1(prepared, -0, Number.MIN_VALUE, 2, output);
	assert.ok(Object.is(output.red, -0)); assert.equal(output.green, Number.MIN_VALUE); assert.equal(output.blue, 2);
});
