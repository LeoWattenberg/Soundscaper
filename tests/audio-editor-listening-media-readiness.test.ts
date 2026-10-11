/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { bindListeningMediaReadiness } from '../src/common/editor/ui/listening-media-readiness.ts';

class Player extends EventTarget {
	volume = 1;
	paused = true;
	currentTime = 0.25;
	readonly queued: EventListenerOrEventListenerObject[] = [];
	override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
		if (listener) this.queued.push(listener);
		super.addEventListener(type, listener, options);
	}
}

test('listening readiness restores gain after delayed native resets without changing transport or other listeners', () => {
	const player = new Player(); const events: string[] = [];
	player.addEventListener('loadedmetadata', () => events.push('metadata'));
	player.addEventListener('loadeddata', () => events.push('data'));
	const dispose = bindListeningMediaReadiness(player, () => 1, () => true);
	for (const event of ['loadedmetadata', 'loadeddata']) {
		player.volume = 0;
		player.dispatchEvent(new Event(event));
		assert.equal(player.volume, 1);
		assert.equal(player.currentTime, 0.25);
		assert.equal(player.paused, true);
	}
	assert.deepEqual(events, ['metadata', 'data']); dispose();
});

test('listening readiness uses latest gain before metadata and on subsequent source loads', () => {
	const player = new Player(); let gain = 1;
	const dispose = bindListeningMediaReadiness(player, () => gain, () => true);
	gain = 0;
	player.dispatchEvent(new Event('loadedmetadata'));
	assert.equal(player.volume, 0);
	gain = 0.25; player.volume = 0; player.paused = false;
	player.dispatchEvent(new Event('loadeddata'));
	assert.equal(player.volume, 0.25);
	assert.equal(player.paused, false);
	gain = 0.75; player.volume = 0;
	player.dispatchEvent(new Event('loadedmetadata'));
	assert.equal(player.volume, 0.75); dispose();
});

test('listening readiness refuses stale replacement events without reading abandoned gain authority', () => {
	const player = new Player(); let current = true; let reads = 0;
	const dispose = bindListeningMediaReadiness(player, () => { reads++; return 1; }, () => current);
	current = false; player.volume = 0.5;
	player.dispatchEvent(new Event('loadedmetadata'));
	player.dispatchEvent(new Event('loadeddata'));
	assert.equal(reads, 0); assert.equal(player.volume, 0.5); dispose();
});

test('listening readiness disposal removes listeners and fences previously queued callbacks', () => {
	const player = new Player(); let reads = 0; let callerEvents = 0;
	const dispose = bindListeningMediaReadiness(player, () => { reads++; return 1; }, () => true);
	const queued = [...player.queued];
	player.addEventListener('loadedmetadata', () => callerEvents++);
	dispose(); dispose(); player.volume = 0.5;
	assert.equal(getEventListeners(player, 'loadedmetadata').length, 1, 'only the caller listener remains');
	assert.equal(getEventListeners(player, 'loadeddata').length, 0);
	player.dispatchEvent(new Event('loadedmetadata'));
	player.dispatchEvent(new Event('loadeddata'));
	for (const listener of queued) {
		if (typeof listener === 'function') listener(new Event('loadeddata'));
		else listener.handleEvent(new Event('loadeddata'));
	}
	assert.equal(reads, 0); assert.equal(player.volume, 0.5); assert.equal(callerEvents, 1);
});
