/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import PhotoMetadataDialog from '../src/common/editor/ui/lightscaper/PhotoMetadataDialog.tsx';
import type { PhotoLibraryMetadataSnapshotV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

const snapshot = (): PhotoLibraryMetadataSnapshotV1 => ({ photoId: 'photo', revision: 7,
	metadata: { fileName: 'Authored.jpg', modifiedTime: '2026-10-09T12:34:56.125Z',
		captureTime: { local: '2026-10-08T11:12:13.456', offsetMinutes: null }, orientation: 6,
		cameraMake: 'Effective make', cameraModel: 'Effective model', lens: 'Effective lens', exposureSeconds: 0.008,
		aperture: 2.8, iso: 400, focalLengthMm: 50.5, title: 'Authored title', caption: 'Authored caption',
		creator: 'Authored creator', copyright: 'Authored rights', location: 'Authored location' },
	originalFileName: 'Original.jpg', originalSha256: 'a'.repeat(64),
	extracted: { schemaVersion: 1, container: 'jpeg', issues: [],
		exif: { orientation: 3, cameraMake: 'Source make', cameraModel: 'Source model', lensModel: 'Source lens',
			artist: 'Exif artist', copyright: 'Photographer\nEditor', description: 'Exif description',
			exposureSeconds: 0.004, aperture: 4, iso: 200, focalLengthMm: 35,
			captureTime: { local: '2026-10-07T10:09:08', offsetMinutes: 120, subsecond: '123456789' },
			captureTimeRaw: { dateTimeOriginal: '2026:10:07 10:09:08', offsetTimeOriginal: '+02:00', subsecondOriginal: '123456789' } },
		iptc: { encoding: 'utf8', objectName: 'Object title', headline: 'Alternative headline', caption: 'IPTC caption',
			copyright: 'IPTC rights', creators: ['Alice', 'Bob'], keywords: ['One', 'Two'], city: 'City', sublocation: 'Sublocation',
			state: 'Province', country: 'Country', captureDate: '20260000', captureTime: '102030+0230' } } });

function freeze<Value>(value: Value): Value {
	if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
	return value;
}
function fact(section: ReactTestElement, label: string): string {
	const terms = section.querySelectorAll('dt'), values = section.querySelectorAll('dd');
	const index = terms.findIndex(term => term.textContent === label);
	assert.ok(index >= 0, `Missing read-only metadata field: ${label}`);
	return values[index]!.textContent;
}
function control(root: ReactTestElement, name: string): ReactTestElement {
	const found = root.querySelectorAll('input, textarea').find(element => element.name === name);
	assert.ok(found, `Missing authored metadata control: ${name}`); return found;
}
async function mount(value = snapshot(), locale = 'en', busy = false) {
	const saved: unknown[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoMetadataDialog locale={locale} snapshot={value} busy={busy} error={null}
		onClose={() => undefined} onSave={(...args) => { saved.push(args); }} />);
	for (const element of mounted.dom.container.querySelectorAll('textarea')) element.value = String(reactProps(element).defaultValue ?? '');
	return { ...mounted, saved };
}

test('English and German expose every effective technical fact with precise localized numbers and an unchanged UTC clock', async () => {
	for (const [locale, labels, numbers] of [
		['en', ['Camera make', 'Camera model', 'Lens', 'Orientation', 'Exposure time (seconds)', 'Aperture (f-number)', 'ISO', 'Focal length (mm)', 'Modified time (UTC)'], ['0.008', '2.8', '50.5']],
		['de', ['Kamerahersteller', 'Kameramodell', 'Objektiv', 'Ausrichtung', 'Belichtungszeit (Sekunden)', 'Blende (Blendenzahl)', 'ISO', 'Brennweite (mm)', 'Änderungszeit (UTC)'], ['0,008', '2,8', '50,5']],
	] as const) {
		const mounted = await mount(snapshot(), locale);
		try {
			const section = mounted.dom.one('[data-photo-effective-metadata]');
			const expected = ['Effective make', 'Effective model', 'Effective lens', '6', numbers[0], numbers[1], '400', numbers[2], '2026-10-09T12:34:56.125Z'];
			labels.forEach((label, index) => { assert.equal(fact(section, label), expected[index]); });
			assert.equal(section.querySelectorAll('input').length, 0); assert.equal(section.querySelectorAll('textarea').length, 0);
			assert.equal(control(mounted.dom.container, 'captureLocal').value, '2026-10-08T11:12:13.456');
			assert.equal(control(mounted.dom.container, 'captureOffset').value, '');
		} finally { await mounted.dispose(); }
	}
});

test('extracted EXIF and IPTC remain distinct complete alternatives instead of replacing effective or authored values', async () => {
	const value = freeze(snapshot()), before = JSON.stringify(value), mounted = await mount(value);
	try {
		const exif = mounted.dom.one('[data-photo-exif-metadata]'), iptc = mounted.dom.one('[data-photo-iptc-metadata]');
		for (const [label, expected] of [['Camera make', 'Source make'], ['Camera model', 'Source model'], ['Lens', 'Source lens'],
			['Orientation', '3'], ['Exposure time (seconds)', '0.004'], ['Aperture (f-number)', '4'], ['ISO', '200'], ['Focal length (mm)', '35'],
			['Creator', 'Exif artist'], ['Copyright', 'Photographer\nEditor'], ['Caption', 'Exif description'],
			['Capture time', '2026-10-07T10:09:08'], ['Capture offset (minutes)', '120'], ['Capture subsecond', '123456789'],
			['Recorded capture date and time', '2026:10:07 10:09:08'], ['Recorded capture offset', '+02:00'], ['Recorded capture subsecond', '123456789']]) {
			assert.equal(fact(exif, label!), expected);
		}
		for (const [label, expected] of [['Object name', 'Object title'], ['Headline', 'Alternative headline'], ['Caption', 'IPTC caption'],
			['Copyright', 'IPTC rights'], ['City', 'City'], ['Sublocation', 'Sublocation'], ['State / province', 'Province'], ['Country', 'Country'],
			['Recorded capture date', '20260000'], ['Recorded capture time', '102030+0230'], ['Text encoding', 'utf8']]) assert.equal(fact(iptc, label!), expected);
		assert.deepEqual(iptc.querySelectorAll('li').map(item => item.textContent), ['Alice', 'Bob', 'One', 'Two']);
		assert.equal(control(mounted.dom.container, 'title').value, 'Authored title');
		assert.equal(JSON.stringify(value), before); assert.equal(mounted.saved.length, 0);
	} finally { await mounted.dispose(); }
});

test('unknown is explicit while known empty text, zero and source alternatives remain intact in both languages', async () => {
	for (const [locale, unknown, make, exposure, aperture, modified, offset] of [
		['en', 'Unknown', 'Camera make', 'Exposure time (seconds)', 'Aperture (f-number)', 'Modified time (UTC)', 'Capture offset (minutes)'],
		['de', 'Unbekannt', 'Kamerahersteller', 'Belichtungszeit (Sekunden)', 'Blende (Blendenzahl)', 'Änderungszeit (UTC)', 'Aufnahmeversatz (Minuten)'],
	] as const) {
		const source = snapshot(), value = { ...source, metadata: { ...source.metadata, cameraMake: '', exposureSeconds: 0, aperture: null, modifiedTime: null },
			extracted: { ...source.extracted!, exif: { ...source.extracted!.exif!, exposureSeconds: 0, aperture: 0,
				captureTime: { local: '2026-10-07T10:09:08', offsetMinutes: null, subsecond: null } } } };
		const mounted = await mount(value, locale);
		try { const effective = mounted.dom.one('[data-photo-effective-metadata]'), exif = mounted.dom.one('[data-photo-exif-metadata]');
			assert.equal(fact(effective, make), ''); assert.equal(fact(effective, exposure), '0');
			assert.equal(fact(effective, aperture), unknown); assert.equal(fact(effective, modified), unknown);
			assert.equal(fact(exif, aperture), '0'); assert.equal(fact(exif, offset), unknown);
		} finally { await mounted.dispose(); }
	}
});

test('partial raw capture fields never invent dates, offsets, precision or a normalized capture time', async () => {
	const source = snapshot(), value = { ...source, extracted: { ...source.extracted!, exif: { ...source.extracted!.exif!, captureTime: null,
		captureTimeRaw: { dateTimeOriginal: '2026:00:00 00:00:00', offsetTimeOriginal: '-00:00', subsecondOriginal: '0000123456789' } } } };
	const mounted = await mount(value);
	try { const exif = mounted.dom.one('[data-photo-exif-metadata]'), iptc = mounted.dom.one('[data-photo-iptc-metadata]');
		assert.equal(fact(exif, 'Capture time'), 'Unknown'); assert.equal(fact(exif, 'Capture offset (minutes)'), 'Unknown');
		assert.equal(fact(exif, 'Recorded capture date and time'), '2026:00:00 00:00:00');
		assert.equal(fact(exif, 'Recorded capture offset'), '-00:00'); assert.equal(fact(exif, 'Recorded capture subsecond'), '0000123456789');
		assert.equal(fact(iptc, 'Recorded capture date'), '20260000'); assert.equal(fact(iptc, 'Recorded capture time'), '102030+0230');
	} finally { await mounted.dispose(); }
});

test('the read model preserves all256 repeated source values and renders markup as inert exact text', async () => {
	const source = snapshot(), names = Array.from({ length: 256 }, (_, index) => index === 0 ? '<script>alert(1)</script>' : `Creator ${String(index)}`);
	const value = { ...source, extracted: { ...source.extracted!, iptc: { ...source.extracted!.iptc!, creators: names, keywords: ['one;two', 'one', 'two'] } } };
	const mounted = await mount(freeze(value));
	try { const iptc = mounted.dom.one('[data-photo-iptc-metadata]');
		assert.deepEqual(iptc.querySelectorAll('li').map(item => item.textContent), [...names, 'one;two', 'one', 'two']);
		assert.equal(iptc.querySelectorAll('script').length, 0);
	} finally { await mounted.dispose(); }
});

test('legacy absent raw capture and no extracted facts stay readable without fabricated source records', async () => {
	const source = snapshot(), { captureTimeRaw: _raw, ...exif } = source.extracted!.exif!;
	const mounted = await mount({ ...source, extracted: { ...source.extracted!, exif } });
	try { assert.equal(fact(mounted.dom.one('[data-photo-exif-metadata]'), 'Recorded capture date and time'), 'Unknown');
		await mounted.render(() => <PhotoMetadataDialog locale="en" snapshot={{ ...source, extracted: null }} busy={false} error={null}
			onClose={() => undefined} onSave={() => { throw new Error('Unexpected save.'); }} />);
		assert.equal(mounted.dom.find('[data-photo-exif-metadata]'), null); assert.equal(mounted.dom.find('[data-photo-iptc-metadata]'), null);
		assert.match(mounted.dom.one('details').textContent, /No descriptive metadata was found in the original/u);
		assert.equal(fact(mounted.dom.one('[data-photo-effective-metadata]'), 'ISO'), '400');
	} finally { await mounted.dispose(); }
});

test('oversize source facts and localized notices survive without filling an unknown effective value', async () => {
	for (const [locale, make, unknown, objectName, headline, rawDate, notices] of [
		['en', 'Camera make', 'Unknown', 'Object name', 'Headline', 'Recorded capture date', ['Malformed EXIF metadata', 'Metadata limit reached']],
		['de', 'Kamerahersteller', 'Unbekannt', 'Objektname', 'Überschrift', 'Aufgezeichnetes Aufnahmedatum', ['Fehlerhafte EXIF-Metadaten', 'Metadatengrenze erreicht']],
	] as const) {
		const source = snapshot(), longMake = 'K'.repeat(2_000), value = freeze({ ...source, metadata: { ...source.metadata, cameraMake: null },
			extracted: { ...source.extracted!, issues: ['malformed-exif', 'metadata-limit'] as const, exif: { ...source.extracted!.exif!, cameraMake: longMake } } });
		const before = JSON.stringify(value), mounted = await mount(value, locale);
		try { assert.equal(fact(mounted.dom.one('[data-photo-effective-metadata]'), make), unknown);
			assert.equal(fact(mounted.dom.one('[data-photo-exif-metadata]'), make), longMake);
			const iptc = mounted.dom.one('[data-photo-iptc-metadata]');
			assert.equal(fact(iptc, objectName), 'Object title'); assert.equal(fact(iptc, headline), 'Alternative headline');
			assert.equal(fact(iptc, rawDate), '20260000');
			for (const notice of notices) assert.ok(mounted.dom.one('details').textContent.includes(notice));
			assert.equal(JSON.stringify(value), before);
		} finally { await mounted.dispose(); }
	}
});

test('authored saves retain only the original seven fields and never mutate or submit technical or extracted facts', async () => {
	const source = freeze(snapshot()), before = JSON.stringify(source), mounted = await mount(source), NativeFormData = globalThis.FormData;
	class MountedFormData extends NativeFormData { constructor(form?: HTMLFormElement) { super();
		for (const element of (form as unknown as ReactTestElement).querySelectorAll('input, textarea')) if (element.name) this.set(element.name, element.value); } }
	globalThis.FormData = MountedFormData;
	try {
		control(mounted.dom.container, 'title').value = 'Saved title'; control(mounted.dom.container, 'captureLocal').value = '2026-10-09T10:11';
		await mounted.event('form', 'onSubmit', { preventDefault() {}, currentTarget: mounted.dom.one('form') });
		assert.deepEqual(mounted.saved, [['photo', 7, { fileName: 'Authored.jpg', title: 'Saved title', caption: 'Authored caption',
			creator: 'Authored creator', copyright: 'Authored rights', location: 'Authored location', captureTime: { local: '2026-10-09T10:11:00', offsetMinutes: null } }]]);
		assert.equal(JSON.stringify(source), before);
		await mounted.render(() => <PhotoMetadataDialog locale="en" snapshot={source} busy={true} error={null} onClose={() => undefined}
			onSave={() => { throw new Error('Busy save admitted.'); }} />);
		assert.equal(reactProps(mounted.dom.one('fieldset')).disabled, true);
		await mounted.event('form', 'onSubmit', { preventDefault() {}, currentTarget: mounted.dom.one('form') });
		assert.equal(fact(mounted.dom.one('[data-photo-effective-metadata]'), 'ISO'), '400');
	} finally { globalThis.FormData = NativeFormData; await mounted.dispose(); }
});
