/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

import { sampleNativeAudioFailure } from './native-audio-failure-diagnostics.js';

/** Record failure-time evidence even when an assertion aborts a workflow early. */
export function collectFailureClientDiagnostics(page, browserName) {
	const pageErrors = [], consoleErrors = [], failedRequests = [], httpErrors = [];
	const watchedPages = new Set();
	const onPageError = error => pageErrors.push({ message: error.message, stack: error.stack });
	const onConsole = message => {
		if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() });
	};
	const onRequestFailed = request => failedRequests.push({
		url: request.url(), method: request.method(), resourceType: request.resourceType(),
		error: request.failure()?.errorText,
	});
	const onResponse = response => {
		if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
	};
	const watchPage = subject => {
		if (watchedPages.has(subject)) return;
		watchedPages.add(subject);
		subject.on('pageerror', onPageError);
		subject.on('console', onConsole);
		subject.on('requestfailed', onRequestFailed);
		subject.on('response', onResponse);
	};
	for (const subject of page.context().pages()) watchPage(subject);
	page.context().on('page', watchPage);
	return async testInfo => {
		try {
			if (testInfo.status !== testInfo.expectedStatus) {
				const path = testInfo.outputPath('client-failure-diagnostics.json');
				await writeFile(path, JSON.stringify({ url: page.url(), pageErrors, consoleErrors, failedRequests, httpErrors,
					nativeAudio: await sampleNativeAudioFailure(page, browserName),
					additionalPages: await Promise.all([...watchedPages].filter(subject => subject !== page).map(async subject => ({
						url: subject.url(), nativeAudio: await sampleNativeAudioFailure(subject, browserName),
					}))),
				}, null, 2));
				await testInfo.attach('client-failure-diagnostics', { path, contentType: 'application/json' });
			}
		} finally {
			page.context().off('page', watchPage);
			for (const subject of watchedPages) {
				subject.off('pageerror', onPageError);
				subject.off('console', onConsole);
				subject.off('requestfailed', onRequestFailed);
				subject.off('response', onResponse);
			}
			watchedPages.clear();
		}
	};
}
