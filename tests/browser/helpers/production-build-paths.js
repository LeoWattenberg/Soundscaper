/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NIGHTLY_PAYLOAD_ROOT = 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT';

/** Locate the verified Soundscaper assets in local and staged nightly layouts. */
export function resolveSoundscaperProductionAssetsDirectory(environment = process.env) {
	const payloadRoot = environment[NIGHTLY_PAYLOAD_ROOT];
	if (payloadRoot === undefined) {
		return resolve(fileURLToPath(new URL('../../../dist/assets/', import.meta.url)));
	}
	if (typeof payloadRoot !== 'string' || !isAbsolute(payloadRoot)) {
		throw new TypeError(`${NIGHTLY_PAYLOAD_ROOT} must be an absolute path.`);
	}
	return join(payloadRoot, 'sites', 'soundscaper', 'assets');
}
