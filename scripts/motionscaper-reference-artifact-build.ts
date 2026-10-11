#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildMotionNativeReferenceDecoder } from '../desktop/motionscaper-native-reference.ts';
import { createMotionReferenceArtifact } from './lib/motionscaper-reference-artifact.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';

export async function main(args = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({ args, options: { target: { type: 'string' }, 'native-result': { type: 'string' }, 'ffmpeg-prefix': { type: 'string' }, output: { type: 'string' } } });
	const target = MOTION_NATIVE_TARGETS.find(target => target === values.target);
	if (!target?.startsWith('linux-') || !values['native-result'] || !values['ffmpeg-prefix'] || !values.output) throw new Error('Reference build requires Linux --target, --native-result, --ffmpeg-prefix and --output.');
	const directory = await mkdtemp(join(tmpdir(), 'motion-reference-build-'));
	try {
		const decoder = await buildMotionNativeReferenceDecoder(directory, resolve(values['ffmpeg-prefix']));
		await createMotionReferenceArtifact({ repositoryRoot: resolve(import.meta.dirname, '..'), nativeResult: resolve(values['native-result']), target, decoder, output: resolve(values.output) });
	} finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
