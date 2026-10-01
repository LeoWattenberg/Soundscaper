/* SPDX-License-Identifier: AGPL-3.0-only */

import { StringDecoder } from 'node:string_decoder';

export const DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER = 'SOUNDSCAPER_NIGHTLY_TESTS_ITEMS ';
const MAX_PROGRESS_LINE_LENGTH = 65_536;

// Playwright reports attempts, while this window measures logical test cases.
// Retrying failures remain incomplete until their final attempt finishes.
export default class DesktopNightlyTestsProgressReporter {
	constructor({ output = process.stdout } = {}) {
		this.output = output;
		this.total = 0;
		this.completed = new Set();
		this.pendingSkipped = new Set();
	}

	onBegin(_config, suite) {
		this.total = suite.allTests().length;
		this.completed.clear();
		this.pendingSkipped.clear();
		this.report(this.total === 0 ? 'No tests' : 'Preparing tests');
	}

	onTestBegin(test, result) {
		this.pendingSkipped.delete(test.id);
		this.report(testLabel(test, result.retry));
	}

	onTestEnd(test, result) {
		const retrying = result.status !== 'skipped' && result.status !== 'interrupted'
			&& result.status !== test.expectedStatus && result.retry < test.retries;
		if (result.status === 'skipped' && test.expectedStatus !== 'skipped') {
			// A failed serial group provisionally skips its remaining members,
			// then runs them again on retry. Only the final run verdict confirms
			// such a skip when the test never starts again.
			this.pendingSkipped.add(test.id);
		} else if (!retrying && result.status !== 'interrupted') this.completed.add(test.id);
		this.report(testLabel(test, result.retry));
	}

	onEnd(result) {
		if (result.status === 'passed' || result.status === 'failed') {
			for (const id of this.pendingSkipped) this.completed.add(id);
		}
		this.report(this.total === 0 ? 'No tests'
			: result.status === 'interrupted' ? 'Tests interrupted'
				: result.status === 'timedout' ? 'Tests timed out' : 'Tests finished');
	}

	report(label) {
		// A preceding newline keeps records separate from test output that did
		// not end in a newline. Human-readable reports remain in the same log.
		this.output.write(`\n${DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER}${JSON.stringify({
			completed: this.completed.size, total: this.total, label,
		})}\n`);
	}
}

/** Decode the reporter's records without retaining unbounded console output. */
export function createDesktopNightlyTestsItemProgressReader(onProgress) {
	const decoder = new StringDecoder('utf8');
	let pending = '';
	let oversized = false;
	const append = (part) => {
		if (oversized) return;
		if (pending.length + part.length > MAX_PROGRESS_LINE_LENGTH) {
			pending = '';
			oversized = true;
		} else pending += part;
	};
	const finishLine = () => {
		const line = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
		const value = oversized ? null : readProgressLine(line);
		pending = '';
		oversized = false;
		if (value !== null) onProgress(value);
	};
	const consume = (text) => {
		let offset = 0;
		for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', offset)) {
			append(text.slice(offset, end));
			finishLine();
			offset = end + 1;
		}
		append(text.slice(offset));
	};
	return Object.freeze({
		write(chunk) { consume(typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk))); },
		finish() { consume(decoder.end()); finishLine(); },
	});
}

function readProgressLine(line) {
	if (!line.startsWith(DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER)) return null;
	let value;
	try { value = JSON.parse(line.slice(DESKTOP_NIGHTLY_TESTS_ITEM_PROGRESS_MARKER.length)); }
	catch (_error) { return null; }
	if (!value || typeof value !== 'object' || !Number.isInteger(value.completed)
		|| !Number.isInteger(value.total) || value.total < 0
		|| value.completed < 0 || value.completed > value.total
		|| typeof value.label !== 'string' || !value.label.trim()
		|| /[\r\n]/u.test(value.label)) return null;
	return Object.freeze({ completed: value.completed, total: value.total, label: value.label });
}

function testLabel(test, retry) {
	const title = test.titlePath().filter(Boolean).join(' › ').replace(/[\r\n]/gu, ' ').slice(0, 4096);
	return `${title || 'Test'}${retry > 0 ? ` (retry ${String(retry)})` : ''}`;
}
