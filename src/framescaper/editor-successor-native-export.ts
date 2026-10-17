/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../common/canonical-json-sha256.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { assertFramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import { consumeFramescaperVideoFrames } from './video-export-frame-consumer.ts';
import { createFramescaperSuccessorNativeSink } from './editor-successor-native-delivery-adapter.ts';
import { framescaperSuccessorNativePlan, type FramescaperSuccessorNativeDelivery, type FramescaperSuccessorNativePlan, type FramescaperSuccessorNativeReceipt } from './editor-successor-native-delivery-contract.ts';
import { prepareFramescaperSuccessorNativePicture } from './editor-successor-native-picture.ts';
import { streamFramescaperSuccessorNativeAudio } from './editor-successor-native-audio.ts';
import type { framescaperSuccessorControllerContext } from './editor-successor-controller.ts';
type Context = ReturnType<typeof framescaperSuccessorControllerContext>;
/** Publish only after picture, PCM, timing and source cleanup complete under the captured Frame document lease. */
export async function exportFramescaperSuccessorNative(context: Context, options: {
	readonly delivery: FramescaperSuccessorNativeDelivery; readonly canvas: unknown; readonly signal?: AbortSignal;
	readonly onProgress?: (completed: number, total: number) => void;
}) {
	const environment = assertFramescaperSuccessorEnvironment(context.environment);
	const operation = context.nativeInput.begin({ signal: options.signal }); const signal = options.signal ? AbortSignal.any([operation.signal, options.signal]) : operation.signal;
	const current = () => { signal.throwIfAborted(); operation.assertCurrent(); };
	let picture: Awaited<ReturnType<typeof prepareFramescaperSuccessorNativePicture>> | null = null;
	const delivery: { sink: Awaited<ReturnType<typeof createFramescaperSuccessorNativeSink>>; plan: FramescaperSuccessorNativePlan | null } = { sink: null, plan: null };
	let primary: unknown, failed = false; let result: FramescaperSuccessorNativeReceipt | null = null;
	try {
		current(); await operation.prepare(); const project = normalizeFramescaperSuccessorProject(operation.project);
		if (typeof project.sampleRate !== 'number') throw new Error('Frame native export requires an exact project sample rate.');
		if (!project.primarySequenceId) throw new Error('Choose a primary Frame sequence before native export.');
		picture = await prepareFramescaperSuccessorNativePicture({ environment, project, canvas: options.canvas, signal, assertCurrent: current });
		const audio = picture.hasAudio ? { sampleRate: project.sampleRate, channels: 2 as const } : undefined;
		await consumeFramescaperVideoFrames(picture.strategy, picture.request, async (request, output) => {
			current(); if (!output || output.alphaMode !== 'straight' || output.precision !== 'unorm8') throw new Error('Frame finishing did not authenticate its output transfer and alpha contract.');
			const source = request.frameSource;
			if (source.startFrame !== 0) throw new Error('Native successor delivery currently exports the full primary sequence from zero.');
			const plan = framescaperSuccessorNativePlan({ identity: { projectId: project.id, revisionDigest: canonicalJsonSha256(project), sequenceId: project.primarySequenceId },
				width: source.canvas.width, height: source.canvas.height, frameRate: source.canvas.frameRate, firstFrame: 0, frameCount: source.frameCount });
			delivery.plan = plan; delivery.sink = await createFramescaperSuccessorNativeSink(options.delivery, { plan, inputEncoding: output.encoding, suggestedName: `${project.title || 'Frame sequence'}.mov`, audio, signal });
			if (!delivery.sink) return;
			const rgba = new Uint8Array(request.producer.byteLength);
			try {
				for (let index = 0; index < source.frameCount; index++) {
					current(); await request.producer.produce(source.frame(index), rgba, { signal }); current();
					await delivery.sink.writeRgba(index, rgba, signal); options.onProgress?.(index + 1, source.frameCount);
					await new Promise<void>(resolve => setTimeout(resolve, 0));
				}
			} finally { rgba.fill(0); }
		});
		if (delivery.sink) {
			if (delivery.sink.audio && delivery.plan) {
				const projection = environment.playback.projectForPlayback(project).project;
				await streamFramescaperSuccessorNativeAudio({ operation, project: projection, plan: delivery.plan, audio: delivery.sink.audio, signal, assertCurrent: current });
			}
			picture.release(); picture = null; await operation.releaseMedia(); current();
			result = await delivery.sink.finish(signal);
		}
	} catch (error) {
		failed = true; primary = error;
		try { await delivery.sink?.abort(error); } catch (cleanup) { primary = new AggregateError([error, cleanup], 'Frame native delivery and cleanup failed.', { cause: cleanup }); }
	}
	const failures: unknown[] = [];
	try { picture?.release(); } catch (error) { failures.push(error); }
	try { await operation.finish(); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Frame native export input cleanup failed.', { cause: failed ? primary : failures[0] });
	if (failed) throw primary;
	return result;
}
