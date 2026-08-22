#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	auditFramescaperMediaHost,
	verifyFramescaperMediaHostBoostClosure,
	verifyFramescaperMediaHostPayloadManifest,
} from './lib/framescaper-media-host-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const audit = auditFramescaperMediaHost({ repositoryRoot });
if (audit.findings.length > 0) throw new Error(audit.findings.join('\n'));
const verified = verifyFramescaperMediaHostPayloadManifest({ repositoryRoot });
const boostSourceRoot = process.env.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
if (boostSourceRoot !== undefined) {
	await verifyFramescaperMediaHostBoostClosure({ repositoryRoot, boostSourceRoot });
}
const built = verified.payload.payloads.length;
const pending = verified.payload.targets.length - built;
const boost = boostSourceRoot === undefined ? 'pin-bound' : 'closure-verified';
console.log(
	`Framescaper media host: ${String(built)} built target(s), `
	+ `${String(pending)} pending-external; Boost 1.92.0 ${boost}.`,
);
