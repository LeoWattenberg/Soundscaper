/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { IPC } from '../desktop/constants.js';

test('desktop main registers and disposes the FFmpeg preference runtime', async () => {
	assert.deepEqual({
		status: IPC.externalFfmpegStatus, choose: IPC.externalFfmpegChoose,
		clear: IPC.externalFfmpegClear, rescan: IPC.externalFfmpegRescan,
		install: IPC.externalFfmpegInstall,
	}, {
		status: 'soundscaper:v1:ffmpeg:status', choose: 'soundscaper:v1:ffmpeg:choose',
		clear: 'soundscaper:v1:ffmpeg:clear', rescan: 'soundscaper:v1:ffmpeg:rescan',
		install: 'soundscaper:v1:ffmpeg:install',
	});
	const source = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
	assert.match(source, /import \{ registerExternalFfmpegPreferences \} from '\.\/external-ffmpeg-registration\.mjs'/u);
	assert.match(source, /externalFfmpegPreferences = await registerExternalFfmpegPreferences\(\{ channels: IPC, handle,/u);
	assert.match(source, /external FFmpeg preferences'.*externalFfmpegPreferences\?\.dispose\(\)/u);
});
