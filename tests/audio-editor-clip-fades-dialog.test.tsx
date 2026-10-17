/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import ClipFadesDialog from '../src/common/editor/ui/timeline/ClipFadesDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

type DialogProps = React.ComponentProps<typeof ClipFadesDialog>;
type Changes = Parameters<DialogProps['onApply']>[0];
const clip = { id: 'clip', timelineStartFrame: 0, durationFrames: 96_000 };

interface MountedDialog {
	readonly dom: ReturnType<typeof installReactTestDom>;
	readonly host: ReactTestElement;
	readonly row: ReactTestElement;
	readonly applied: Changes[];
	readonly previews: Changes[];
	readonly closed: () => number;
	readonly rowEvents: () => number;
	readonly dispatch: (target: ReactTestElement, type: string) => Promise<void>;
}

async function withDialog(value: DialogProps['clip'], run: (mounted: MountedDialog) => Promise<void>) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const timeline = dom.container.ownerDocument.createElement('div');
	const host = dom.container.ownerDocument.createElement('div');
	host.setAttribute('data-editor-overlay', '');
	dom.container.appendChild(timeline);
	dom.container.appendChild(host);
	const timelineEvents = retainDelegatedEvents(timeline);
	const portalEvents = retainDelegatedEvents(host);
	const root = createRoot(timeline as unknown as Element);
	const applied: Changes[] = [], previews: Changes[] = [];
	let closes = 0, rowEvents = 0;
	const onRowEvent = () => { rowEvents += 1; };
	const props = {
		clip: value, sampleRate: 48_000, copy: ENGLISH_COPY, blocked: false,
		portalHost: host as unknown as Element,
		onApply: (changes: Changes) => { applied.push(changes); },
		onPreview: (changes: Changes) => { previews.push(changes); },
		onClose: () => { closes += 1; },
	};
	try {
		await act(async () => root.render(<div data-timeline-row onPointerDown={onRowEvent}
			onPointerUp={onRowEvent} onMouseDown={onRowEvent} onClick={onRowEvent}>
			<ClipFadesDialog {...props} />
		</div>));
		await run({ dom, host, row: dom.one('[data-timeline-row]'), applied, previews,
			closed: () => closes, rowEvents: () => rowEvents,
			dispatch: async (target, type) => {
				await act(async () => { (host.contains(target) ? portalEvents : timelineEvents)(target, type); });
			},
		});
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

/** Retain React's actual delegated listeners so portal events follow their logical React ancestry. */
function retainDelegatedEvents(host: ReactTestElement) {
	const listeners = new Map<string, { capture: boolean; listener: (event: object) => void }[]>();
	Object.defineProperty(host, 'addEventListener', { value: (
		type: string, listener: (event: object) => void, options?: boolean | AddEventListenerOptions,
	) => {
		const entries = listeners.get(type) ?? [];
		entries.push({ capture: typeof options === 'boolean' ? options : options?.capture === true, listener });
		listeners.set(type, entries);
	} });
	return (target: ReactTestElement, type: string) => {
		let stopped = false;
		const event = { type, target, button: 0, pointerId: 1, bubbles: true, cancelBubble: false,
			defaultPrevented: false, timeStamp: Date.now(),
			stopPropagation() { stopped = true; this.cancelBubble = true; },
			preventDefault() { this.defaultPrevented = true; },
		};
		for (const capture of [true, false]) for (const entry of listeners.get(type) ?? []) {
			if (stopped) return;
			if (entry.capture === capture) entry.listener(event);
		}
	};
}

function footerButton(dom: MountedDialog['dom'], label: string): ReactTestElement {
	const button = dom.one('.audio-editor-fades-dialog').querySelectorAll('button')
		.find(candidate => candidate.textContent === label);
	assert.ok(button, `Missing ${label} footer button`);
	return button;
}

test('Fades dialog mounts in its owning editor overlay outside the timeline row', async () => {
	await withDialog(clip, async ({ dom, host, row }) => {
		const dialog = dom.one('.audio-editor-fades-dialog');
		assert.equal(host.contains(dialog), true, 'the explicit editor overlay owns the modal');
		assert.equal(row.contains(dialog), false, 'the modal escapes the track row stacking context');
		assert.equal(dialog.getAttribute('role'), 'dialog');
		assert.equal(dialog.getAttribute('aria-modal'), 'true');
	});
});

test('Fades footer pointer and click events never reach the originating timeline row', async () => {
	await withDialog(clip, async ({ dom, dispatch, row, rowEvents, closed, applied }) => {
		await dispatch(row, 'pointerdown');
		assert.equal(rowEvents(), 1, 'the originating row handler receives ordinary timeline events');
		for (const label of ['Apply', 'Cancel']) {
			const button = footerButton(dom, label);
			for (const type of ['pointerdown', 'mousedown', 'pointerup', 'click']) await dispatch(button, type);
		}
		assert.equal(closed(), 2, 'both footer actions still work');
		assert.equal(rowEvents(), 1, 'React portal bubbling must not activate clip selection or dragging');
		assert.deepEqual(applied, []);
	});
});

for (const fades of [{}, { fadeInFrames: 0, fadeOutFrames: 0 }]) {
	test(`unchanged Fades Apply does not publish with ${Object.keys(fades).length ? 'explicit zero' : 'absent'} fades`, async () => {
		await withDialog({ ...clip, ...fades }, async ({ dom, dispatch, applied, closed }) => {
			await dispatch(footerButton(dom, 'Apply'), 'click');
			assert.deepEqual(applied, []);
			assert.equal(closed(), 1);
		});
	});
}

test('typing zero for an absent fade remains an unchanged Apply', async () => {
	await withDialog(clip, async ({ dom, dispatch, previews, applied, closed }) => {
		await act(async () => { reactProps(dom.one('.number-stepper__input')).onChange({ target: { value: '0.000' } }); });
		assert.equal(previews.at(-1)?.fadeInFrames, 0, 'the input really produced an explicit zero preview');
		await dispatch(footerButton(dom, 'Apply'), 'click');
		assert.deepEqual(applied, [], 'missing optional fade lengths and zero have the same meaning');
		assert.equal(closed(), 1);
	});
});

test('edited Fades Apply publishes once and retains footer event isolation', async () => {
	await withDialog(clip, async ({ dom, dispatch, applied, previews, rowEvents, closed }) => {
		await act(async () => { reactProps(dom.one('.number-stepper__input')).onChange({ target: { value: '0.500' } }); });
		assert.deepEqual(previews.at(-1), { fadeInShape: 2, fadeInFrames: 24_000 });
		const button = footerButton(dom, 'Apply');
		await dispatch(button, 'pointerdown');
		await dispatch(button, 'click');
		assert.deepEqual(applied, [{ fadeInShape: 2, fadeInFrames: 24_000 }]);
		assert.equal(closed(), 1);
		assert.equal(rowEvents(), 0);
	});
});
