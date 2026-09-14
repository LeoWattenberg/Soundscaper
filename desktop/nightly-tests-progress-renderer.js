/* SPDX-License-Identifier: AGPL-3.0-only */

'use strict';

const status = document.getElementById('status');
const count = document.getElementById('count');
const progress = document.getElementById('progress');
if (!(status instanceof HTMLElement) || !(count instanceof HTMLElement)
	|| !(progress instanceof HTMLProgressElement)) {
	throw new Error('The nightly tests progress document is incomplete.');
}

globalThis.renderNightlyTestsProgress = (value) => {
	if (!value || typeof value !== 'object' || !Number.isInteger(value.completed)
		|| !Number.isInteger(value.total) || value.total <= 0
		|| value.completed < 0 || value.completed > value.total
		|| typeof value.label !== 'string' || !value.label) {
		throw new TypeError('Nightly tests progress is invalid.');
	}
	status.textContent = value.label;
	progress.max = value.total;
	progress.value = value.completed;
	count.textContent = `${String(value.completed)} of ${String(value.total)} phases complete`;
};
