/* SPDX-License-Identifier: AGPL-3.0-only */
// Reviewed callers supply a literal closed options object; this file adds no application capability.
import { readFile } from 'node:fs/promises';
import { qualifyMotionscaperNativeMaximum } from '../desktop/motionscaper-native-maximum-qualification.ts';

if (process.argv.length !== 3) throw new Error('Expected one reviewed maximum-workload options file.');
const options = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!options || typeof options !== 'object' || Array.isArray(options)
	|| Object.keys(options).sort().join() !== ['kind', 'output', 'ffmpegPrefix', 'nativeResult', 'prefixAuthority', 'prefixAuthoritySha256'].sort().join()
	|| Object.values(options).some(value => typeof value !== 'string')) throw new Error('Invalid closed maximum-workload options.');
await qualifyMotionscaperNativeMaximum(options);
