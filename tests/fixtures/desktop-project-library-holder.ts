/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

import { createDesktopProjectLibraryPaths } from '../../desktop/project-library-contract.ts';
import { SharedDesktopProjectLibrary } from '../../desktop/project-library.ts';

const appDataRoot = process.argv[2];
if (!appDataRoot) throw new TypeError('The desktop library holder requires an appData path');
const readyPath = process.argv[3];
const releasePath = process.argv[4];
if (!readyPath || !releasePath) throw new TypeError('The desktop library holder requires coordination paths');

const library = await SharedDesktopProjectLibrary.open(createDesktopProjectLibraryPaths(appDataRoot));
const lease = await library.acquireLease({
	owner: {
		product: 'framescaper',
		processId: process.pid,
		instanceId: 'framescaper-child-instance',
	},
	ttlMs: 30_000,
});
await writeFile(`${readyPath}.tmp`, JSON.stringify(lease.owner), { flag: 'wx' });
await rename(`${readyPath}.tmp`, readyPath);

await new Promise<void>((resolvePromise) => {
	const poll = setInterval(() => {
		if (!existsSync(releasePath)) return;
		clearInterval(poll);
		resolvePromise();
	}, 10);
});
await library.releaseLease(lease);
library.close();
