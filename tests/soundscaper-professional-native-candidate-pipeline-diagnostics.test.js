/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	soundscaperProfessionalNativePipelineFailureMessage,
} from '../scripts/lib/soundscaper-professional-native-candidate-pipeline.mjs';

test('candidate pipeline failures expose bounded diagnostics without environment secrets', () => {
	const secret = 'candidate-pipeline-secret-value';
	const message = soundscaperProfessionalNativePipelineFailureMessage(
		'self-test fixture-close',
		{
			status: 1,
			signal: null,
			stdout: `setup\n${'x'.repeat(64 * 1024)}\nstdout-tail`,
			stderr: `\u001b[31mloader failed\u001b[0m\nAuthorization: Bearer github_pat_fixture\n${secret}\nstderr-tail`,
		},
		{ ACTIONS_RUNTIME_TOKEN: secret },
	);
	assert.match(message, /self-test fixture-close failed/u);
	assert.match(message, /status=1/u);
	assert.match(message, /loader failed/u);
	assert.match(message, /stdout-tail/u);
	assert.match(message, /stderr-tail/u);
	assert.doesNotMatch(message, /candidate-pipeline-secret-value|github_pat_fixture/iu);
	assert(!message.includes('\u001b'));
	assert(Buffer.byteLength(message) <= 20 * 1024,
		'the rendered failure diagnostic must stay far below the one-MiB capture bound');
});

test('candidate pipeline spawn errors remain actionable without command or environment dumps', () => {
	const message = soundscaperProfessionalNativePipelineFailureMessage(
		'isolation build',
		{ error: new Error('spawn cmake ENOENT'), signal: null, status: null },
		{ PATH: '/secret/toolchain/path' },
	);
	assert.match(message, /spawn cmake ENOENT/u);
	assert.doesNotMatch(message, /secret\/toolchain/u);
});

test('candidate pipeline diagnostics remain bounded after repeated short-secret redaction', () => {
	const message = soundscaperProfessionalNativePipelineFailureMessage(
		'self-test fixture-close',
		{ status: 1, signal: null, stdout: '', stderr: 'aaaa'.repeat(256 * 1024) },
		{ CI_JOB_TOKEN: 'aaaa' },
	);
	assert.doesNotMatch(message, /aaaa/u);
	assert(Buffer.byteLength(message) <= 8 * 1024);
});

test('candidate pipeline diagnostic byte bounds preserve complete UTF-8 code points', () => {
	const baseline = soundscaperProfessionalNativePipelineFailureMessage(
		'self-test fixture-close', { status: 1, signal: null, stdout: '', stderr: '' }, {},
	);
	const message = soundscaperProfessionalNativePipelineFailureMessage(
		'self-test fixture-close',
		{ status: 1, signal: null, stdout: '🚀'.repeat(256 * 1024), stderr: '' },
		{},
	);
	assert(Buffer.byteLength(message) <= Buffer.byteLength(`${baseline}\nstdout: `) + 4 * 1024);
	assert.doesNotMatch(message, /�/u);
});
