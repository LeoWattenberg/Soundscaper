/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Audacity dynamics timeline trace geometry and colors, adapted from
 * d7c60d876efbff48be78a7bcf472a3baf632ea4c DynamicsTimeline.
 */

interface ActivitySample {
	readonly inputDb: number;
	readonly outputDb: number;
	readonly reductionDb: number;
}

interface ActivityDrawOptions {
	readonly audacity?: boolean;
	readonly limiter?: boolean;
	readonly show?: { readonly input?: boolean; readonly output?: boolean; readonly compression?: boolean };
}

export function drawDynamicsActivityCanvas(
	canvas: HTMLCanvasElement | null,
	trail: readonly ActivitySample[],
	capacity: number,
	options: ActivityDrawOptions = {},
): void {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
	const width = Math.max(1, Math.round(rect.width * ratio));
	const height = Math.max(1, Math.round(rect.height * ratio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext('2d');
	if (!context) return;
	context.clearRect(0, 0, width, height);
	const floor = options.limiter ? -12 : -48;
	const row = (db: number) => options.audacity
		? height * Math.max(0, Math.min(1, db / floor))
		: height * (1 - (Math.max(-60, Math.min(6, db)) + 60) / 66);
	const columnWidth = width / Math.max(1, capacity);
	const columnAt = (index: number) => (index + (options.audacity ? Math.max(0, capacity - trail.length) : 0)) * columnWidth;
	const path = (pick: (sample: ActivitySample) => number, color: string, fill = false) => {
		if (trail.length < 2) return;
		context.beginPath();
		if (fill) context.moveTo(columnAt(0), height);
		for (let index = 0; index < trail.length; index += 1) {
			const y = pick(trail[index]!);
			if (index === 0 && !fill) context.moveTo(columnAt(index), y);
			else context.lineTo(columnAt(index), y);
		}
		if (fill) {
			context.lineTo(columnAt(trail.length - 1), height);
			context.closePath();
			context.fillStyle = color;
			context.fill();
		} else {
			context.strokeStyle = color;
			context.lineWidth = (options.audacity ? 1 : 1.5) * ratio;
			context.lineJoin = 'round';
			context.stroke();
		}
	};
	if (options.audacity) {
		if (options.show?.input !== false) path(sample => row(sample.inputDb), '#56569580', true);
		if (options.show?.output !== false) {
			path(sample => row(sample.outputDb), '#56569580', true);
			path(sample => row(sample.outputDb), '#FFFFFF80');
		}
		if (options.show?.compression !== false) path(sample => row(sample.reductionDb), '#FFD12C80');
		return;
	}
	if (trail.length >= 2 && options.show?.compression !== false) {
		context.beginPath();
		context.moveTo(columnAt(0), 0);
		for (let index = 0; index < trail.length; index += 1) {
			context.lineTo(columnAt(index), height * (-trail[index]!.reductionDb / 24));
		}
		context.lineTo(columnAt(trail.length - 1), 0);
		context.closePath();
		context.fillStyle = 'rgba(255, 176, 82, 0.28)';
		context.fill();
	}
	if (options.show?.input !== false) path(sample => row(sample.inputDb), 'rgba(82, 155, 255, 0.75)');
	if (options.show?.output !== false) path(sample => row(sample.outputDb), 'rgba(76, 222, 154, 0.9)');
}
