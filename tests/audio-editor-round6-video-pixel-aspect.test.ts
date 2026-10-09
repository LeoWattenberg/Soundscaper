/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readContainerVideoSourceCharacteristics } from '../src/common/editor/video-container-characteristics.ts';
import { readContainerVideoPixelAspect } from '../src/common/editor/video-container-pixel-aspect.ts';
import { resolveVideoDisplayGeometry } from '../src/common/editor/video-display-geometry.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import { resolveVideoSourcePresentation } from '../src/common/editor/video-source-presentation.ts';

// Original synthetic pixels encoded by the pinned @ffmpeg/core 0.12.10 with
// libx264, setsar=40/33 and +faststart. Ordinary NTSC widescreen sample geometry.
const media = Buffer.from(await readFile(new URL('./browser/fixtures/ntsc-anamorphic-pasp.mp4.base64', import.meta.url), 'utf8'), 'base64');

test('a normal MP4 container preserves the exact declared pixel aspect ratio', async () => {
	assert.equal(createHash('sha256').update(media).digest('hex'), '8b43f0305de87fd79fd65120004297f9bb41a5a3b04905667f1736cea400fa70');
	const facts = await readContainerVideoSourceCharacteristics(new Blob([media]));
	assert.equal(facts.codedWidth, 720);
	assert.equal(facts.codedHeight, 480);
	assert.deepEqual(facts.pixelAspectRatio, { num: 40, den: 33 });
});

test('the rounded intrinsic dimensions of an NTSC camera frame remain reconciled', () => {
	const facts = normalizeVideoSourceCharacteristics({
		codedWidth: 720, codedHeight: 480, pixelAspectRatio: { num: 40, den: 33 },
	});
	const geometry = resolveVideoDisplayGeometry(facts, { width: 873, height: 480 });
	assert.equal(geometry.reconciliation, 'applied');
	assert.equal(geometry.displayWidth, 873);
	assert.equal(geometry.displayHeight, 480);
	assert.equal(geometry.residualScaleX, 1);
	assert.deepEqual(resolveVideoSourcePresentation({
		width: 873, height: 480, characteristics: facts,
	}), {
		autorotate: true, decodedWidth: 720, decodedHeight: 480,
		sampleAspect: { num: 40, den: 33 }, scaledWidth: 873, scaledHeight: 480,
	});
});

test('a materially different decoder shape still retains its disagreement', () => {
	const facts = normalizeVideoSourceCharacteristics({
		codedWidth: 720, codedHeight: 480, pixelAspectRatio: { num: 40, den: 33 },
	});
	assert.equal(resolveVideoDisplayGeometry(facts, { width: 874, height: 480 }).reconciliation, 'disagreed');
});

test('declared sample aspect belongs only to the selected container track', async () => {
	const blob = new Blob([media]);
	assert.deepEqual(await readContainerVideoPixelAspect(blob, 1), { num: 40, den: 33 });
	assert.equal(await readContainerVideoPixelAspect(blob, 2), null);
});

test('fractional anamorphic presentation retains its exact ratio through rotation and reduction', () => {
	for (const rotationDegrees of [null, 90, 270]) {
		for (const num of [10, 40]) {
			const den = num === 10 ? 11 : 33;
			const displayWidth = Math.round(720 * num / den);
			const turned = rotationDegrees !== null;
			const facts = normalizeVideoSourceCharacteristics({
				codedWidth: 720, codedHeight: 480, pixelAspectRatio: { num, den }, rotationDegrees,
			});
			const geometry = resolveVideoDisplayGeometry(facts, {
				width: turned ? 480 : displayWidth, height: turned ? displayWidth : 480,
			});
			assert.equal(geometry.reconciliation, 'applied');
			assert.equal(geometry.residualRotationDegrees, 0);
			assert.equal(geometry.residualScaleX, 1);
			assert.equal(geometry.residualScaleY, 1);
		}
	}
});
