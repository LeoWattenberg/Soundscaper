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
	const error = value as ErrorLike;
	const message = typeof error.message === 'string' ? error.message.trim() : '';
	if (message) messages.push(message);
	if (Array.isArray(error.errors)) {
		for (const nested of error.errors) collect(nested, messages, seen, depth + 1);
	}
	if (error.cause !== undefined) collect(error.cause, messages, seen, depth + 1);
}
