/* SPDX-License-Identifier: AGPL-3.0-only */

'use strict';

const status = document.getElementById('status');
const count = document.getElementById('count');
const progress = document.getElementById('progress');
const phaseLabels = Object.freeze([
	'Browser tests',
	'Dual-origin browser coverage',
	'Performance diagnostics',
	'Packaged app diagnostics',
	'Packaged app coverage',
	'Local model tests',
]);
const phaseProgress = phaseLabels.map((_label, index) => (
	document.getElementById(`phase-progress-${String(index)}`)
));
if (!(status instanceof HTMLElement) || !(count instanceof HTMLElement)
	|| !(progress instanceof HTMLProgressElement)
	|| phaseProgress.some((element) => !(element instanceof HTMLProgressElement))) {
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
	const active = phaseLabels.indexOf(value.label);
	for (const [index, phase] of phaseProgress.entries()) {
		if (index < value.completed) {
			phase.value = 1;
			phase.setAttribute('value', '1');
		} else if (index === active) {
			phase.removeAttribute('value');
		} else {
			phase.value = 0;
			phase.setAttribute('value', '0');
		}
	}
};
