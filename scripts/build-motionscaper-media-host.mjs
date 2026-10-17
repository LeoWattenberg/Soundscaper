#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { buildMotionscaperNativeHost } from './lib/motionscaper-native-build.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
const allowed = new Set(['root', 'target', 'work-root', 'output', 'ffmpeg-source', 'boost-source', 'external-source-root']);
const options = {};
for (const argument of process.argv.slice(2)) {
	const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
	if (!match || !allowed.has(match[1]) || options[match[1]] !== undefined) throw new Error(`Unsupported or duplicate argument ${argument}.`);
	options[match[1]] = match[2];
}
if (!MOTION_NATIVE_TARGETS.includes(options.target)) throw new Error('An exact Motionscaper native --target is required.');
function path(key) {
	if (typeof options[key] !== 'string') throw new Error(`--${key} is required.`);
	return normalizeAbsoluteCliPath(options[key], key);
}
const result = await buildMotionscaperNativeHost({ repositoryRoot: options.root ? path('root') : resolve('.'),
	target: options.target, workRoot: path('work-root'), outputRoot: path('output'),
	ffmpegSourceRoot: path('ffmpeg-source'), boostSourceRoot: path('boost-source'), externalSourceRoot: path('external-source-root') });
process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
