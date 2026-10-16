/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

// Sent intact to the page: native listeners, callbacks and option objects are
// forwarded unchanged. Attribution uses the previous gesture's paired lifecycle,
// exact registration call site and callback body, rather than a global count.
export function installKnobWindowBlurObserver(target = window, registrationSite = () => {
	return new Error().stack?.match(/https?:\/\/[^)\s]+\/assets\/[^)\s]+:\d+:\d+/u)?.[0] || '';
}) {
	const nativeAdd = target.addEventListener;
	const nativeRemove = target.removeEventListener;
	const registrations = [];
	let scope = null;
	let learned = null;
	const isCaptured = owner => owner.pointerId !== null
		&& owner.element.matches('.knob--dragging') && owner.element.hasPointerCapture(owner.pointerId);
	const defaultCapture = args => args.length < 3 || args[2] === undefined || args[2] === false;
	const fingerprint = listener => `${registrationSite()}\n${Function.prototype.toString.call(listener)}`;
	const endedRegistrations = () => registrations.filter(record => record.scope === scope && record.ended);
	const pointerDown = event => {
		if (scope && event.button === 0 && event.isPrimary !== false && event.target.closest?.('.knob') === scope.element) {
			scope.pointerId = event.pointerId;
		}
	};
	target.document.addEventListener('pointerdown', pointerDown, true);
	target.addEventListener = function (...args) {
		const result = Reflect.apply(nativeAdd, this, args);
		const [type, listener] = args;
		if (this === target && type === 'blur' && typeof listener === 'function' && defaultCapture(args)
			&& !registrations.some(record => record.listener === listener && !record.removed)) {
			const owner = scope && isCaptured(scope) ? scope : null;
			registrations.push({ listener, scope: owner, fingerprint: owner ? fingerprint(listener) : null, removed: false, ended: false });
		}
		return result;
	};
	target.removeEventListener = function (...args) {
		const result = Reflect.apply(nativeRemove, this, args);
		if (this === target && args[0] === 'blur' && defaultCapture(args)) {
			const record = registrations.find(value => value.listener === args[1] && !value.removed);
			if (record) {
				record.removed = true;
				record.ended = Boolean(record.scope && !record.scope.element.matches('.knob--dragging')
					&& !record.scope.element.hasPointerCapture(record.scope.pointerId));
			}
		}
		return result;
	};
	const probe = {
		arm(element) {
			if (!element.matches('.knob')) throw new Error('Expected the native knob gesture owner.');
			scope = { element, pointerId: null };
		},
		candidateCount: () => endedRegistrations().length,
		learn() {
			const candidates = endedRegistrations();
			if (candidates.length !== 1 || !candidates[0].fingerprint.split('\n')[0]) throw new Error('Expected exactly one ended knob listener with a registration call site.');
			learned = candidates[0].fingerprint;
		},
		ready: () => Boolean(learned && scope && isCaptured(scope)
			&& registrations.some(record => record.scope === scope && !record.removed && record.fingerprint === learned)),
	};
	target.__knobWindowBlurObserver = probe;
	return probe;
}

export async function observeKnobWindowBlur(page) {
	await page.addInitScript(installKnobWindowBlurObserver);
	return {
		arm: owner => owner.evaluate(element => window.__knobWindowBlurObserver.arm(element)),
		async learn() {
			await expect.poll(() => page.evaluate(() => window.__knobWindowBlurObserver.candidateCount())).toBe(1);
			await page.evaluate(() => window.__knobWindowBlurObserver.learn());
		},
		waitForReady: () => expect.poll(() => page.evaluate(() => window.__knobWindowBlurObserver.ready())).toBe(true),
	};
}
