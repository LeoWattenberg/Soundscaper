/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { PHOTO_METADATA_QUERY_COLUMNS_V2 as metadataColumns } from '../src/lightscaper/catalog/photo-metadata-query-columns-v2.ts';
import { normalizePhotoSmartQueryV2 } from '../src/lightscaper/catalog/photo-smart-query-v2.ts';
import type { PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const hooks = registerHooks({ load: (url, context, next) => url.endsWith('.css')
	? { format: 'module', source: '', shortCircuit: true } : next(url, context) });
const { default: PhotoQueryDialog } = await import('../src/common/editor/ui/lightscaper/PhotoQueryDialog.tsx');
hooks.deregister();
type Props = React.ComponentProps<typeof PhotoQueryDialog>;
const normalizeMetadataPredicate = (predicate: unknown) => normalizePhotoSmartQueryV2({ schemaVersion: 2,
	kind: 'photo-smart-query', predicate }).predicate;
const initialQuery: PhotoLibraryQueryV2 = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'photo-id', direction: 'ascending' }, predicate: null };
const labels = { flags: { unflagged: 'Unflagged', pick: 'Pick', reject: 'Reject' },
	colorLabels: { none: 'None', red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' } };

test('all19 effective columns are offered without reading definitions, metadata or media on mount', async () => {
	let reads = 0;
	const mounted = await mount({ readDefinitions: async () => { reads++; throw new Error('Unexpected read'); } });
	try {
		assert.equal(reads, 0); await mounted.click('[data-metadata-add]');
		const options = mounted.control('metadataColumn-0').querySelectorAll('option').map(node => node.getAttribute('value'));
		assert.deepEqual(options, Object.keys(metadataColumns));
		await mounted.submit(); assert.equal(mounted.applied.length, 0);
		assert.ok(mounted.dom.find('[data-metadata-invalid]'));
	} finally { await mounted.dispose(); }
});

test('text operators, exact attributes and global sort produce one explicit QueryV2', async () => {
	const mounted = await mount();
	try {
		await mounted.change('queryText', 'Landscape'); await mounted.change('queryFilter', 'rating');
		await mounted.change('queryRating', '4'); await mounted.change('querySort', 'capture-time');
		await mounted.change('queryDirection', 'descending'); await mounted.click('[data-metadata-add]');
		await mounted.change('metadataColumn-0', 'camera-make'); await mounted.change('metadataValue-0', 'Canon');
		for (const operator of ['contains', 'equals', 'starts-with'] as const) {
			await mounted.change('metadataOperator-0', operator); await mounted.submit();
			assert.deepEqual(mounted.applied.at(-1), { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Landscape',
				filter: { kind: 'rating', value: 4 }, sort: { field: 'capture-time', direction: 'descending' },
				predicate: { kind: 'all', terms: [{ kind: 'text', column: 'camera-make', operator, value: 'Canon' }] } });
		}
	} finally { await mounted.dispose(); }
});

test('authored empty equality remains known and known/unknown applies to every effective column', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataColumn-0', 'title');
		await mounted.change('metadataOperator-0', 'equals'); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'text', column: 'title', operator: 'equals', value: '' }] });
		for (const column of Object.keys(metadataColumns)) {
			await mounted.change('metadataColumn-0', column);
			for (const value of ['known', 'unknown'] as const) {
				await mounted.change('metadataOperator-0', value); await mounted.submit();
				assert.deepEqual(mounted.applied.at(-1)?.predicate, { kind: 'all', terms: [{ kind: 'presence', column, value }] });
			}
		}
	} finally { await mounted.dispose(); }
});

test('numeric ranges admit physical bounds and integers without inventing an omitted endpoint', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataColumn-0', 'iso');
		await mounted.change('metadataMinimum-0', '200'); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'number', column: 'iso', minimum: 200, maximum: null }] });
		for (const invalid of ['0', '200.5', 'Infinity']) {
			await mounted.change('metadataMinimum-0', invalid); await mounted.submit(); assert.equal(mounted.applied.length, 1);
		}
		await mounted.change('metadataMinimum-0', '800'); await mounted.change('metadataMaximum-0', '200');
		await mounted.submit(); assert.equal(mounted.applied.length, 1);
		await mounted.change('metadataColumn-0', 'exposure-seconds'); await mounted.change('metadataMinimum-0', '0.008');
		await mounted.change('metadataMaximum-0', '0.016'); await mounted.submit();
		assert.deepEqual(mounted.applied.at(-1)?.predicate, { kind: 'all', terms: [{ kind: 'number', column: 'exposure-seconds', minimum: 0.008, maximum: 0.016 }] });
	} finally { await mounted.dispose(); }
});

test('all physical numeric columns use their authoritative bounds and units', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]');
		for (const [column, definition] of Object.entries(metadataColumns)) {
			if (definition.type !== 'number') continue;
			await mounted.change('metadataColumn-0', column);
			assert.equal(reactProps(mounted.control('metadataMinimum-0')).min, definition.minimum);
			assert.equal(reactProps(mounted.control('metadataMaximum-0')).max, definition.maximum);
			assert.equal(reactProps(mounted.control('metadataMinimum-0')).step, definition.integer ? 1 : 'any');
			await mounted.change('metadataMinimum-0', String(definition.minimum));
			await mounted.change('metadataMaximum-0', String(definition.maximum)); await mounted.submit();
			assert.deepEqual(mounted.applied.at(-1)?.predicate, { kind: 'all', terms: [{ kind: 'number', column,
				minimum: definition.minimum, maximum: definition.maximum }] });
		}
	} finally { await mounted.dispose(); }
});

test('capture-offset ranges show minutes without the metadata-editor unknown-offset instruction', async () => {
	for (const [locale, label, editorLabel] of [
		['en', 'Capture offset (minutes)', 'Timezone offset in minutes (empty if unknown)'],
		['de', 'Aufnahmeversatz (Minuten)', 'Zeitzonenversatz in Minuten (leer, falls unbekannt)'],
	] as const) {
		const copy = bundledLightscaperEditorCopyForLocale(locale), mounted = await mount({ copy });
		try {
			await mounted.click('[data-metadata-add]');
			const option = mounted.control('metadataColumn-0').querySelectorAll('option')
				.find(node => node.getAttribute('value') === 'capture-offset-minutes');
			assert.ok(option); assert.equal(option.textContent, label);
			assert.equal(copy.photoCaptureOffset, editorLabel, 'The metadata editor retains its existing instruction.');
			await mounted.change('metadataColumn-0', 'capture-offset-minutes');
			await mounted.change('metadataMinimum-0', '-60'); await mounted.submit();
			assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'number',
				column: 'capture-offset-minutes', minimum: -60, maximum: null }] });
		} finally { await mounted.dispose(); }
	}
});

test('text admission preserves multiline caption and refuses controls or overlong query terms', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataColumn-0', 'caption');
		await mounted.change('metadataValue-0', 'Two\nlines\tkept'); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'text', column: 'caption',
			operator: 'contains', value: 'Two\nlines\tkept' }] });
		await mounted.change('metadataColumn-0', 'camera-model');
		for (const invalid of ['No\nline', 'Unsafe\u0001', 'x'.repeat(257)]) {
			await mounted.change('metadataValue-0', invalid); await mounted.submit(); assert.equal(mounted.applied.length, 1);
		}
		await mounted.change('metadataValue-0', 'x'.repeat(256)); await mounted.submit(); assert.equal(mounted.applied.length, 2);
	} finally { await mounted.dispose(); }
});

test('local and UTC half-open time intervals preserve clocks and millisecond precision', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataColumn-0', 'capture-time');
		await mounted.change('metadataFrom-0', '2026-10-07T12:34:56.125'); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'time', column: 'capture-time',
			from: '2026-10-07T12:34:56.125', to: null }] });
		await mounted.change('metadataTo-0', '2026-10-07T12:34:56.125'); await mounted.submit(); assert.equal(mounted.applied.length, 1);
		await mounted.change('metadataColumn-0', 'modified-time'); await mounted.change('metadataFrom-0', '2026-10-07T12:34:56.125Z');
		await mounted.change('metadataTo-0', '2026-10-08T12:34:56.126Z'); await mounted.submit();
		assert.deepEqual(mounted.applied.at(-1)?.predicate, { kind: 'all', terms: [{ kind: 'time', column: 'modified-time',
			from: '2026-10-07T12:34:56.125Z', to: '2026-10-08T12:34:56.126Z' }] });
		await mounted.change('metadataFrom-0', '2026-10-07T12:34:56.125'); await mounted.submit(); assert.equal(mounted.applied.length, 2);
	} finally { await mounted.dispose(); }
});

test('minute-aligned native local input expands only missing seconds before strict admission', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataColumn-0', 'capture-time');
		await mounted.change('metadataFrom-0', '2026-10-07T12:34'); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'time', column: 'capture-time',
			from: '2026-10-07T12:34:00.000', to: null }] });
		await mounted.change('metadataColumn-0', 'modified-time'); await mounted.change('metadataFrom-0', '2026-10-07T12:34');
		await mounted.submit(); assert.equal(mounted.applied.length, 1);
	} finally { await mounted.dispose(); }
});

test('retained metadata handlers cannot resurrect removed terms or overwrite a changed field type', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataOperator-0', 'known');
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataValue-1', 'Survives');
		const removed = reactProps(mounted.control('metadataOperator-0')).onChange;
		await mounted.click('[data-metadata-remove="0"]');
		await act(async () => { removed?.({ currentTarget: { value: 'unknown' } }); }); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'text', column: 'file-name', operator: 'contains', value: 'Survives' }] });
		const oldText = reactProps(mounted.control('metadataValue-0')).onChange;
		await mounted.change('metadataColumn-0', 'iso'); await mounted.change('metadataMinimum-0', '200');
		await act(async () => { oldText?.({ currentTarget: { value: 'Old text' } }); }); await mounted.submit();
		assert.deepEqual(mounted.applied.at(-1)?.predicate, { kind: 'all', terms: [{ kind: 'number', column: 'iso', minimum: 200, maximum: null }] });
	} finally { await mounted.dispose(); }
});

test('16 editable AND conditions are bounded and removal preserves the other admitted terms', async () => {
	const mounted = await mount();
	try {
		for (let index = 0; index < 16; index++) {
			await mounted.click('[data-metadata-add]'); await mounted.change(`metadataOperator-${index}`, 'known');
		}
		assert.equal(reactProps(mounted.dom.one('[data-metadata-add]')).disabled, true);
		await mounted.click('[data-metadata-add]'); await mounted.submit();
		const predicate = mounted.applied[0]?.predicate; assert.equal(predicate?.kind, 'all');
		if (predicate?.kind === 'all') assert.equal(predicate.terms.length, 16);
		await mounted.click('[data-metadata-remove="7"]'); await mounted.submit();
		const reduced = mounted.applied.at(-1)?.predicate;
		if (reduced?.kind === 'all') assert.equal(reduced.terms.length, 15); else assert.fail('Expected admitted AND');
		assert.equal(reactProps(mounted.dom.one('[data-metadata-add]')).disabled, false);
	} finally { await mounted.dispose(); }
});

test('nested and over16 existing predicates survive text/sort changes until explicit replacement', async () => {
	for (const predicate of [{ kind: 'not', term: { kind: 'presence', column: 'camera-make', value: 'unknown' } },
		{ kind: 'all', terms: Array.from({ length: 17 }, () => ({ kind: 'presence', column: 'iso', value: 'known' } as const)) }] as const) {
		const mounted = await mount({ query: { ...initialQuery, predicate } });
		try {
			assert.ok(mounted.dom.find('[data-metadata-preserved]')); assert.equal(mounted.dom.find('[data-metadata-add]'), null);
			await mounted.change('queryText', 'New text'); await mounted.change('querySort', 'file-name'); await mounted.submit();
			assert.deepEqual(mounted.applied[0]?.predicate, predicate);
			await mounted.click('[data-metadata-replace]'); await mounted.submit(); assert.equal(mounted.applied.at(-1)?.predicate, null);
		} finally { await mounted.dispose(); }
	}
});

test('busy/index probes preserve metadata drafts, refuse Apply and allow Close without starting migration', async () => {
	let closes = 0, builds = 0;
	const mounted = await mount({ onClose: () => { closes++; }, onBuild: () => { builds++; } });
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataValue-0', 'Kept draft');
		await mounted.render({ busy: true, needsIndex: true }); await mounted.submit();
		assert.equal(mounted.applied.length, 0); assert.equal(builds, 0);
		assert.equal(reactProps(mounted.control('metadataValue-0')).disabled, true);
		await mounted.click('[data-query-close]'); assert.equal(closes, 1);
		await mounted.render({ busy: false, needsIndex: false }); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'text', column: 'file-name', operator: 'contains', value: 'Kept draft' }] });
	} finally { await mounted.dispose(); }
});

test('a busy replacement preserves the local draft and refuses retained metadata event handlers', async () => {
	const mounted = await mount();
	try {
		await mounted.click('[data-metadata-add]'); await mounted.change('metadataValue-0', 'Current draft');
		const stale = reactProps(mounted.control('metadataValue-0')).onChange;
		await mounted.render({ busy: true, query: { ...initialQuery, predicate: { kind: 'presence', column: 'iso', value: 'unknown' } } });
		await act(async () => { stale?.({ currentTarget: { value: 'Stale overwrite' } }); });
		await mounted.render({ busy: false }); await mounted.submit();
		assert.deepEqual(mounted.applied[0]?.predicate, { kind: 'all', terms: [{ kind: 'text', column: 'file-name',
			operator: 'contains', value: 'Current draft' }] });
	} finally { await mounted.dispose(); }
});

async function mount(overrides: Partial<Props> = {}) {
	const applied: PhotoLibraryQueryV2[] = [], dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let props: Props = { query: initialQuery, copy: bundledLightscaperEditorCopyForLocale('en'), ...labels,
		metadataColumns, normalizeMetadataPredicate, busy: false, error: null, needsIndex: false, indexProgress: null,
		onClose: () => undefined, onBuild: () => undefined, onApply: next => { applied.push(next); },
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }), ...overrides };
	const render = async (changes: Partial<Props>) => { props = { ...props, ...changes }; await act(async () => { root.render(<PhotoQueryDialog {...props} />); }); };
	const control = (name: string) => {
		const node = dom.container.querySelectorAll('input,select,textarea').find(candidate => candidate.name === name || candidate.getAttribute('name') === name);
		assert.ok(node, `Missing control ${name}`); return node;
	};
	await render({});
	return { dom, applied, control, render,
		async change(name: string, value: string) { await act(async () => { reactProps(control(name)).onChange?.({ currentTarget: { value } }); }); },
		async click(selector: string) { await act(async () => { reactProps(dom.one(selector)).onClick?.({}); }); },
		async submit() { await act(async () => { reactProps(dom.one('form')).onSubmit?.({ preventDefault() {} }); }); },
		async dispose() { try { await act(async () => { root.unmount(); }); } finally { dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; } } };
}
