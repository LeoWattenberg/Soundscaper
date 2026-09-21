/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	externalFfmpegExecutablePairFromRuntimeAdmission,
} from '../desktop/external-ffmpeg-executable-pair-admission.ts';
import { externalFfmpegExecutablePairClosureSha256 } from
	'../desktop/external-ffmpeg-node-runtime.ts';

test('one executable-pair projection authority validates runtime admissions without owning caller errors', () => {
	const ffmpegSha256 = 'a'.repeat(64);
	const ffprobeSha256 = 'b'.repeat(64);
	const executablePairClosureSha256 = externalFfmpegExecutablePairClosureSha256({
		ffmpegPath: '/opt/ffmpeg', ffmpegSha256,
		ffprobePath: '/opt/ffprobe', ffprobeSha256,
	});
	const admission = {
		executablePath: '/opt/ffmpeg',
		identity: {
			ffmpegSha256, ffprobePath: '/opt/ffprobe', ffprobeSha256,
			executablePairClosureSha256,
		},
	};
	assert.deepEqual(externalFfmpegExecutablePairFromRuntimeAdmission(admission), {
		executablePath: '/opt/ffmpeg', ffmpegSha256,
		ffprobePath: '/opt/ffprobe', ffprobeSha256, executablePairClosureSha256,
	});
	assert.equal(externalFfmpegExecutablePairFromRuntimeAdmission({
		...admission, identity: { ...admission.identity, ffprobeSha256: 'c'.repeat(64) },
	}), null);
	assert.equal(externalFfmpegExecutablePairFromRuntimeAdmission(null), null);
});
