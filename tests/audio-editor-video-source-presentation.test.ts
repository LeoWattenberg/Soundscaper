/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveVideoSourceDisplaySize,
	resolveVideoSourcePresentation,
} from '../src/common/editor/video-source-presentation.ts';
import {
	createUnreportedVideoSourceCharacteristics,
	normalizeVideoSourceCharacteristics,
} from '../src/common/editor/video-source-characteristics.ts';

const PAL = Object.freeze({ num: 25, den: 1 });

function source(width: number, height: number, characteristics: Record<string, unknown> | null) {
	return {
		kind: 'video',
		id: 'source-1',
		width,
		height,
		frameRate: PAL,
		characteristics: characteristics
			? normalizeVideoSourceCharacteristics(characteristics, { rate: PAL })
			: createUnreportedVideoSourceCharacteristics(),
	};
}

test('a decode that already presents the display geometry is owed nothing', () => {
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, {
		codedWidth: 1_920,
		codedHeight: 1_080,
		rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 },
	})), null);
	assert.equal(resolveVideoSourcePresentation(source(1_080, 1_920, {
		codedWidth: 1_920,
		codedHeight: 1_080,
		rotationDegrees: 90,
	})), null, 'the decode applies the display matrix itself');
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, null)), null);
});

test('an anamorphic source is owed the stretch its decode ignored', () => {
	assert.deepEqual(resolveVideoSourcePresentation(source(1_024, 576, {
		codedWidth: 720,
		codedHeight: 576,
		pixelAspectRatio: { num: 64, den: 45 },
	})), {
		autorotate: true,
		decodedWidth: 720,
		decodedHeight: 576,
		sampleAspect: { num: 64, den: 45 },
		scaledWidth: 1_024,
		scaledHeight: 576,
	});
});

test('a turned decode carries the stretch to the axis the coded width landed on', () => {
	assert.deepEqual(resolveVideoSourcePresentation(source(24, 64, {
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: 270,
		pixelAspectRatio: { num: 2, den: 1 },
	})), {
		autorotate: true,
		decodedWidth: 24,
		decodedHeight: 32,
		sampleAspect: { num: 2, den: 1 },
		scaledWidth: 24,
		scaledHeight: 64,
	});
});

test('the residual is the same wherever the browser stopped', () => {
	// Chromium presents 24x64 for this source and Firefox 24x32, but the render
	// that decodes the container is owed the same stretch either way.
	const characteristics = {
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: 270,
		pixelAspectRatio: { num: 2, den: 1 },
	};
	assert.deepEqual(
		resolveVideoSourcePresentation(source(24, 64, characteristics)),
		resolveVideoSourcePresentation(source(24, 32, characteristics)),
	);
});

test('geometry the decoder contradicts is never applied by a second renderer', () => {
	assert.equal(resolveVideoSourcePresentation(source(640, 640, {
		codedWidth: 720,
		codedHeight: 576,
		pixelAspectRatio: { num: 64, den: 45 },
	})), null);
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, {
		pixelAspectRatio: { num: 64, den: 45 },
	})), null, 'an unreported coded size cannot anchor a stretch');
});

test('a stretch beyond the coded dimension bound is refused rather than emitted', () => {
	assert.equal(resolveVideoSourcePresentation({
		kind: 'video',
		width: 65_536,
		height: 1_080,
		frameRate: PAL,
		characteristics: normalizeVideoSourceCharacteristics({
			codedWidth: 65_536,
			codedHeight: 1_080,
			pixelAspectRatio: { num: 3, den: 2 },
		}, { rate: PAL }),
	}), null);
});

test('an unreadable characteristics record leaves the decoder authoritative', () => {
	assert.equal(resolveVideoSourcePresentation({
		kind: 'video',
		width: 720,
		height: 576,
		frameRate: PAL,
		characteristics: { codedWidth: 720, codedHeight: 576, unknownKey: true },
	}), null);
	assert.equal(resolveVideoSourcePresentation(null), null);
	assert.equal(resolveVideoSourcePresentation({ width: 0, height: 0 }), null);
});

test('display size is the geometry every surface aims at', () => {
	assert.deepEqual(
		resolveVideoSourceDisplaySize(source(720, 576, {
			codedWidth: 720,
			codedHeight: 576,
			pixelAspectRatio: { num: 64, den: 45 },
		})),
		{ width: 1_024, height: 576 },
	);
	assert.deepEqual(
		resolveVideoSourceDisplaySize(source(1_280, 720, null)),
		{ width: 1_280, height: 720 },
	);
	assert.equal(resolveVideoSourceDisplaySize(null), null);
});
