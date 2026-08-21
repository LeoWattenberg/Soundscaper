/* SPDX-License-Identifier: AGPL-3.0-only */

const input = document.querySelector('#fixture-input');
const output = document.querySelector('#fixture-input-output');
const surface = document.querySelector('#fixture-pointer-surface');

input.addEventListener('input', () => {
	output.textContent = input.value;
	document.documentElement.dataset.inputValue = input.value;
});

surface.addEventListener('mousedown', (event) => {
	const bounds = surface.getBoundingClientRect();
	const x = Math.round(event.clientX - bounds.left);
	const y = Math.round(event.clientY - bounds.top);
	output.textContent = `pointer:${String(x)},${String(y)}`;
	document.documentElement.dataset.pointer = `${String(x)},${String(y)}`;
	if (input.value) {
		const destination = new URL('/input/result', location.origin);
		destination.searchParams.set('value', input.value);
		destination.searchParams.set('pointer', `${String(x)},${String(y)}`);
		location.assign(destination.href);
	}
});

input.focus();
