#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	runDesktopSoundscaperDeliveryRestartPublicationSmoke,
} from './lib/desktop-soundscaper-delivery-restart-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await runDesktopSoundscaperDeliveryRestartPublicationSmoke({ repositoryRoot });
console.log(`Passed packaged persistent delivery restart/publication smoke (${result.publication.sha256}).`);
