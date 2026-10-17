/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';

export function useCapturedMethod<T extends (...args: never[]) => unknown>(method: T, receiver: unknown): T;
export function useCapturedMethod<T extends (...args: never[]) => unknown>(method: T | undefined, receiver: unknown): T | undefined;
export function useCapturedMethod<T extends (...args: never[]) => unknown>(method: T | undefined, receiver: unknown): T | undefined {
	const capture = () => ({ method, invoke: method ? ((...args: Parameters<T>) => Reflect.apply(method, receiver, args)) as T : undefined });
	const pinned = useRef(capture()); if (pinned.current.method !== method) pinned.current = capture();
	return pinned.current.invoke;
}
