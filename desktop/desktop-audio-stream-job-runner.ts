/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BundledAudioCodecChild } from './bundled-audio-codec-operation-runner.ts';
import { normalizeBundledAudioCodecHelperConfiguration,
	type BundledAudioCodecHelperConfiguration, type BundledAudioCodecId } from './bundled-audio-codec-helper-configuration.ts';
import { normalizeDesktopAudioStreamPlan, audioStreamRecord } from './desktop-audio-stream-contract.ts';
import type { DesktopAudioStreamJob } from './desktop-audio-stream-service.ts';

const CODECS: Readonly<Record<string, BundledAudioCodecId>> = Object.freeze({
	flac: 'flac', mp3: 'lame', 'ogg-vorbis': 'vorbis', opus: 'opus', wavpack: 'wavpack', mp2: 'twolame',
});

/** One authenticated utility process owns each streaming encoder instance. */
export function createDesktopAudioStreamJobRunner(options: Readonly<{
	verifyPayload: (codec: BundledAudioCodecId) => Promise<BundledAudioCodecHelperConfiguration>;
	spawn: (configuration: BundledAudioCodecHelperConfiguration) => BundledAudioCodecChild;
}>): (job: DesktopAudioStreamJob, signal: AbortSignal, onProgress?: (frames: number) => void) => Promise<number> {
	return async (job, signal, onProgress): Promise<number> => {
		const plan = normalizeDesktopAudioStreamPlan(job.plan);
		const codec = CODECS[plan.tuple.format]!;
		if (signal.aborted) throw signal.reason;
		const configuration = normalizeBundledAudioCodecHelperConfiguration(await options.verifyPayload(codec));
		if (configuration.codec !== codec) throw new Error('The desktop streaming encoder payload identity drifted.');
		if (signal.aborted) throw signal.reason;
		const child = options.spawn(configuration);
		let ready = false; let result: number | null = null; let terminal = false; let stopping = false; let failure: unknown;
		let removeMessage: () => void = () => undefined; let removeExit: () => void = () => undefined;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let failJob: (reason: unknown) => void = () => undefined;
		const execution = new Promise<number>((resolve, reject) => {
			const fail = (error: unknown): void => {
				if (terminal || stopping) return; stopping = true; failure = error;
				try { child.kill(); } catch (killError) { failure = new AggregateError([error, killError], 'The desktop encoder could not stop.', { cause: killError }); }
			};
			failJob = fail;
			removeMessage = child.onMessage((value) => {
				try {
					if (terminal || stopping) return;
					if (!ready) {
						const message = audioStreamRecord(value, ['contractVersion', 'type', 'target', 'codec']);
						if (message.contractVersion !== 1 || message.type !== 'ready'
							|| message.target !== configuration.target || message.codec !== codec) {
							throw new Error('The desktop streaming encoder helper did not authenticate.');
						}
						ready = true; child.postMessage(job); return;
					}
					if ((value as { type?: unknown })?.type === 'progress') {
						const progress = audioStreamRecord(value, ['contractVersion', 'type', 'frames', 'frameCount']);
						if (progress.contractVersion !== 1 || progress.frameCount !== plan.frameCount || !Number.isSafeInteger(progress.frames)
							|| Number(progress.frames) < 0 || Number(progress.frames) > plan.frameCount) throw new Error('Invalid desktop encoder progress.');
						onProgress?.(Number(progress.frames)); return;
					}
					const message = audioStreamRecord(value, ['contractVersion', 'type', 'result']);
					const outcome = audioStreamRecord(message.result, ['contractVersion', 'status', 'outputBytes']);
					if (message.contractVersion !== 1 || message.type !== 'result' || result !== null
						|| outcome.contractVersion !== 1 || outcome.status !== 'audio-stream-executed'
						|| !Number.isSafeInteger(outcome.outputBytes) || Number(outcome.outputBytes) < 1
						|| Number(outcome.outputBytes) > plan.maximumOutputBytes) {
						throw new Error('The desktop streaming encoder helper returned invalid output.');
					}
					result = Number(outcome.outputBytes);
				} catch (error) { fail(error); }
			});
			removeExit = child.onExit((code) => {
				if (terminal) return; terminal = true;
				if (stopping) { reject(failure); return; }
				if (code !== 0 || result === null) { reject(new Error('The desktop streaming encoder helper exited without a valid result.')); return; }
				resolve(result);
			});
			timer = setTimeout(() => fail(new Error('The desktop streaming encoder exceeded its one-hour execution deadline.')), 3600_000);
			timer.unref();
		});
		const abort = (): void => { failJob(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		try { return await execution; }
		finally { signal.removeEventListener('abort', abort); if (timer) clearTimeout(timer); removeMessage(); removeExit(); }
	};
}
