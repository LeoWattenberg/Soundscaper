/* SPDX-License-Identifier: AGPL-3.0-only */

/** Requests an authenticated helper exit, falling back to a hard kill only on failure. */

export interface GracefulHelperShutdownChannel<Message> {
	postMessage(message: Message): void;
	onExit(listener: (code: number | null) => void): void;
	kill(): unknown;
}

export function awaitGracefulHelperShutdown<Message>(options: Readonly<{
	readonly channel: GracefulHelperShutdownChannel<Message>;
	readonly message: Message;
	readonly timeoutMs: number;
	readonly label: string;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
}>): Promise<void> {
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const finish = (error: Error | null): void => {
			if (settled) return;
			settled = true;
			if (timer !== null) clearTimeoutImpl(timer);
			if (error) reject(error); else resolve();
		};
		timer = setTimeoutImpl(() => {
			finish(new Error(`The ${options.label} missed its graceful shutdown deadline.`));
			try { options.channel.kill(); } catch { /* The deadline remains authoritative. */ }
		}, options.timeoutMs);
		if (!settled) (timer as { unref?: () => void }).unref?.();
		if (settled) return;
		options.channel.onExit((code) => finish(code === 0 ? null
			: new Error(`The ${options.label} exited unsuccessfully during graceful shutdown.`)));
		if (settled) return;
		try { options.channel.postMessage(options.message); }
		catch (error) {
			if (settled) return;
			finish(new Error(`The ${options.label} graceful shutdown could not be requested: ${message(error)}`));
			try { options.channel.kill(); } catch { /* The request failure remains authoritative. */ }
		}
	});
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
