/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handbookContentPlan,
	handbookProductEntryId,
} from '../scripts/lib/handbook-product-content.mjs';

test('Soundscaper excludes every localized Framescaper page from its handbook', () => {
	const plan = handbookContentPlan('soundscaper');
	assert.equal(plan.includes('index.md'), true);
	assert.equal(plan.includes('tutorials/your-first-project.md'), true);
	assert.equal(plan.includes('de/tutorials/your-first-project.md'), true);
	assert.equal(plan.includes('start/choose-an-editor.md'), false);
	assert.equal(plan.includes('de/start/choose-an-editor.md'), false);
	assert.equal(plan.includes('framescaper/index.md'), false);
	assert.equal(plan.includes('de/framescaper/first-project.md'), false);
});

test('Framescaper publishes only its own localized pages and promotes them to the handbook root', () => {
	const plan = handbookContentPlan('framescaper');
	assert.equal(plan.includes('framescaper/index.md'), true);
	assert.equal(plan.includes('de/framescaper/first-project.md'), true);
	assert.equal(plan.includes('index.md'), false);
	assert.equal(plan.includes('tutorials/your-first-project.md'), false);
	assert.equal(plan.includes('de/soundscaper/index.md'), false);
	assert.equal(handbookProductEntryId('framescaper/index.md', 'framescaper'), 'index');
	assert.equal(handbookProductEntryId('framescaper/first-project.md', 'framescaper'), 'first-project');
	assert.equal(handbookProductEntryId('de/framescaper/index.md', 'framescaper'), 'de');
	assert.equal(handbookProductEntryId('de/framescaper/video-export.md', 'framescaper'), 'de/video-export');
});

test('handbook content plans reject unsupported products and foreign entry IDs', () => {
	assert.throws(() => handbookContentPlan('lightscaper'), /Unsupported handbook product/u);
	assert.throws(
		() => handbookProductEntryId('soundscaper/index.md', 'framescaper'),
		/does not belong to the Framescaper handbook/u,
	);
});
