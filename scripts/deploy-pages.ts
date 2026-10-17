#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { deployProductPages } from './lib/pages-deployment-plan.ts';

export async function main(args = process.argv.slice(2), environment = process.env): Promise<void> {
	const { values } = parseArgs({ args, options: { product: { type: 'string' }, project: { type: 'string' } } });
	await deployProductPages({ root: resolve(import.meta.dirname, '..'), product: values.product, project: values.project, environment });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
