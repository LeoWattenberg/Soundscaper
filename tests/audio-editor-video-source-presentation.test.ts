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

test('a square-pixel unrotated source needs no presentation at all', () => {
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, {
		codedWidth: 1_920,
		codedHeight: 1_080,
		rotationDegrees: 0,
		pixelAspectRatio: { num: 1, den: 1 },
	})), null);
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, null)), null);
});

test('an anamorphic source stretches its coded width and stays unturned', () => {
	const presentation = resolveVideoSourcePresentation(source(1_024, 576, {
		codedWidth: 720,
		codedHeight: 576,
		pixelAspectRatio: { num: 64, den: 45 },
	}));
	assert.deepEqual(presentation, {
		autorotate: false,
		codedWidth: 720,
		codedHeight: 576,
		sampleAspect: { num: 64, den: 45 },
		scaledWidth: 1_024,
		scaledHeight: 576,
		rotationDegrees: 0,
		displayWidth: 1_024,
		displayHeight: 576,
	});
});

test('a quarter turn swaps the display axes after the stretch, not before', () => {
	const presentation = resolveVideoSourcePresentation(source(24, 64, {
		codedWidth: 32,
		codedHeight: 24,
		rotationDegrees: 270,
		pixelAspectRatio: { num: 2, den: 1 },
	}));
	assert.equal(presentation?.scaledWidth, 64);
	assert.equal(presentation?.scaledHeight, 24);
	assert.equal(presentation?.displayWidth, 24);
	assert.equal(presentation?.displayHeight, 64);
	assert.equal(presentation?.rotationDegrees, 270);
});

test('a presentation is resolved from the same probe even where a decoder ignored it', () => {
	// Chromium presents 24x64 and Firefox 24x32 for one rotated anamorphic
	// source. The renderer that decodes the container owes the same transform.
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
		codedWidth: 1_920,
		codedHeight: 1_080,
		rotationDegrees: 90,
	})), null);
	assert.equal(resolveVideoSourcePresentation(source(1_920, 1_080, {
		rotationDegrees: 90,
	})), null, 'an unreported coded size cannot anchor a rotation');
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
