/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The only DOM in `src/common/transfer/`.
 *
 * Deliberately plain: no design system, no framework, no icons. A transfer
 * document has to stay loadable on an origin whose editor the visitor may never
 * have opened, and its whole job is to be legible while it moves someone's
 * work, so it ships the smallest markup that can say what happened.
 *
 * The interesting part is `choices()`. Everything else here renders an outcome;
 * that one gathers consent, and it is what stands between "this page moves the
 * projects you picked" and "this page copies everything in the origin's store
 * to another origin". Its rows are never derived, defaulted or hidden - the
 * caller passes exactly what it intends to offer, the visitor sees every one of
 * them, and the caller reads the ticked set back before it reads a single
 * project.
 */

import { TRANSFER_PAGE_STYLES } from './transfer-routes.js';
import { describeTransferError, type TransferArchiveSource } from './transfer-session.ts';
import type { TransferResultReport, TransferResultRow } from './transfer-report-rows.ts';

export interface TransferChoiceRow {
	readonly id: string;
	readonly label: string;
	readonly detail: string;
	readonly checked: boolean;
}

export interface TransferChoiceHandle {
	/** The ids still ticked, in the order they were offered. */
	selected(): readonly string[];
	/** Disable every box, so a running transfer cannot have its set changed. */
	freeze(frozen: boolean): void;
}

export interface TransferConfirmation {
	readonly heading: string;
	readonly lines: readonly string[];
	readonly confirmLabel: string;
	readonly cancelLabel: string;
	confirm(): Promise<void>;
}

export interface TransferView {
	note(text: string): void;
	status(text: string, tone?: 'info' | 'error'): void;
	action(label: string, run: () => Promise<void>): HTMLButtonElement;
	files(label: string, accept: string, run: (files: readonly TransferArchiveSource[]) => Promise<void>): void;
	choices(rows: readonly TransferChoiceRow[]): TransferChoiceHandle;
	confirm(confirmation: TransferConfirmation | null): void;
	list(rows: readonly TransferResultRow[]): void;
	report(report: TransferResultReport): void;
}

export function createTransferView(document: Document, title: string, summary: string): TransferView {
	const root = document.getElementById('transfer') ?? document.body.appendChild(document.createElement('main'));
	// Replaces the server-rendered heading and the "Loading the transfer
	// tools…" placeholder: reaching here is what "loaded" means.
	root.replaceChildren();
	if (!document.querySelector('style[data-transfer-styles]')) {
		const style = document.createElement('style');
		style.dataset.transferStyles = '';
		style.textContent = TRANSFER_PAGE_STYLES;
		document.head.append(style);
	}
	const heading = document.createElement('h1');
	heading.textContent = title;
	const lede = document.createElement('p');
	lede.textContent = summary;
	const notes = document.createElement('p');
	const actions = document.createElement('div');
	const chooser = document.createElement('div');
	chooser.dataset.transferChoices = '';
	const confirmation = document.createElement('div');
	confirmation.dataset.transferConfirm = '';
	const status = document.createElement('p');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	const summaryLine = document.createElement('p');
	const list = document.createElement('ul');
	root.append(heading, lede, notes, actions, chooser, confirmation, status, summaryLine, list);

	const busy = (value: boolean): void => {
		for (const button of actions.querySelectorAll('button')) button.dataset.busy = value ? 'true' : '';
	};
	const renderRows = (rows: readonly { label: string; detail: string; outcome: string }[]): void => {
		list.replaceChildren(...rows.map((row) => {
			const item = document.createElement('li');
			item.dataset.outcome = row.outcome === 'ok' ? 'stored' : row.outcome;
			const name = document.createElement('strong');
			name.textContent = row.label;
			item.append(name, document.createTextNode(` — ${row.detail}`));
			return item;
		}));
	};
	const view: TransferView = {
		note: (text) => {
			notes.textContent = text;
		},
		status: (text, tone = 'info') => {
			status.textContent = text;
			status.dataset.tone = tone;
		},
		action(label, run) {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = label;
			button.addEventListener('click', () => {
				button.disabled = true;
				busy(true);
				run()
					.catch((error) => view.status(describeTransferError(error), 'error'))
					.finally(() => {
						button.disabled = false;
						busy(false);
					});
			});
			actions.append(button);
			return button;
		},
		files(label, accept, run) {
			const wrapper = document.createElement('p');
			const caption = document.createElement('label');
			caption.textContent = `${label}: `;
			const input = document.createElement('input');
			input.type = 'file';
			input.multiple = true;
			input.accept = accept;
			input.addEventListener('change', () => {
				const files = [...input.files ?? []].map((file) => ({
					name: file.name,
					read: async () => new Uint8Array(await file.arrayBuffer()),
				}));
				if (!files.length) return;
				run(files).catch((error) => view.status(describeTransferError(error), 'error'));
			});
			caption.append(input);
			wrapper.append(caption);
			root.insertBefore(wrapper, chooser);
		},
		choices(rows) {
			const boxes: HTMLInputElement[] = [];
			const items = rows.map((row) => {
				const item = document.createElement('li');
				const caption = document.createElement('label');
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.value = row.id;
				box.checked = row.checked;
				box.dataset.transferChoice = row.id;
				boxes.push(box);
				caption.append(box, document.createTextNode(` ${row.label} — ${row.detail}`));
				item.append(caption);
				return item;
			});
			const listing = document.createElement('ul');
			listing.replaceChildren(...items);
			chooser.replaceChildren(listing);
			return {
				selected: () => boxes.filter((box) => box.checked).map((box) => box.value),
				freeze: (frozen: boolean) => {
					for (const box of boxes) box.disabled = frozen;
				},
			};
		},
		confirm(request) {
			if (!request) {
				confirmation.replaceChildren();
				return;
			}
			const heading = document.createElement('p');
			heading.textContent = request.heading;
			const listing = document.createElement('ul');
			listing.replaceChildren(...request.lines.map((line) => {
				const item = document.createElement('li');
				item.textContent = line;
				return item;
			}));
			const accept = document.createElement('button');
			accept.type = 'button';
			accept.textContent = request.confirmLabel;
			const cancel = document.createElement('button');
			cancel.type = 'button';
			cancel.textContent = request.cancelLabel;
			cancel.addEventListener('click', () => {
				confirmation.replaceChildren();
				view.status('Nothing was sent.');
			});
			accept.addEventListener('click', () => {
				accept.disabled = true;
				cancel.disabled = true;
				// The popup has to open inside this click: a window.open() on a
				// later turn is blocked, so `confirm()` opens it before it awaits.
				request.confirm()
					.catch((error) => view.status(describeTransferError(error), 'error'))
					.finally(() => confirmation.replaceChildren());
			});
			confirmation.replaceChildren(heading, listing, accept, cancel);
		},
		list: renderRows,
		report(report) {
			confirmation.replaceChildren();
			summaryLine.textContent = report.summary;
			summaryLine.dataset.complete = report.complete ? 'true' : 'false';
			renderRows(report.rows);
		},
	};
	return view;
}
