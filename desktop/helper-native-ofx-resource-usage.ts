/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact aggregate resource accounting for one admitted isolated OpenFX host job. */

import type { HelperOfxHostJobGrantV1OrV2 } from './helper-native-ofx-host-grant-v2.ts';
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import { HelperContractViolationError } from './helper-wire-admission.ts';

export function helperNativeOfxHostResourceUsage(value: HelperOfxHostJobGrantV1OrV2) {
	if (isHelperOfxInteractJobGrantV1(value)) return Object.freeze({
		inputBytes: safeSum([
			value.executable.bytes,
			value.pluginBinary.custody?.byteLength ?? value.pluginBinary.bytes,
		]),
		outputBytes: 64 * 64 * 4,
		scratchBytes: value.scratch.maximumBytes,
		dataPlaneBytes: 0,
		maximumInFlightChunks: 0,
	});
	const output = value.output.frame;
	const timing = (value.videoTimingAssets ?? []).map(({ binding }) => binding);
	const inputs = value.inputs.map(({ frame }) => frame);
	return Object.freeze({
		inputBytes: safeSum([
			value.executable.bytes,
			value.pluginBinary.custody?.byteLength ?? value.pluginBinary.bytes,
			value.plan.byteLength,
			...timing.map(({ byteLength }) => byteLength),
			...inputs.map(({ byteLength }) => byteLength),
		]),
		outputBytes: output.maximumByteLength,
		scratchBytes: value.scratch.maximumBytes,
		dataPlaneBytes: safeSum([
			value.plan.byteLength, output.maximumByteLength,
			...timing.map(({ byteLength }) => byteLength),
			...inputs.map(({ byteLength }) => byteLength),
		]),
		maximumInFlightChunks: Math.max(
			...([value.plan, output, ...timing, ...inputs]
				.map(({ maximumInFlightChunks }) => maximumInFlightChunks)),
		),
	});
}

function safeSum(values: readonly number[]): number {
	let total = 0;
	for (const value of values) {
		total += value;
		if (!Number.isSafeInteger(total)) {
			throw new HelperContractViolationError(
				'unsafe-grant', 'A helper native grant has an unsafe aggregate byte count.',
			);
		}
	}
	return total;
}
