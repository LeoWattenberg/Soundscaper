/* SPDX-License-Identifier: AGPL-3.0-only */

type ErrorLike = Readonly<{
	readonly message?: unknown;
	readonly cause?: unknown;
	readonly errors?: unknown;
}>;

/** Preserve bounded nested failure causes when a status surface cannot expose Error objects. */
export function errorDiagnosticMessage(error: unknown, fallback: string): string {
	const messages: string[] = [];
	collect(error, messages, new Set<object>(), 0);
	return messages.length > 0 ? messages.join(' → ') : fallback;
}

function collect(
	value: unknown,
	messages: string[],
	seen: Set<object>,
	depth: number,
): void {
	if (depth > 16 || messages.length >= 32) return;
	if (!value || typeof value !== 'object') {
		const text = String(value ?? '').trim();
		if (text) messages.push(text);
		return;
	}
	if (seen.has(value)) return;
	seen.add(value);
	const ownMessage = dataProperty(value, 'message');
	const messageValue = ownMessage === undefined ? domExceptionMessage(value) : ownMessage;
	const message = typeof messageValue === 'string' ? messageValue.trim() : '';
	if (message) messages.push(message);
	const errors = dataProperty(value, 'errors');
	if (isArray(errors)) {
		const length = safeArrayLength(errors);
		for (let index = 0; index < length && messages.length < 32; index += 1) {
			const descriptor = safeOwnPropertyDescriptor(errors, String(index));
			if (descriptor && 'value' in descriptor) collect(descriptor.value, messages, seen, depth + 1);
		}
	}
	const cause = dataProperty(value, 'cause');
	if (cause !== undefined) collect(cause, messages, seen, depth + 1);
}

function dataProperty(value: object, key: keyof ErrorLike): unknown {
	const descriptor = safeOwnPropertyDescriptor(value, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function safeOwnPropertyDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
	try { return Object.getOwnPropertyDescriptor(value, key); }
	catch { return undefined; }
}

function isArray(value: unknown): value is readonly unknown[] {
	try { return Array.isArray(value); }
	catch { return false; }
}

function safeArrayLength(value: readonly unknown[]): number {
	const length = safeOwnPropertyDescriptor(value, 'length');
	return length && 'value' in length && typeof length.value === 'number'
		&& Number.isSafeInteger(length.value) && length.value >= 0
		? Math.min(length.value, 32)
		: 0;
}

function domExceptionMessage(value: object): unknown {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(DOMException.prototype, 'message');
		return descriptor?.get?.call(value);
	} catch {
		return undefined;
	}
}
