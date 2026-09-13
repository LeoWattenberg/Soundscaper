#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	NATIVE_PAYLOAD_PRODUCERS_PATH,
	auditNativePayloadProducers,
} from './lib/native-payload-producers.mjs';

const audit = auditNativePayloadProducers(resolve(import.meta.dirname, '..'));
for (const finding of audit.findings) process.stderr.write(`${finding}\n`);
process.stdout.write(`${NATIVE_PAYLOAD_PRODUCERS_PATH}: ${audit.status}; repository-owned target builders are registered.\n`);
if (audit.status !== 'passed') process.exitCode = 1;
