/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_AUDACITY_EFFECT_RUNTIME_FILES } from '../scripts/lib/desktop-audacity-effect-runtime-files.mjs';
import { DESKTOP_EFFECT_RUNTIME_FILES } from '../scripts/lib/desktop-effect-runtime-files.mjs';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';

test('desktop staging owns the Audacity effect runtime inventory', () => {
	assert.deepEqual(DESKTOP_AUDACITY_EFFECT_RUNTIME_FILES, [
		'src/common/editor/audacity-effects/audacity-bass-treble-kernel.js',
		'src/common/editor/audacity-effects/audacity-click-removal-kernel.js',
		'src/common/editor/audacity-effects/audacity-dynamics-lookahead.js',
		'src/common/editor/audacity-effects/basic-channel-math.js',
		'src/common/editor/audacity-effects/classic-filter-coefficients.js',
		'src/common/editor/audacity-effects/distortion-table.js',
		'src/common/editor/audacity-effects/live.js',
		'src/common/editor/audacity-effects/live-dynamics-processors.js',
		'src/common/editor/audacity-effects/live-processor-base.js',
		'src/common/editor/audacity-effects/live-spectral-processors.js',
		'src/common/editor/audacity-effects/live-capabilities.js',
		'src/common/editor/audacity-effects/live-capability-policy.js',
		'src/common/editor/audacity-effects/manifest.js',
		'src/common/editor/audacity-effects/spectral.js',
		'src/common/editor/audacity-effects/spectral-equalization-curves.js',
		'src/common/editor/audacity-effects/spectral-noise-reduction.js',
		'src/common/editor/audacity-effects/spectral-repair-interpolation.js',
	]);
	assert.deepEqual(
		DESKTOP_EXPECTED_RUNTIME_FILES.filter((file) => file.startsWith('src/common/editor/audacity-effects/')),
		[
			...DESKTOP_AUDACITY_EFFECT_RUNTIME_FILES,
			...DESKTOP_EFFECT_RUNTIME_FILES.filter((file) => file.startsWith('src/common/editor/audacity-effects/')),
		].sort(),
	);
});
