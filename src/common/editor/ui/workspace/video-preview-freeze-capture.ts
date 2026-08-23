/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperSelectedFreezeCaptureRequestV27 } from '../../../../framescaper/editor-selected-v27-visual-authoring-commands.ts';

interface EvaluatedFrame {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly timelineSample: number;
}

interface CaptureFrame {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

export async function bindFramescaperV27PreviewFreezeCapture(input: Readonly<{
	readonly owner: object;
	readonly projectRef: Readonly<{ readonly current: unknown }>;
	readonly evaluatedRef: Readonly<{ readonly current: EvaluatedFrame | null }>;
	readonly compositorRef: Readonly<{ readonly current: Readonly<{
		captureEvaluatedRgba(): CaptureFrame | null;
	}> | null }>;
}>): Promise<() => void> {
	const binding = await import('../../../../framescaper/editor-selected-v27-freeze-capture.ts');
	return binding.bindFramescaperSelectedFreezeCaptureV27(input.owner, Object.freeze({
		async capture(request: FramescaperSelectedFreezeCaptureRequestV27) {
			assertCurrent(input, request);
			const evaluated = input.compositorRef.current?.captureEvaluatedRgba() ?? null;
			if (!evaluated) throw new Error('The exact evaluated preview frame is unavailable.');
			assertCurrent(input, request);
			return Object.freeze({
				blob: await encodePng(evaluated),
				width: evaluated.width,
				height: evaluated.height,
			});
		},
	}));
}

function assertCurrent(
	input: Readonly<{ readonly projectRef: Readonly<{ readonly current: unknown }>;
		readonly evaluatedRef: Readonly<{ readonly current: EvaluatedFrame | null }> }>,
	request: FramescaperSelectedFreezeCaptureRequestV27,
): void {
	const project = record(input.projectRef.current, 'freeze preview project');
	const evaluated = input.evaluatedRef.current;
	if (project.id !== request.projectId || project.revision !== request.projectRevision
		|| evaluated?.projectId !== request.projectId
		|| evaluated.projectRevision !== request.projectRevision
		|| evaluated.timelineSample !== request.timelineSample) {
		throw new Error('The evaluated freeze preview is stale. Wait for the playhead frame and retry.');
	}
}

async function encodePng(frame: CaptureFrame): Promise<Blob> {
	if (!Number.isSafeInteger(frame.width) || frame.width < 1
		|| !Number.isSafeInteger(frame.height) || frame.height < 1
		|| !(frame.rgba instanceof Uint8Array)
		|| frame.rgba.byteLength !== frame.width * frame.height * 4) {
		throw new RangeError('The evaluated freeze pixels have invalid geometry.');
	}
	const canvas = document.createElement('canvas');
	canvas.width = frame.width;
	canvas.height = frame.height;
	const context = canvas.getContext('2d', { alpha: true });
	if (!context) throw new Error('PNG freeze encoding requires a 2D canvas.');
	const pixels = new Uint8ClampedArray(frame.rgba.byteLength);
	pixels.set(frame.rgba);
	// A freeze is the evaluated programme picture, including the preview's
	// resolved black canvas. Preserve it as an opaque still so moving layers
	// below transparent letterbox pixels cannot leak through later.
	for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
	context.putImageData(new ImageData(
		pixels,
		frame.width, frame.height,
	), 0, 0);
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((value) => {
			if (value) resolve(value);
			else reject(new Error('The evaluated freeze frame could not be encoded.'));
		}, 'image/png');
	});
	if (blob.type !== 'image/png') throw new TypeError('The freeze encoder did not return PNG media.');
	return blob;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}
