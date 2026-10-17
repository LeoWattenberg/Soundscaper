/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { captureLinearKernelDescriptorV1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { readPixelFrameWebGl2RepairCurrentV1, writePixelFrameWebGl2RepairReferenceCurrentV1 } from './pixel-frame-webgl2-repair-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
/** The caller owns initial and admits2M+S. At most two native planes plus exact
 * serial Float64 scratch coexist. Its owner.run joins any primary/cleanup
 * failure; on success scratch and initial retire before an authored slot. */
export async function replayPixelFrameWebGl2RepairPrefixCurrentV1(value: unknown, initial: Readonly<LinearWorkingPixelFrameV1>,
	owner: LinearDevelopOwnerV1, checkValue: () => void, signalValue?: AbortSignal): Promise<Readonly<LinearWorkingPixelFrameV1>> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const prefix = readPixelFrameWebGl2RepairCurrentV1(value);
	if (typeof checkValue !== 'function') throw new TypeError('Repair replay needs the captured source/currentness check.');
	const check = () => { checkRepairSignalV1(signal); if (Reflect.apply(checkValue, undefined, []) !== undefined) throw new TypeError('Repair replay currentness must complete synchronously.'); };
	check(); const raw = record(initial, 'repair replay source', ['descriptor', 'pixels']), descriptor = captureLinearKernelDescriptorV1(field(raw, 'descriptor', 'repair replay source'));
	if (descriptor.width !== prefix.descriptor.width || descriptor.height !== prefix.descriptor.height || descriptor.primaries !== prefix.descriptor.primaries) throw new RangeError('Repair replay source differs from its private aperture.');
	if (!prefix.hasActive) return initial;
	const target = owner.floats(prefix.frameBytes / 4), scratch = owner.bytes(prefix.scratchBytes);
	await writePixelFrameWebGl2RepairReferenceCurrentV1(prefix, initial, target, scratch, signal); check();
	owner.retire(scratch.buffer); owner.retire(initial.pixels.buffer);
	return Object.freeze({ descriptor: initial.descriptor, pixels: target });
}
