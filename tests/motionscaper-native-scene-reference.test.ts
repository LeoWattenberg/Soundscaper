/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionNativeScene, renderMotionNativeSceneReference } from '../desktop/motionscaper-native-scene-reference.ts';

test('native scene reference visibly exercises camera, light, shadow, shutter and lens quality', async () => {
	const project = createMotionNativeScene(); const image = await renderMotionNativeSceneReference(project, 1);
	for (const omit of ['camera', 'light', 'shadow', 'shutter', 'lens'] as const) {
		const alternate = await renderMotionNativeSceneReference(createMotionNativeScene(omit), 1);
		assert.notDeepEqual(image.pixels, alternate.pixels, `${omit} must change rendered reference pixels`);
	}
	assert.notDeepEqual(image.pixels, (await renderMotionNativeSceneReference(project, 2)).pixels);
	assert.ok(image.pixels.some((value, i) => i % 4 === 3 && value > 0 && value < 1));
	assert.ok(image.pixels.some((value, i) => i % 4 === 3 && value === 0));
});
