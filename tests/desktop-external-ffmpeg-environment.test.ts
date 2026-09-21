/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { curatedExternalFfmpegEnvironment } from '../desktop/external-ffmpeg-environment.ts';

test('one external FFmpeg environment authority admits only bounded Windows roots', () => {
	const environment = curatedExternalFfmpegEnvironment({
		PATH: '/untrusted/bin',
		SystemRoot: 'C:\\Windows',
		WINDIR: 'D:\\Windows',
		HOME: '/private/home',
	});
	assert.deepEqual(environment, { SystemRoot: 'C:\\Windows', WINDIR: 'D:\\Windows' });
	assert.equal(Object.isFrozen(environment), true);

	assert.deepEqual(curatedExternalFfmpegEnvironment({
		SystemRoot: `C:${'x'.repeat(32_768)}`,
		WINDIR: 'C:\\Windows\0escape',
	}), {});
});
