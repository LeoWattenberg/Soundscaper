/* SPDX-License-Identifier: AGPL-3.0-only */

export interface UpstreamDeadline {
	readonly signal: AbortSignal;
	readonly timedOut: () => boolean;
	readonly refresh: () => void;
	readonly dispose: () => void;
}

export function createUpstreamDeadline(requestSignal: AbortSignal, timeoutMs: number): UpstreamDeadline {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	const relayAbort = () => controller.abort(requestSignal.reason);
	const dispose = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		requestSignal.removeEventListener('abort', relayAbort);
	};
	const refresh = () => {
		if (controller.signal.aborted) return;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			timedOut = true;
			controller.abort(new DOMException('Freesound request timed out.', 'TimeoutError'));
		}, timeoutMs);
	};
	if (requestSignal.aborted) relayAbort();
	else requestSignal.addEventListener('abort', relayAbort, { once: true });
	refresh();
	return { signal: controller.signal, timedOut: () => timedOut, refresh, dispose };
}

export function createBoundedPreviewStream(
	body: ReadableStream<Uint8Array>,
	deadline: UpstreamDeadline,
	maximumBytes: number,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	let bytes = 0;
	let settled = false;
	let output: ReadableStreamDefaultController<Uint8Array>;
	const cleanup = () => {
		deadline.signal.removeEventListener('abort', abort);
		deadline.dispose();
	};
	const abort = () => {
		if (settled) return;
		settled = true;
		const reason = deadline.signal.reason ?? new DOMException('Freesound request aborted.', 'AbortError');
		cleanup();
		output.error(reason);
		void reader.cancel(reason).catch(() => undefined);
	};
	return new ReadableStream<Uint8Array>({
		start(controller) {
			output = controller;
			deadline.signal.addEventListener('abort', abort, { once: true });
			if (deadline.signal.aborted) abort();
		},
		async pull(controller) {
			try {
				const next = await reader.read();
				if (settled) return;
				if (next.done) {
					settled = true;
					cleanup();
					controller.close();
					reader.releaseLock();
					return;
				}
				bytes += next.value.byteLength;
				if (bytes > maximumBytes) {
					const error = new Error('Freesound preview exceeded its byte limit.');
					settled = true;
					cleanup();
					controller.error(error);
					await reader.cancel(error).catch(() => undefined);
					return;
				}
				deadline.refresh();
				controller.enqueue(next.value);
			} catch (error) {
				if (settled) return;
				settled = true;
				cleanup();
				controller.error(error);
			}
		},
		async cancel(reason) {
			if (settled) return;
			settled = true;
			cleanup();
			await reader.cancel(reason);
		},
	});
}
