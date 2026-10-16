/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { ImageDevelopMaskOverlayViewV1 } from './image-develop-mask-overlay-v1.ts';
import { captureImageDevelopRawRequestCurrentV1 } from './image-develop-raw-request-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1, CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-metadata-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from './image-develop-linear-current-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { withPixelFrameWebGl2CurrentV1 } from './pixel-frame-webgl2-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1, PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface ImageDevelopGpuExecutionCurrentV1 { readonly backend: 'webgl2' | 'cpu'; readonly reason?: string }
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** The complete Current recipe remains authoritative. GPU stage coverage grows
 * behind this broker; an unfinished family selects the entire unchanged CPU
 * render before GPU work. GPU/capability fallback never replays a consumer. */
export async function withImageDevelopGpuCurrentV1<Result>(value: unknown,
	consume: (frame: Readonly<LinearWorkingPixelFrameV1>, execution: Readonly<ImageDevelopGpuExecutionCurrentV1>, overlay?: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>,
	profile: ImageDevelopFrameProfile, options: ImageDevelopFrameOptionsV3 = {}): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('GPU Develop signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (typeof consume !== 'function') throw new TypeError('GPU Develop requires a scoped consumer.');
	const request = captureImageDevelopRawRequestCurrentV1(value);
	const plan = prepareLinearDevelopMetadataCurrentV1(request, profile, options); check();
	const ownedOptions = Object.freeze({ ...(plan.source ? { source: plan.source } : {}), ...(plan.maskSource ? { maskSource: plan.maskSource } : {}) });
	const cpu = (frame: unknown, reason: string) => withImageDevelopLinearCurrentV1({ ...request, frame },
		(output, overlay) => consume(output, Object.freeze({ backend: 'cpu', reason }), overlay), plan.profile, ownedOptions);
	const unsupported = plan.repairs || plan.masks.plan.bindings.length || plan.masks.references.length || request.maskOverlay
		|| plan.stages.some(stage => stage.kind !== 'noop' && stage.kind !== 'color');
	const effects = plan.stages.flatMap(stage => stage.kind === 'color' ? [stage.effect] : []);
	const passes = unsupported ? [] : preparePixelFrameWebGl2ColorsCurrentV1(effects);
	const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const floatBytes = plan.descriptor.width * plan.descriptor.height * 16;
	// An unsupported GL attempt may retain its captured source while the CPU
	// oracle works. Admit that overlap before creating a context or snapshot.
	const raw = record(plan.raw, 'GPU Develop native frame', ['descriptor', 'pixels']);
	const frame = readPixelFrameV1({ descriptor: plan.sourcePlan.descriptor, pixels: field(raw, 'pixels', 'GPU Develop native frame') }, plan.profile.source);
	if (unsupported) return cpu(frame, 'unsupported-stage');
	const physicalBytes = Number(Reflect.apply(SIZE, Reflect.apply(BUFFER, frame.pixels, []), []));
	const outputPixels = plan.finalDescriptor.width * plan.finalDescriptor.height;
	const presentationBytes = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
	const peak = Math.max(physicalBytes + 4 * floatBytes + presentationBytes + uniformBytes,
		physicalBytes + plan.peakWorkingBytes - plan.sourcePlan.byteLength + floatBytes,
		physicalBytes + floatBytes + 1024);
	if (peak > CURRENT_LINEAR_WORKING_BYTES_V1) return cpu(frame, 'working-set');
	return withPixelFrameWebGl2CurrentV1({ frame, passes, ...(signal ? { signal } : {}) }, view => {
		if (view.backend === 'cpu') return cpu(view.source, view.reason);
		return consume(view.frame, Object.freeze({ backend: 'webgl2' }));
	});
}
