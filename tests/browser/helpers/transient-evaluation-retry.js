/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 50;

export async function evaluateWithTransientBrowserRetry(
	page,
	operation,
	argument,
	{
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		delay = wait,
	} = {},
) {
	let attempt = 0;
	while (attempt < maxAttempts) {
		attempt += 1;
		try {
			return await page.evaluate(operation, argument);
		} catch (error) {
			if (attempt >= maxAttempts || !isTransientIndexedDbEvaluationError(error)) throw error;
			await delay(DEFAULT_RETRY_DELAY_MS * attempt);
		}
	}
	throw new Error('Transient browser evaluation retry exhausted unexpectedly.');
}

export function isTransientIndexedDbEvaluationError(error) {
	if (!(error instanceof Error)) return false;
	return /(?:UnknownError|AbortError|reasons unrelated to the database itself)/iu.test(error.message);
}

function wait(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}
