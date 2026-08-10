/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveVideoDisplayGeometry,
	videoSourcePresentedSize,
} from '../src/common/editor/video-display-geometry.ts';
import {
	normalizeVideoSourceCharacteristics,
} from '../src/common/editor/video-source-characteristics.ts';

function characteristics(value: Record<string, unknown>) {
	return normalizeVideoSourceCharacteristics(value);
}

test('an unreported coded size leaves the presented size alone', () => {
	const geometry = resolveVideoDisplayGeometry(characteristics({ rotationDegrees: 90 }), {
		width: 1_920,
		height: 1_080,
	});
	assert.equal(geometry.reconciliation, 'unreported');
	assert.equal(geometry.displayWidth, 1_920);
	assert.equal(geometry.displayHeight, 1_080);
	assert.equal(geometry.residualRotationDegrees, 0);
});

test('a decoder that already rotated is not rotated again', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 90 }),
		{ width: 1_080, height: 1_920 },
	);
	assert.equal(geometry.reconciliation, 'applied');
	assert.equal(geometry.displayWidth, 1_080);
	assert.equal(geometry.displayHeight, 1_920);
	assert.equal(geometry.residualRotationDegrees, 0);
});

test('a decoder that did not rotate leaves the quarter turn as residual', () => {
	for (const rotationDegrees of [90, 270]) {
		const geometry = resolveVideoDisplayGeometry(
			characteristics({ codedWidth: 1_920, codedHeight: 1_080, rotationDegrees }),
			{ width: 1_920, height: 1_080 },
		);
		assert.equal(geometry.reconciliation, 'residual');
		assert.equal(geometry.residualRotationDegrees, rotationDegrees);
		assert.equal(geometry.displayWidth, 1_080);
		assert.equal(geometry.displayHeight, 1_920);
	}
});

test('a half turn is never detected as residual because it cannot be', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 1_920, codedHeight: 1_080, rotationDegrees: 180 }),
		{ width: 1_920, height: 1_080 },
	);
	assert.equal(geometry.reconciliation, 'applied');
	assert.equal(geometry.residualRotationDegrees, 0);
});

test('an anamorphic source the decoder already stretched needs no correction', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 720, codedHeight: 576, pixelAspectRatio: { num: 64, den: 45 } }),
		{ width: 1_024, height: 576 },
	);
	assert.equal(geometry.reconciliation, 'applied');
	assert.equal(geometry.residualScaleX, 1);
	assert.equal(geometry.displayWidth, 1_024);
});

test('an anamorphic source presented at coded size keeps the stretch as residual', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 720, codedHeight: 576, pixelAspectRatio: { num: 64, den: 45 } }),
		{ width: 720, height: 576 },
	);
	assert.equal(geometry.reconciliation, 'residual');
	assert.equal(geometry.residualScaleX, 64 / 45);
	assert.equal(geometry.residualScaleY, 1);
	assert.equal(geometry.displayWidth, 1_024);
	assert.equal(geometry.displayHeight, 576);
});

test('a rotated anamorphic source resolves both residuals together', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({
			codedWidth: 720,
			codedHeight: 576,
			rotationDegrees: 90,
			pixelAspectRatio: { num: 64, den: 45 },
		}),
		{ width: 720, height: 576 },
	);
	assert.equal(geometry.reconciliation, 'residual');
	assert.equal(geometry.residualRotationDegrees, 90);
	assert.equal(geometry.residualScaleX, 64 / 45);
	assert.equal(geometry.displayWidth, 576);
	assert.equal(geometry.displayHeight, 1_024);
});

test('a decoder that turned the frame moves the residual stretch with it', () => {
	// Firefox applies a display matrix but ignores the pixel aspect ratio, so a
	// rotated anamorphic source arrives turned and unstretched: the coded width
	// is now the presented height, and that is the axis still owed the stretch.
	const geometry = resolveVideoDisplayGeometry(
		characteristics({
			codedWidth: 32,
			codedHeight: 24,
			rotationDegrees: 270,
			pixelAspectRatio: { num: 2, den: 1 },
		}),
		{ width: 24, height: 32 },
	);
	assert.equal(geometry.reconciliation, 'residual');
	assert.equal(geometry.residualRotationDegrees, 0);
	assert.equal(geometry.residualScaleX, 1);
	assert.equal(geometry.residualScaleY, 2);
	assert.equal(geometry.displayWidth, 24);
	assert.equal(geometry.displayHeight, 64);
});

test('geometry that no rotation or stretch explains is reported as disagreement', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 1_920, codedHeight: 1_080 }),
		{ width: 640, height: 640 },
	);
	assert.equal(geometry.reconciliation, 'disagreed');
	assert.equal(geometry.displayWidth, 640);
	assert.equal(geometry.displayHeight, 640);
	assert.equal(geometry.residualRotationDegrees, 0);
	assert.equal(geometry.residualScaleX, 1);
});

test('a scaled presentation of the same aspect still counts as applied', () => {
	const geometry = resolveVideoDisplayGeometry(
		characteristics({ codedWidth: 1_920, codedHeight: 1_080 }),
		{ width: 1_280, height: 720 },
	);
	assert.equal(geometry.reconciliation, 'applied');
	assert.equal(geometry.displayWidth, 1_280);
	assert.equal(geometry.displayHeight, 720);
});

test('a presented size outside the coded bound is rejected, never clamped', () => {
	assert.throws(
		() => resolveVideoDisplayGeometry(characteristics({}), { width: 0, height: 1_080 }),
		/presented width/,
	);
	assert.throws(
		() => resolveVideoDisplayGeometry(characteristics({}), { width: 1_920, height: 1_000_000 }),
		/presented height/,
	);
});

test('a persisted source reports the size it presents', () => {
	assert.deepEqual(videoSourcePresentedSize({ width: 1_920, height: 1_080 }), { width: 1_920, height: 1_080 });
	assert.equal(videoSourcePresentedSize({ width: 0, height: 1_080 }), null);
	assert.equal(videoSourcePresentedSize(null), null);
});
