/* SPDX-License-Identifier: AGPL-3.0-only */

'use strict';

const status = document.getElementById('status');
const count = document.getElementById('count');
const currentItem = document.getElementById('current-item');
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
const phaseCounts = phaseLabels.map((_label, index) => (
	document.getElementById(`phase-count-${String(index)}`)
));
const phaseItems = phaseLabels.map(() => null);
if (!(status instanceof HTMLElement) || !(count instanceof HTMLElement)
	|| !(currentItem instanceof HTMLElement)
	|| !(progress instanceof HTMLProgressElement)
	|| phaseProgress.some((element) => !(element instanceof HTMLProgressElement))
	|| phaseCounts.some((element) => !(element instanceof HTMLElement))) {
	throw new Error('The nightly tests progress document is incomplete.');
}

globalThis.renderNightlyTestsProgress = (value) => {
	if (!value || typeof value !== 'object' || !Number.isInteger(value.completed)
		|| !Number.isInteger(value.total) || value.total <= 0
		|| value.completed < 0 || value.completed > value.total
		|| typeof value.label !== 'string' || !value.label) {
		throw new TypeError('Nightly tests progress is invalid.');
	}
	if (value.items !== undefined && (!value.items || typeof value.items !== 'object'
		|| !Number.isInteger(value.items.completed) || !Number.isInteger(value.items.total)
		|| value.items.total < 0 || value.items.completed < 0
		|| value.items.completed > value.items.total
		|| typeof value.items.label !== 'string' || !value.items.label)) {
		throw new TypeError('Nightly tests item progress is invalid.');
	}
	const active = phaseLabels.indexOf(value.label);
	if (active >= 0 && value.items !== undefined) {
		phaseItems[active] = { ...value.items };
	}
	const items = phaseItems[active];
	const fraction = value.completed < value.total && value.items?.total > 0
		? value.items.completed / value.items.total : 0;
	status.textContent = value.label;
	currentItem.textContent = active >= 0 ? items?.label ?? 'Preparing tests…' : '';
	progress.max = value.total;
	progress.value = Math.min(value.total, value.completed + fraction);
	count.textContent = `${String(value.completed)} of ${String(value.total)} phases complete`;
	for (const [index, phase] of phaseProgress.entries()) {
		const remembered = phaseItems[index];
		const complete = index < value.completed;
		phase.max = remembered?.total || 1;
		phase.value = complete ? phase.max : remembered?.completed ?? 0;
		phase.setAttribute('value', String(phase.value));
		phaseCounts[index].textContent = remembered
			? `${String(remembered.completed)} of ${String(remembered.total)} tests complete`
			: complete ? 'Complete' : index === active ? 'Preparing tests…' : 'Waiting';
	}
};
