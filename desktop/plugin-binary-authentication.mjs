/* SPDX-License-Identifier: AGPL-3.0-only */

import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';

/** Re-authenticate one main-private candidate without running a plug-in scan. */
export async function authenticatePluginBinary(path, expected) {
	try {
		const actual = await authenticatePluginCandidate(path);
		return actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256
			? actual.identity : null;
	} catch { return null; }
}
