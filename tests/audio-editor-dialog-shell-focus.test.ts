/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveInitialFocus } from '../src/common/editor/ui/AudioEditorDialogShell.tsx';

test('a disabled explicit dialog focus target falls back to the first enabled control', () => {
	const disabled = focusCandidate({ disabled: true });
	const enabled = focusCandidate();
	const panel = {
		querySelector: () => disabled,
	} as unknown as HTMLElement;

	assert.equal(resolveInitialFocus(panel, '[data-apply]', () => [enabled]), enabled);
});

test('an explicit dialog focus target inside a disabled fieldset falls back', () => {
	const fieldsetDisabled = focusCandidate({ disabledFieldset: true });
	const enabled = focusCandidate();
	const panel = {
		querySelector: () => fieldsetDisabled,
	} as unknown as HTMLElement;

	assert.equal(resolveInitialFocus(panel, '[data-value]', () => [enabled]), enabled);
});

function focusCandidate(options: Readonly<{
	disabled?: boolean;
	disabledFieldset?: boolean;
}> = {}): HTMLElement {
	return {
		matches: (selector: string) => selector === ':disabled' ? options.disabled === true : true,
		closest: (selector: string) => selector.includes('fieldset[disabled]') && options.disabledFieldset === true
			? ({} as Element)
			: null,
	} as unknown as HTMLElement;
}
