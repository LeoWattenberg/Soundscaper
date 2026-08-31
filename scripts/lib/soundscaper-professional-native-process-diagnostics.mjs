/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, secret-redacted diagnostics for target-native subprocess failures. */

const MAXIMUM_FAILURE_DIAGNOSTIC_BYTES = 4 * 1024;
const MAXIMUM_FAILURE_MESSAGE_BYTES = 16 * 1024;
const ANSI_ESCAPE_SEQUENCE = new RegExp(String.raw`\u001b\[[\d;?]*[ -/]*[@-~]`, 'gu');
const UNSAFE_CONTROL_CHARACTER = new RegExp(
	String.raw`[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]`, 'gu',
);

export function soundscaperProfessionalNativeProcessFailureMessage(
	label, result, environment = process.env,
) {
	const status = Number.isInteger(result?.status) ? String(result.status) : 'none';
	const signal = typeof result?.signal === 'string' && result.signal !== ''
		? result.signal : 'none';
	const details = [];
	const error = result?.error instanceof Error ? result.error.message
		: typeof result?.error === 'string' ? result.error : '';
	for (const [name, value] of [
		['spawn-error', error], ['stderr', result?.stderr], ['stdout', result?.stdout],
	]) {
		const rendered = safeFailureDiagnostic(value, environment);
		if (rendered !== '') details.push(`${name}: ${rendered}`);
	}
	return boundedUtf8Head(
		`Professional native ${label} failed (status=${status}, signal=${signal}).${
			details.length === 0 ? '' : `\n${details.join('\n')}`
		}`,
		MAXIMUM_FAILURE_MESSAGE_BYTES,
	);
}

function safeFailureDiagnostic(value, environment) {
	if (typeof value !== 'string' || value === '') return '';
	let output = value
		.replaceAll(ANSI_ESCAPE_SEQUENCE, '')
		.replaceAll(UNSAFE_CONTROL_CHARACTER, '')
		.replaceAll(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu, '$1[REDACTED]')
		.replaceAll(/\b(?:github_pat_|gh[pousr]_)[A-Za-z\d_]+\b/gu, '[REDACTED]');
	for (const [name, secret] of Object.entries(environment ?? {})) {
		if (!/(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key)/iu
			.test(name) || typeof secret !== 'string' || secret.length < 4) continue;
		output = output.replaceAll(secret, '[REDACTED]');
	}
	output = output.trim();
	return boundedUtf8Tail(output, MAXIMUM_FAILURE_DIAGNOSTIC_BYTES);
}

function boundedUtf8Tail(value, maximumBytes) {
	const bytes = Buffer.from(value, 'utf8');
	if (bytes.byteLength <= maximumBytes) return value;
	const marker = `[truncated to ${String(maximumBytes)} bytes] `;
	const available = Math.max(0, maximumBytes - Buffer.byteLength(marker));
	let start = bytes.byteLength - available;
	while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
	return `${marker}${bytes.subarray(start).toString('utf8')}`;
}

function boundedUtf8Head(value, maximumBytes) {
	const bytes = Buffer.from(value, 'utf8');
	if (bytes.byteLength <= maximumBytes) return value;
	const marker = `\n[truncated to ${String(maximumBytes)} bytes]`;
	let end = Math.max(0, maximumBytes - Buffer.byteLength(marker));
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
	return `${bytes.subarray(0, end).toString('utf8')}${marker}`;
}
