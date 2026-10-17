/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { planImageExportSizeV1 } from './image-export-size-v1.ts';
import { writeImageGeometryPointV1 } from './image-geometry-plan-v1.ts';
import { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1, writeLinearKernelPixelV1, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { captureLinearOutputPlanesV1, linearOutputMappingV1, sampleLinearOutputV1 } from './linear-output-sampling-v1.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import type { GraphicWatermarkPlacementV1 } from './pixel-frame-graphic-watermark-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PreparedLinearGraphicOverlayV1 {
	readonly descriptor: LinearKernelDescriptorV1;
	readonly sampleCount: number;
	readonly byteLength: number;
	readonly graphicWidth: number;
	readonly graphicHeight: number;
	readonly originX: number;
	readonly originY: number;
}
interface State {
	readonly source: LinearKernelDescriptorV1;
	readonly graphic: Readonly<PixelFrameDescriptorV1>;
	readonly opacity: number;
	readonly mapping: ReturnType<typeof linearOutputMappingV1>;
}
const PLANS = new WeakMap<PreparedLinearGraphicOverlayV1, Readonly<State>>();
const NativeBytes = Uint8Array;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Preserve the existing graphic fit, margin and nine-anchor placement. The
 * encoded graphic/glyph remains borrowed; no resized byte plane is created. */
export function prepareLinearGraphicOverlayV1(placementValue: unknown, graphicValue: unknown, sourceValue: unknown,
	limits: PixelFrameLimitsV1): Readonly<PreparedLinearGraphicOverlayV1> {
	const source = captureLinearKernelDescriptorV1(sourceValue);
	const rawLimits = record(limits, 'linear graphic limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const capturedLimits = Object.freeze({ maximumSidePixels: field(rawLimits, 'maximumSidePixels', 'linear graphic limits'),
		maximumPixels: field(rawLimits, 'maximumPixels', 'linear graphic limits'), maximumBytes: field(rawLimits, 'maximumBytes', 'linear graphic limits') });
	const output = planPixelFrameV1(source, capturedLimits), graphic = planPixelFrameV1(graphicValue, capturedLimits);
	planPixelFrameV1(graphic.descriptor, LINEAR_KERNEL_LIMITS_V1);
	if (graphic.descriptor.sampleFormat !== 'unorm8' || graphic.descriptor.primaries !== 'srgb' || graphic.descriptor.transfer !== 'srgb') {
		throw new RangeError('Linear graphic overlay requires an encoded RGBA8 sRGB graphic or glyph.');
	}
	const placement = capturePlacement(placementValue, source.width, source.height);
	const fitted = planImageExportSizeV1(graphic.descriptor, { kind: 'fit',
		width: Math.max(1, Math.round((source.width - 2 * placement.marginPixels) * placement.widthFraction)),
		height: source.height - 2 * placement.marginPixels, allowUpscale: true }, capturedLimits);
	const [vertical, horizontal] = placement.anchor.split('-'), graphicWidth = fitted.target.width, graphicHeight = fitted.target.height;
	const prepared = Object.freeze({ descriptor: source, sampleCount: output.sampleCount, byteLength: output.byteLength,
		graphicWidth, graphicHeight, originX: position(horizontal!, source.width, graphicWidth, placement.marginPixels),
		originY: position(vertical!, source.height, graphicHeight, placement.marginPixels) });
	PLANS.set(prepared, Object.freeze({ source, graphic: graphic.descriptor, opacity: placement.opacity,
		mapping: linearOutputMappingV1(graphic.descriptor.width, graphic.descriptor.height, graphicWidth, graphicHeight) }));
	return prepared;
}

/** Normal alpha-over in native linear RGB. Decode graphic taps before filtering,
 * retain signed/HDR source samples, and leave zero-coverage pixels bit-exact.
 * The outer owner accounts for and retires source, glyph and destination. */
export async function writeLinearGraphicOverlayV1(plan: PreparedLinearGraphicOverlayV1, sourceFrame: Readonly<LinearWorkingPixelFrameV1>,
	graphicFrame: Readonly<PixelFrameV1>, target: Float32Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue);
	let state: Readonly<State>, graphic: ReturnType<typeof captureGraphic>, planes: ReturnType<typeof captureLinearOutputPlanesV1>;
	try {
		const admitted = PLANS.get(plan);
		if (!admitted) throw new TypeError('Linear graphic overlay requires an authenticated owning plan.');
		state = admitted; graphic = captureGraphic(graphicFrame, state.graphic);
		planes = captureLinearOutputPlanesV1(sourceFrame, state.source, target, plan.descriptor);
		if (graphic.pixels.buffer === planes.source.buffer || graphic.pixels.buffer === planes.target.buffer) throw new TypeError('Linear graphic overlay requires separate graphic and image backings.');
	} catch (error) { checkRepairSignalV1(signal); throw error; }
	const check = () => { checkRepairSignalV1(signal); planes.check(); graphic.check(); };
	const budget = new RepairTaskBudgetV1(check), point = { x: 0, y: 0 }, sample = { red: 0, green: 0, blue: 0, alpha: 0 };
	check();
	for (let pixel = 0; pixel < plan.sampleCount / 4; pixel++) {
		const offset = pixel * 4;
		writeLinearKernelPixelV1(planes.target, offset, planes.source[offset]!, planes.source[offset + 1]!, planes.source[offset + 2]!, planes.source[offset + 3]!);
		if (budget.visit()) await budget.yield();
	}
	if (state.opacity !== 0) for (let pixel = 0; pixel < plan.graphicWidth * plan.graphicHeight; pixel++) {
		const x = pixel % plan.graphicWidth, y = Math.floor(pixel / plan.graphicWidth);
		if (writeImageGeometryPointV1(state.mapping, x + .5, y + .5, point)) {
			sampleLinearOutputV1(graphic.pixels, state.graphic.width, state.graphic.height, point.x - .5, point.y - .5, true, sample);
			const foregroundAlpha = sample.alpha * state.opacity;
			if (foregroundAlpha !== 0) {
				const offset = ((plan.originY + y) * state.source.width + plan.originX + x) * 4;
				const backgroundAlpha = planes.source[offset + 3]!, remainder = backgroundAlpha * (1 - foregroundAlpha);
				const alpha = Math.max(0, Math.min(1, foregroundAlpha + remainder));
				const red = (sample.red * foregroundAlpha + planes.source[offset]! * remainder) / alpha;
				const green = (sample.green * foregroundAlpha + planes.source[offset + 1]! * remainder) / alpha;
				const blue = (sample.blue * foregroundAlpha + planes.source[offset + 2]! * remainder) / alpha;
				writeLinearKernelPixelV1(planes.target, offset, red, green, blue, alpha);
			}
		}
		if (budget.visit()) await budget.yield();
	}
	check();
}

function captureGraphic(value: unknown, expected: Readonly<PixelFrameDescriptorV1>) {
	const frame = readPixelFrameV1(value, LINEAR_KERNEL_LIMITS_V1), actual = frame.descriptor;
	if (actual.width !== expected.width || actual.height !== expected.height || actual.sampleFormat !== 'unorm8'
		|| actual.primaries !== 'srgb' || actual.transfer !== 'srgb') throw new RangeError('Linear graphic descriptor does not match its prepared binding.');
	const buffer = frame.pixels.buffer, byteLength = expected.width * expected.height * 4;
	if (frame.pixels.byteOffset !== 0 || Reflect.apply(SIZE, buffer, []) !== byteLength) throw new TypeError('Linear graphic requires an exact dedicated fixed backing.');
	const pixels = new NativeBytes(buffer), check = () => {
		if (Reflect.apply(SIZE, buffer, []) !== byteLength) throw new TypeError('Linear graphic backing detached or changed.');
		void new NativeBytes(buffer, 0, 0);
	};
	check(); return Object.freeze({ pixels, check });
}

function capturePlacement(value: unknown, width: number, height: number): Readonly<GraphicWatermarkPlacementV1> {
	const input = record(value, 'linear graphic placement', ['anchor', 'widthFraction', 'marginPixels', 'opacity']);
	const anchor = field(input, 'anchor', 'linear graphic placement');
	if (typeof anchor !== 'string' || !/^(?:top|middle|bottom)-(?:left|center|right)$/u.test(anchor)) throw new RangeError('Unsupported linear graphic anchor.');
	const unit = (key: string, minimum: number) => {
		const value = field(input, key, 'linear graphic placement');
		if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 1) throw new RangeError('Linear graphic placement is outside its numeric domain.');
		return value;
	};
	const widthFraction = unit('widthFraction', Number.MIN_VALUE), opacity = unit('opacity', 0), marginPixels = field(input, 'marginPixels', 'linear graphic placement');
	if (typeof marginPixels !== 'number' || !Number.isSafeInteger(marginPixels) || marginPixels < 0 || marginPixels > Math.floor((Math.min(width, height) - 1) / 2)) throw new RangeError('Linear graphic margin is outside its integer domain.');
	return Object.freeze({ anchor: anchor as GraphicWatermarkPlacementV1['anchor'], widthFraction, opacity, marginPixels });
}

function position(anchor: string, side: number, graphic: number, margin: number): number {
	return anchor === 'top' || anchor === 'left' ? margin : anchor === 'bottom' || anchor === 'right' ? side - margin - graphic : Math.floor((side - graphic) / 2);
}
