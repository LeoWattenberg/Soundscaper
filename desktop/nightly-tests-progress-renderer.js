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
const tauriPhase = document.getElementById('tauri-phase');
const tauriProgress = document.getElementById('phase-progress-tauri');
const tauriCount = document.getElementById('phase-count-tauri');
const phaseItems = new Map();
if (!(status instanceof HTMLElement) || !(count instanceof HTMLElement)
	|| !(currentItem instanceof HTMLElement)
	|| !(progress instanceof HTMLProgressElement)
	|| !(tauriPhase instanceof HTMLElement)
	|| !(tauriProgress instanceof HTMLProgressElement)
	|| !(tauriCount instanceof HTMLElement)
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
	tauriPhase.hidden = value.total !== 7;
	const labels = [...phaseLabels];
	const bars = [...phaseProgress];
	const counts = [...phaseCounts];
	if (!tauriPhase.hidden) {
		labels.splice(1, 0, 'Tauri native smoke test');
		bars.splice(1, 0, tauriProgress);
		counts.splice(1, 0, tauriCount);
	}
	const active = labels.indexOf(value.label);
	if (active >= 0 && value.items !== undefined) {
		phaseItems.set(value.label, { ...value.items });
	}
	const items = phaseItems.get(value.label);
	const fraction = value.completed < value.total && value.items?.total > 0
		? value.items.completed / value.items.total : 0;
	status.textContent = value.label;
	currentItem.textContent = active >= 0 ? items?.label ?? 'Preparing tests…' : '';
	progress.max = value.total;
	progress.value = Math.min(value.total, value.completed + fraction);
	count.textContent = `${String(value.completed)} of ${String(value.total)} phases complete`;
	for (const [index, phase] of bars.entries()) {
		const remembered = phaseItems.get(labels[index]);
		const complete = index < value.completed;
		phase.max = remembered?.total || 1;
		phase.value = complete ? phase.max : remembered?.completed ?? 0;
		phase.setAttribute('value', String(phase.value));
		counts[index].textContent = remembered
			? `${String(remembered.completed)} of ${String(remembered.total)} tests complete`
			: complete ? 'Complete' : index === active ? 'Preparing tests…' : 'Waiting';
	}
};
