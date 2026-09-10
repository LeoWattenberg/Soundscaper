#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
	CONTROLLER_DOMAINS,
	inspectControllerDomainTree,
} from './lib/controller-domain-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const controllerRoot = join(root, 'src', 'common', 'editor', 'controller');
const manifest = JSON.parse(readFileSync(
	join(root, 'config', 'controller-domain-public-modules.json'),
	'utf8',
));
const findings = inspectControllerDomainTree({ controllerRoot, manifest });

if (findings.length) throw new Error(`Controller domain guard failed:\n${findings.join('\n')}`);

console.log(
	`Checked ${CONTROLLER_DOMAINS.length} controller domains and ${manifest.modules.length} public modules.`,
);
