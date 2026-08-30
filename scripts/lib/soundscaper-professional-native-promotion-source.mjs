/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bind standalone native promotion to the exact candidate checkout. */

import { spawnSync } from 'node:child_process';

export function assertSoundscaperProfessionalNativePromotionSourceRevision(
	repositoryRoot, sourceRevision,
) {
	const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
		cwd: repositoryRoot, encoding: 'utf8', shell: false, maxBuffer: 1024 * 1024,
	});
	const observed = result.status === 0 ? result.stdout.trim() : '';
	if (result.error !== undefined || result.signal !== null
		|| !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(observed)
		|| observed !== sourceRevision) {
		throw new Error('The professional candidate source revision is not the checked-out promotion revision.');
	}
}
