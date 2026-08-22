/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	auditFramescaperOpenFxHost,
	verifyFramescaperOpenFxPayloadManifest,
} from './lib/framescaper-openfx-host-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const audit = auditFramescaperOpenFxHost({ repositoryRoot });
if (audit.findings.length > 0) {
	for (const finding of audit.findings) process.stderr.write(`${finding}\n`);
	process.exitCode = 1;
} else {
	const verified = verifyFramescaperOpenFxPayloadManifest({ repositoryRoot });
	const built = verified.payload.payloads.length;
	const pending = verified.payload.targets.length - built;
	process.stdout.write(
		`Framescaper OpenFX host: ${String(built)} built target(s), `
		+ `${String(pending)} pending-external; source and payload identities are pinned.\n`,
	);
}
