#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { verifyMotionscaperNativeBuildResult } from './lib/motionscaper-native-build-result.ts';
import { MOTION_NATIVE_TARGETS } from './lib/motionscaper-native-source.ts';
import { normalizeAbsoluteCliPath } from './lib/absolute-cli-path.mjs';
const options = {};
for (const argument of process.argv.slice(2)) {
	const match = /^--(result-root|target)=(.+)$/u.exec(argument);
	if (!match || options[match[1]] !== undefined) throw new Error(`Unsupported or duplicate argument ${argument}.`);
	options[match[1]] = match[2];
}
if (!MOTION_NATIVE_TARGETS.includes(options.target)) throw new Error('An exact Motionscaper native --target is required.');
const result = await verifyMotionscaperNativeBuildResult({ repositoryRoot: resolve('.'), target: options.target,
	resultRoot: normalizeAbsoluteCliPath(options['result-root'], 'native build result root') });
process.stdout.write(`${JSON.stringify({ status: 'verified', target: result.receipt.target, receiptSha256: result.receiptSha256 })}\n`);
