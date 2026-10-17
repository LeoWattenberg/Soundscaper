#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { verifyMotionRelease } from './lib/motionscaper-release-policy.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: { tag: { type: 'string' }, 'expected-channel': { type: 'string', default: 'candidate' }, 'source-revision': { type: 'string' }, 'github-output': { type: 'string' } } });
	if (!values.tag) throw new Error('Motion release verification requires --tag.');
	const release = verifyMotionRelease({ root: resolve(import.meta.dirname, '..'), tag: values.tag, expectedChannel: values['expected-channel'], sourceRevision: values['source-revision'] });
	if (values['github-output']) await appendFile(values['github-output'], `version=${release.version}\nsource-revision=${release.sourceRevision}\n`);
	console.log(JSON.stringify(release));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
