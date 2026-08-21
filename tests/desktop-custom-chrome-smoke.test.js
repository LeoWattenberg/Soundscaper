/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { collectDesktopChromeArtifactWitness } from '../desktop/desktop-smoke.js';

test('artifact smoke observes full-bleed custom chrome and platform menu access keys', async () => {
	for (const [platform, fileAccessKey] of [['linux', 'Alt+D'], ['win32', 'Alt+F'], ['darwin', null]]) {
		const witness = await collectDesktopChromeArtifactWitness(chromeScope(platform, fileAccessKey));
		assert.deepEqual(witness, {
			documentDesktop: true,
			shellDesktop: true,
			fullBleed: true,
			customHeader: true,
			titlebarDraggable: true,
			controlsNoDrag: true,
			controlsVisible: true,
			maximizeEnabled: true,
			controlOrder: ['fullscreen', 'minimize', 'maximize', 'quit'],
			fileAccessKey,
		});
		assert.equal(Object.isFrozen(witness), true);
	}
});

function chromeScope(platform, fileAccessKey) {
	const button = (action) => ({
		classList: { contains: (name) => action === 'fullscreen' && name === 'kw-audio-editor__fullscreen' },
		dataset: action === 'fullscreen' ? {} : { windowControl: action },
		disabled: false,
		getClientRects: () => [{}],
	});
	const buttons = ['fullscreen', 'minimize', 'maximize', 'quit'].map(button);
	const titlebar = {};
	const actions = { querySelectorAll: () => buttons };
	const file = { getAttribute: () => fileAccessKey };
	const header = {
		querySelector: (selector) => {
			if (selector === '.application-header__windows-titlebar') return titlebar;
			if (selector === '.kw-audio-editor__window-actions') return actions;
			if (selector === '[data-application-menubar] [role="menuitem"]') return file;
			return null;
		},
	};
	const editor = {
		getBoundingClientRect: () => ({ left: 0, top: 0, right: 1_000, bottom: 700 }),
		querySelector: () => header,
	};
	const shell = { classList: { contains: (name) => name === 'desktop' } };
	return {
		document: {
			documentElement: { dataset: { desktop: 'true' } },
			querySelector: (selector) => selector === '[data-audio-editor-bound="true"]' ? editor : shell,
		},
		innerWidth: 1_000,
		innerHeight: 700,
		getComputedStyle: (element) => ({
			borderTopWidth: element === editor ? '0px' : undefined,
			borderTopLeftRadius: element === editor ? '0px' : undefined,
			getPropertyValue: () => element === titlebar ? 'drag' : element === actions ? 'no-drag' : '',
		}),
		scapeDesktop: { v1: { getEnvironment: async () => ({ platform }) } },
		setTimeout: () => { throw new Error('A complete chrome witness must not poll.'); },
	};
}
