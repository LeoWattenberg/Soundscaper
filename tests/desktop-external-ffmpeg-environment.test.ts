/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	curatedExternalFfmpegEnvironment,
	privateExternalFfmpegEnvironment,
} from '../desktop/external-ffmpeg-environment.ts';

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

test('one private external FFmpeg environment authority isolates every writable process root', () => {
	const environment = privateExternalFfmpegEnvironment({
		PATH: '/untrusted/bin',
		HOME: '/untrusted/home',
		TEMP: '/untrusted/tmp',
		SystemRoot: 'C:\\Windows',
	}, '/private/ffmpeg-job');
	assert.deepEqual(environment, {
		AV_LOG_FORCE_NOCOLOR: '1',
		HOME: '/private/ffmpeg-job',
		LANG: 'C',
		LC_ALL: 'C',
		NO_COLOR: '1',
		SystemRoot: 'C:\\Windows',
		TEMP: '/private/ffmpeg-job',
		TMP: '/private/ffmpeg-job',
		TMPDIR: '/private/ffmpeg-job',
		USERPROFILE: '/private/ffmpeg-job',
	});
	assert.equal(Object.isFrozen(environment), true);
});
