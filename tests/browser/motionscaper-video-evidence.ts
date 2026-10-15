/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import type { TestInfo } from '@playwright/test';

interface MotionVideoEvidence {
	readonly supported: boolean;
	readonly output?: readonly number[];
	readonly [key: string]: unknown;
}

/** Keep codec admission and actual encoded bytes distinct in the completed report. */
export async function recordMotionVideoEvidence(testInfo: TestInfo, format: 'mp4' | 'webm', result: MotionVideoEvidence): Promise<void> {
	const { output, ...metadata } = result;
	const bytes = output === undefined ? null : Buffer.from(output);
	await testInfo.attach('motion-codec-evidence', {
		body: JSON.stringify({ format, engine: testInfo.project.name, ...metadata,
			output: bytes ? { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') } : null }),
		contentType: 'application/json',
	});
	if (bytes) await testInfo.attach(`motion-codec-output.${format}`, {
		body: bytes, contentType: format === 'mp4' ? 'video/mp4' : 'video/webm',
	});
	testInfo.annotations.push({ type: 'motion-codec-path', description: `${format}/${result.supported ? 'encoded' : 'refused'}` });
}
