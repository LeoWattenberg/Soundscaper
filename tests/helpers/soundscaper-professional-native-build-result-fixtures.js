/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	requiredSoundscaperProfessionalNativeSelfTestIds,
} from '../../scripts/lib/soundscaper-professional-native-build-result.mjs';

export function soundscaperProfessionalNativeBuildSelfTestsFixture(target) {
	const candidateExecuted = new Set([
		'm5f2-malformed-frame', 'm5a1-malformed-frame', 'launcher-refusal',
		'delivery-filesystem-protocol',
		'closure-recursive-inspection', 'closure-symlink-refusal',
		'closure-ambient-dependency-refusal', 'closure-rpath-refusal',
		'closure-undeclared-dependency-refusal', 'closure-runtime-file-limit-refusal',
	]);
	return requiredSoundscaperProfessionalNativeSelfTestIds(target)
		.filter((id) => !candidateExecuted.has(id))
		.map((id) => ({
			id,
			status: 'passed',
			commandSha256: sha256(`command:${id}`),
			outputSha256: sha256(`output:${id}`),
		}));
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
