/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact native-enforcement handshake and bounded pre-enforcement diagnostics. */

import type { Readable } from 'node:stream';

import type { NativeChildIsolationCompletion } from './native-child-isolation-contract.ts';

const ENFORCEMENT_FRAME = Buffer.from('M5_NATIVE_ISOLATION_ENFORCED_V1\n');
const NATIVE_FAILURE = /(?:^|\n)M5_NATIVE_ISOLATION_FAILURE_V1 (windows|macos) ([a-z][a-z-]{0,63}) (\d{1,10})(?:\n|$)/u;

export function waitForNativeChildEnforcement(stream: Readable, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let bytes = Buffer.alloc(0);
		const timer = setTimeout(() => settle(new Error('The isolation launcher enforcement handshake timed out.')),
			timeoutMs);
		const settle = (error: Error | null) => {
			clearTimeout(timer);
			stream.off('data', onData); stream.off('error', onError); stream.off('end', onEnd);
			if (error) reject(error); else resolve();
		};
		const onData = (chunk: Buffer) => {
			bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
			if (bytes.byteLength > ENFORCEMENT_FRAME.byteLength) {
				settle(new Error('The enforcement handshake is malformed.'));
			}
		};
		const onError = (error: Error) => { settle(error); };
		const onEnd = () => settle(bytes.equals(ENFORCEMENT_FRAME)
			? null : new Error('The enforcement handshake ended early.'));
		stream.on('data', onData); stream.once('error', onError); stream.once('end', onEnd);
	});
}

export function nativeChildEnforcementFailure(
	error: unknown,
	outcome: NativeChildIsolationCompletion | null,
): Error {
	const cause = error instanceof Error ? error : new Error(String(error));
	if (outcome === null) return cause;
	const diagnostic = NATIVE_FAILURE.exec(outcome.stderr);
	const detail = diagnostic === null ? ''
		: `; diagnostic=${diagnostic[1]} ${diagnostic[2]} ${diagnostic[3]}`;
	return new Error(`${cause.message} Native launcher outcome: exit=${String(outcome.exitCode)}, `
		+ `signal=${outcome.signal ?? 'none'}${detail}.`, { cause });
}
