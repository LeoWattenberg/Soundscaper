/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeVideoColorGradeV1, type VideoColorGradeV1 } from '../video-color-management-v27.ts';
import type { ParsedCubeLutV1 } from '../video-color-cube-lut-v27.ts';
import { withCubeLutResourceV1 } from './cube-lut-resource-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, writeLinearKernelPixelV1 } from './linear-kernel-planes-v1.ts';
import { sampleLinearCubeLutChannelCurrentV1 as sample } from './linear-cube-lut-sampling-current-v1.ts';

/** Conservative parser/transient planning reserve, not an exact JS heap claim.
 * The outer pipeline also charges both selected/raw byte spans separately.
 * The existing parser caps16MiB text and65³×3 numeric lattice scalars. */
export { LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1 } from './linear-cube-lut-sampling-current-v1.ts';

function gradeChannel(value: number, grade: VideoColorGradeV1, channel: 0 | 1 | 2, exposure: number): number {
	const contrasted = value * exposure * grade.contrast + grade.pivot * (1 - grade.contrast);
	const gained = (contrasted + grade.lift[channel]) * grade.gain[channel];
	return grade.gamma[channel] === 1 ? gained : Math.sign(gained) * Math.abs(gained) ** (1 / grade.gamma[channel]);
}
/** Write one managed native-linear stage into a caller-owned destination.
 * Complete grade/geometry/native planes are captured synchronously. A real LUT
 * is digest/geometry authenticated before any destination write and remains
 * borrowed through the joined loop. Only the authored LUT input domain clamps;
 * grade and lattice output retain signed/HDR values. No plane is allocated. */
export async function writeLinearManagedGradeV1(gradeValue: unknown, descriptorValue: unknown, sourceValue: Float32Array<ArrayBuffer>,
	targetValue: Float32Array<ArrayBuffer>, bytes: unknown, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const grade = normalizeVideoColorGradeV1(gradeValue), descriptor = captureLinearKernelDescriptorV1(descriptorValue);
	const planes = captureLinearKernelPlanesV1(descriptor, sourceValue, targetValue), { source, target } = planes;
	const check = () => { checkRepairSignalV1(signal); planes.check(); }; check();
	const exposure = 2 ** grade.exposureStops;
	const neutral = grade.exposureStops === 0 && grade.contrast === 1 && grade.lift.every(value => value === 0)
		&& grade.gain.every(value => value === 1) && grade.gamma.every(value => value === 1) && grade.saturation === 1;
	const write = async (lut: ParsedCubeLutV1 | null) => {
		let processed = 0;
		for (let offset = 0; offset < source.length; offset += 4) {
			let red = source[offset]!, green = source[offset + 1]!, blue = source[offset + 2]!;
			if (!neutral) {
				red = gradeChannel(red, grade, 0, exposure); green = gradeChannel(green, grade, 1, exposure); blue = gradeChannel(blue, grade, 2, exposure);
				if (grade.saturation !== 1) {
					const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
					red = y + (red - y) * grade.saturation; green = y + (green - y) * grade.saturation; blue = y + (blue - y) * grade.saturation;
				}
			}
			if (lut) {
				const r = sample(lut, red, green, blue, 0), g = sample(lut, red, green, blue, 1), b = sample(lut, red, green, blue, 2);
				red = r; green = g; blue = b;
			}
			writeLinearKernelPixelV1(target, offset, red, green, blue, source[offset + 3]!);
			if (++processed === 4096) { processed = 0; await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); }
		}
		check();
	};
	if (grade.lut === null) await write(null);
	else await withCubeLutResourceV1({ reference: grade.lut, bytes, ...(signal === undefined ? {} : { signal }) }, async resource => { await write(resource.body); });
	check();
}
