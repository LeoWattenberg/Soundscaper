/* SPDX-License-Identifier: AGPL-3.0-only */

/** One correlated cancel message lets a worker stop native children before thread termination. */

export interface AssistanceRuntimeFamilyCancelPort {
	on(event: 'message', listener: (value: unknown) => void): unknown;
	off(event: 'message', listener: (value: unknown) => void): unknown;
}

export function bindAssistanceRuntimeFamilyCancellationV1(
	port: AssistanceRuntimeFamilyCancelPort,
	jobId: string,
): Readonly<{ signal: AbortSignal; dispose(): void }> {
	const controller = new AbortController();
	const cancel = (value: unknown): void => {
		if (value && typeof value === 'object' && !Array.isArray(value)
			&& Object.keys(value).length === 2
			&& (value as { type?: unknown }).type === 'cancel'
			&& (value as { jobId?: unknown }).jobId === jobId) {
			controller.abort(new DOMException('The runtime-family job was cancelled.', 'AbortError'));
		}
	};
	port.on('message', cancel);
	return Object.freeze({
		signal: controller.signal,
		dispose: () => { port.off('message', cancel); },
	});
}
