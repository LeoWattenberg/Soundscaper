/* SPDX-License-Identifier: AGPL-3.0-only */

const pendingEffectsFocusSuppression = new WeakSet();

export function suppressEffectsFocusForPreset(controller) {
	pendingEffectsFocusSuppression.add(controller);
}

export function hasEffectsFocusSuppression(controller) {
	return pendingEffectsFocusSuppression.has(controller);
}

export function consumeEffectsFocusSuppression(controller) {
	if (!pendingEffectsFocusSuppression.has(controller)) return false;
	pendingEffectsFocusSuppression.delete(controller);
	return true;
}

export function clearEffectsFocusSuppression(controller) {
	pendingEffectsFocusSuppression.delete(controller);
}
