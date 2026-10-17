/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from './cube-lut-source-port-v1.ts';
import type { LinearDevelopStageV1 } from './image-develop-linear-plan-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { writeLinearManagedGradeV1 } from './pixel-frame-linear-lut-v1.ts';

/** Join source cleanup and the admitted kernel independently, even when a
 * source forgets to await its consumer or swallows a repeated delivery. */
export async function writeLinearLutStageV1(stage: Extract<LinearDevelopStageV1, { kind: 'lut' }>, source: Readonly<CubeLutSourcePortV1>,
	frame: Readonly<LinearWorkingPixelFrameV1>, target: Float32Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
	let live = true, called = false, child: Promise<void> | undefined;
	const failures: unknown[] = [], fail = (error: unknown) => { if (!failures.some(reason => Object.is(reason, error))) failures.push(error); };
	try {
		await source.withBytes(stage.reference, bytes => {
			if (!live || called) { const error = new TypeError('Native LUT consumer is repeated or retired.'); if (live) fail(error); throw error; }
			called = true;
			child = writeLinearManagedGradeV1(stage.grade, frame.descriptor, frame.pixels, target, bytes, signal);
			void child.catch(() => undefined); return child;
		}, signal ? { signal } : {});
	} catch (error) { fail(error); }
	live = false;
	if (child) try { await child; } catch (error) { fail(error); }
	else if (!failures.length) fail(new TypeError('Native LUT source completed without delivering its authenticated body.'));
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Native LUT kernel and source failed.', { cause: failures[0] });
}
