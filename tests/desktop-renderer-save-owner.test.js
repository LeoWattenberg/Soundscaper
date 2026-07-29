/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RendererSaveOwnership } from '../desktop/renderer-save-owner.js';

test('committed documents rotate opaque owners within one WebContents', () => {
	const ownership = new RendererSaveOwnership();
	const webContents = Object.freeze({ id: 7 });
	const documentA = { webContents, processId: 41, frameId: 101 };
	const documentB = { webContents, processId: 41, frameId: 102 };

	const activatedA = ownership.activate(documentA);
	assert.equal(activatedA.revokedOwner, null);
	assertOpaqueMainToken(activatedA.owner, documentA);
	assert.equal(ownership.ownerFor({ sender: webContents, ...documentA }), activatedA.owner);

	const activatedB = ownership.activate(documentB);
	assertOpaqueMainToken(activatedB.owner, documentB);
	assert.notEqual(activatedB.owner, activatedA.owner);
	assert.equal(activatedB.revokedOwner, activatedA.owner);
	assert.throws(
		() => ownership.ownerFor({ sender: webContents, processId: documentA.processId, frameId: documentA.frameId }),
		/active|document|owner|renderer|stale/iu,
		'IPC from the replaced document must not inherit the current owner',
	);
	assert.equal(
		ownership.ownerFor({ sender: webContents, processId: documentB.processId, frameId: documentB.frameId }),
		activatedB.owner,
	);
});

test('a stale WebContents revoke cannot clear the current document owner', () => {
	const ownership = new RendererSaveOwnership();
	const oldWebContents = Object.freeze({ id: 8 });
	const currentWebContents = Object.freeze({ id: 9 });
	const oldDocument = { webContents: oldWebContents, processId: 51, frameId: 201 };
	const currentDocument = { webContents: currentWebContents, processId: 52, frameId: 202 };
	const oldActivation = ownership.activate(oldDocument);
	const currentActivation = ownership.activate(currentDocument);

	assert.equal(currentActivation.revokedOwner, oldActivation.owner);
	assert.equal(ownership.revoke(oldWebContents), null);
	assert.equal(
		ownership.ownerFor({
			sender: currentWebContents,
			processId: currentDocument.processId,
			frameId: currentDocument.frameId,
		}),
		currentActivation.owner,
	);
	assert.equal(ownership.revoke(currentWebContents), currentActivation.owner);
	assert.throws(
		() => ownership.ownerFor({
			sender: currentWebContents,
			processId: currentDocument.processId,
			frameId: currentDocument.frameId,
		}),
		/active|document|owner|renderer|stale/iu,
	);
});

function assertOpaqueMainToken(owner, rendererIdentity) {
	assert.ok(
		(typeof owner === 'object' && owner !== null) || typeof owner === 'symbol',
		'the owner is an opaque main-process identity token',
	);
	assert.notEqual(owner, rendererIdentity.webContents);
	assert.notEqual(owner, rendererIdentity.processId);
	assert.notEqual(owner, rendererIdentity.frameId);
}
