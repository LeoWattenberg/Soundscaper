/* SPDX-License-Identifier: AGPL-3.0-only */

import { rename, writeFile } from 'node:fs/promises';

import {
	DESKTOP_LIBRARY_SCHEMA_VERSION,
	createDesktopProjectLibraryPaths,
} from '../../desktop/project-library-contract.ts';
import type { DesktopLibraryCheckpoint } from '../../desktop/project-library-api.ts';
import { SharedDesktopProjectLibrary } from '../../desktop/project-library.ts';

const [appDataPath, targetPhase, readyPath] = process.argv.slice(2);
if (!appDataPath || !readyPath || (targetPhase !== 'prepared' && targetPhase !== 'committed')) {
	throw new TypeError('Crash fixture requires appData, journal phase, and ready path');
}

let leaseToken = 0;
const library = await SharedDesktopProjectLibrary.open(createDesktopProjectLibraryPaths(appDataPath), {
	checkpoint: async (phase: DesktopLibraryCheckpoint) => {
		if (phase !== targetPhase) return;
		const temporary = `${readyPath}.${String(process.pid)}.tmp`;
		await writeFile(temporary, JSON.stringify({ phase, fencingToken: leaseToken }), { flag: 'wx' });
		await rename(temporary, readyPath);
		// Hold the event loop open. A bare never-settling promise lets Node drain,
		// notice the pending top-level await and exit 13 on its own — which under
		// load happens before the parent's SIGKILL lands, so the test that meant
		// to witness a crash witnessed an ordinary exit instead. This process must
		// only ever end by being killed.
		await new Promise<never>(() => { setInterval(() => {}, 1_000); });
	},
});
const lease = await library.acquireLease({
	owner: {
		product: 'soundscaper',
		processId: process.pid,
		instanceId: `crash-fixture-${String(process.pid)}`,
	},
	ttlMs: 1_000,
});
leaseToken = lease.fencingToken;
await library.publishMetadata({
	lease,
	metadata: { schemaVersion: DESKTOP_LIBRARY_SCHEMA_VERSION, revision: 1, projects: [], media: [] },
});
throw new Error('Crash fixture publication unexpectedly completed');
