#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildMotionReleaseWebArtifact, verifyMotionReleaseWebBuild } from './lib/motionscaper-release-web-build.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: Object.fromEntries(['operation', 'directory', 'evidence', 'tag', 'expected-channel', 'source-revision'].map(key => [key, { type: 'string' as const }])) });
	for (const name of ['directory', 'evidence', 'tag', 'source-revision']) if (!values[name]) throw new Error(`Motion web artifact requires --${name}.`);
	if (values.operation !== 'build' && values.operation !== 'verify') throw new Error('Motion web artifact operation must be build or verify.');
	const expectedChannel = values['expected-channel'] ?? 'candidate';
	if (expectedChannel !== 'candidate' && expectedChannel !== 'stable') throw new Error('Motion expected release channel must be candidate or stable.');
	const options = { root: resolve(import.meta.dirname, '..'), tag: String(values.tag), expectedChannel, sourceRevision: String(values['source-revision']), directory: resolve(String(values.directory)), evidence: resolve(String(values.evidence)) } as const;
	const artifact = await (values.operation === 'build' ? buildMotionReleaseWebArtifact({ ...options, environment: process.env }) : verifyMotionReleaseWebBuild(options));
	console.log(JSON.stringify({ productId: artifact.productId, sourceRevision: artifact.sourceRevision, channel: artifact.channel, version: artifact.applicationVersion, files: artifact.files.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
