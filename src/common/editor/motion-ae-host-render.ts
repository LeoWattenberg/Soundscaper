/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeFootage, MotionAeReportEntry } from './motion-ae-exchange-types.ts';
export interface MotionAeRenderComposition {
	readonly id: string; readonly name: string; readonly width: number; readonly height: number; readonly pixelAspect: number; readonly frameRate: number; readonly duration: number;
}
export interface MotionAeRenderedPng {
	readonly index: number; readonly byteLength: number; readonly width: number; readonly height: number; readonly bitDepth: number; readonly alphaChannels: boolean;
}
export interface MotionAeRenderTransaction {
	readonly templates: readonly string[];
	chooseTemplate(): string | null;
	/** Configure full span from zero, composition frame rate, no skipped frames and no post-render project action. */
	configure(template: string, duration: number): void;
	render(): void;
	frames(): readonly MotionAeRenderedPng[];
	retain(frame: MotionAeRenderedPng, id: string): { readonly path: string; readonly byteLength: number };
	removeQueueItem(): void;
}
export interface MotionAeRenderHost {
	readonly queueLength: number; readonly rendering: boolean; checkCancelled(): void;
	begin(composition: MotionAeRenderComposition): MotionAeRenderTransaction;
}
export interface MotionAeRenderedComposition { readonly footage: readonly MotionAeFootage[]; readonly report: readonly MotionAeReportEntry[] }

/** Entire composition fallback: no isolated effect/layer baking can discard cross-layer dependencies. */
export function renderMotionAeHostComposition(composition: MotionAeRenderComposition, host: MotionAeRenderHost): MotionAeRenderedComposition {
	host.checkCancelled();
	if (host.rendering || host.queueLength !== 0) throw new Error('AE fallback requires an empty render queue. Existing queue items are never toggled or removed.');
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(composition.id) || !isFinite(composition.frameRate) || composition.frameRate < 1 || composition.frameRate > 1000
		|| composition.width < 1 || composition.height < 1 || Math.floor(composition.width) !== composition.width || Math.floor(composition.height) !== composition.height) throw new Error('AE fallback composition authority is invalid.');
	const count = Math.round(composition.duration * composition.frameRate), estimated = composition.width * composition.height * 8 * count;
	if (!isFinite(count) || count < 1 || count > 2048 || Math.abs(composition.duration * composition.frameRate - count) > 0.000001
		|| composition.pixelAspect !== 1 || estimated > 8 * 1024 * 1024 * 1024 || composition.width * composition.height * 8 > 64 * 1024 * 1024) throw new Error('AE PNG fallback frame/surface budget exceeded. Use a shorter square-pixel composition.');
	const transaction = host.begin(composition); let failed = false, primary: unknown, result: MotionAeRenderedComposition | undefined;
	try {
		if (transaction.templates.length > 128) throw new Error('AE output template budget exceeded.');
		for (let index = 0; index < transaction.templates.length; index++) if (transaction.templates[index]!.length > 256) throw new Error('AE template name budget exceeded.');
		const template = transaction.chooseTemplate(); if (template === null) throw new Error('AE fallback cancelled.');
		let found = false; for (let index = 0; index < transaction.templates.length; index++) {
			if (transaction.templates[index]!.length > 256) throw new Error('AE template name budget exceeded.');
			if (transaction.templates[index] === template) found = true;
		}
		if (!found) throw new Error('Choose an installed PNG output template by its exact name.');
		host.checkCancelled(); transaction.configure(template, composition.duration); transaction.render(); host.checkCancelled();
		const frames = transaction.frames().slice().sort((a, b) => a.index - b.index);
		if (frames.length !== count) throw new Error('AE fallback did not produce the complete composition frame sequence.');
		const footage: MotionAeFootage[] = [], report: MotionAeReportEntry[] = []; let total = 0;
		for (let index = 0; index < frames.length; index++) {
			host.checkCancelled(); const frame = frames[index]!;
			if (!isFinite(frame.index) || Math.floor(frame.index) !== frame.index || (index > 0 && frame.index !== frames[index - 1]!.index + 1)) throw new Error('AE fallback frame numbering is incomplete or ambiguous.');
			if (frame.width !== composition.width || frame.height !== composition.height || frame.bitDepth !== 8 || !frame.alphaChannels) throw new Error('Choose a full-size 8-bit PNG template with alpha channels. Actual AE alpha/color reference qualification remains required.');
			total += frame.byteLength;
			if (!isFinite(frame.byteLength) || Math.floor(frame.byteLength) !== frame.byteLength || frame.byteLength < 33 || frame.byteLength > 64 * 1024 * 1024 || total > 8 * 1024 * 1024 * 1024) throw new Error('AE fallback media byte budget exceeded.');
			const id = 'render-' + composition.id + '-frame-' + String(index), retained = transaction.retain(frame, id);
			if (retained.path !== 'media/' + id + '.png' || retained.byteLength !== frame.byteLength) throw new Error('AE fallback retained frame identity changed.');
			footage.push({ id, name: composition.name.slice(0, 980) + ' — rendered frame ' + String(index), path: retained.path, byteLength: retained.byteLength, sha256: null,
				width: frame.width, height: frame.height, pixelAspect: 1, frameRate: composition.frameRate, duration: 0, hasVideo: true, hasAudio: false, still: true });
			report.push({ scopeId: composition.id, propertyPath: 'frame/' + String(index), status: 'rendered', code: 'composition-render-frame', mediaId: id,
				message: 'Whole-composition 8-bit PNG frame from a user-selected AE template. Alpha/color/reference fidelity is unqualified; this image sequence carries no audio.' });
		}
		result = { footage, report };
	} catch (error) { failed = true; primary = error; }
	try { transaction.removeQueueItem(); } catch (cleanup) {
		if (!failed) throw cleanup;
		const cause = { primary, cleanup }, error = new Error('AE fallback failed: ' + String(primary) + '; queue cleanup failed: ' + String(cleanup), { cause }); error.cause = cause; throw error;
	}
	if (failed) throw primary; return result!;
}
