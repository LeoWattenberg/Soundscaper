/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('stalled-write clear preemption is tested by event ordering rather than wall time', async () => {
	const source = await readFile(
		new URL('./audio-editor-streaming-media-lifecycle.test.ts', import.meta.url), 'utf8',
	);
	const body = /test\('clear preempts a stalled OPFS write[^\n]*\n(?<body>[\s\S]*?)(?=\ntest\()/u
		.exec(source)?.groups?.body;

	assert.ok(body, 'the stalled-write clear-preemption regression must remain present');
	assert.doesNotMatch(body, /\bsetTimeout\s*\(/u);
});
