/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep a local Node run from silently reusing browser evidence from another build. */
export function replaceLocalNodeCoverage(directory, profile) {
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'all.json'), JSON.stringify(profile));
}
