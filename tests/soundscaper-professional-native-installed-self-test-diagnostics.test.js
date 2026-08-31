/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	soundscaperProfessionalNativeProcessFailureMessage,
} from '../scripts/lib/soundscaper-professional-native-process-diagnostics.mjs';

test('installed native self-test failures preserve bounded subprocess diagnostics', async () => {
	const secret = 'installed-self-test-secret';
	const message = soundscaperProfessionalNativeProcessFailureMessage(
		'self-test delivery-filesystem-protocol',
		{
			status: 1,
			signal: null,
			stdout: 'delivery stdout tail',
			stderr: `SDF1 publication-failed: Windows error 5.\n${secret}`,
		},
		{ ACTIONS_RUNTIME_TOKEN: secret },
	);
	assert.match(message, /self-test delivery-filesystem-protocol failed/u);
	assert.match(message, /status=1/u);
	assert.match(message, /SDF1 publication-failed: Windows error 5/u);
	assert.match(message, /delivery stdout tail/u);
	assert.doesNotMatch(message, /installed-self-test-secret/u);
	assert(Buffer.byteLength(message) <= 20 * 1024);

	const candidateSource = await readFile(resolve(
		'scripts/lib/soundscaper-professional-native-build-result.mjs'), 'utf8');
	assert.match(candidateSource,
		/soundscaperProfessionalNativeProcessFailureMessage\(\s*`self-test \$\{request\.id\}`,[\s\S]*result/u);
});
