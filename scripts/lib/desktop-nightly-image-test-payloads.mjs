/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact native image/library support leaves; no directory-wide helper admission. */
export const NIGHTLY_IMAGE_TEST_HELPER_INPUTS = Object.freeze([
	{ source: 'tests/helpers/image-geometry-native-fixture.ts', destination: 'tests/helpers/image-geometry-native-fixture.ts', kind: 'file', label: 'shared geometry native pixel qualification' },

	{ source: 'tests/helpers/lightscaper-current-app-fixture.tsx', destination: 'tests/helpers/lightscaper-current-app-fixture.tsx', kind: 'file', label: 'current Photo2 selected-namespace UI observation' },
	{ source: 'tests/helpers/lightscaper-current-catalog-companions-fixture.ts', destination: 'tests/helpers/lightscaper-current-catalog-companions-fixture.ts', kind: 'file', label: 'current selected tiny catalog full document, body, custody and companion observation' },
	{ source: 'tests/helpers/lightscaper-current-library-loop-fixture.ts', destination: 'tests/helpers/lightscaper-current-library-loop-fixture.ts', kind: 'file', label: 'current selected Photo library keyboard fault and preview eviction fixture' },
	{ source: 'tests/helpers/lightscaper-metadata-query-byte-fixture.ts', destination: 'tests/helpers/lightscaper-metadata-query-byte-fixture.ts', kind: 'file', label: 'photo metadata query source-byte fixture' },
	{ source: 'tests/helpers/image-metadata-fixtures.ts', destination: 'tests/helpers/image-metadata-fixtures.ts', kind: 'file', label: 'EXIF and IPTC browser source-byte support' },
	{ source: 'tests/helpers/lightscaper-metadata-query-native-fixture.ts', destination: 'tests/helpers/lightscaper-metadata-query-native-fixture.ts', kind: 'file', label: 'photo metadata query native observation entry' },
	{ source: 'tests/helpers/lightscaper-photo-orientation-native-fixture.ts', destination: 'tests/helpers/lightscaper-photo-orientation-native-fixture.ts', kind: 'file', label: 'photo metadata query native JPEG encoder' },
	{ source: 'tests/helpers/lightscaper-photo-orientation-oracle.ts', destination: 'tests/helpers/lightscaper-photo-orientation-oracle.ts', kind: 'file', label: 'photo metadata query JPEG orientation byte support' },
	{ source: 'tests/helpers/lightscaper-catalog-query-fixture.ts', destination: 'tests/helpers/lightscaper-catalog-query-fixture.ts', kind: 'file', label: 'photo metadata storage native catalog fixture' },
	{ source: 'tests/helpers/lightscaper-library-restore-native-fixture.ts', destination: 'tests/helpers/lightscaper-library-restore-native-fixture.ts', kind: 'file', label: 'photo library archive restore native qualification' },
	{ source: 'tests/helpers/lightscaper-native-scale-seed.ts', destination: 'tests/helpers/lightscaper-native-scale-seed.ts', kind: 'file', label: 'bounded native photo library test population' },
	{ source: 'tests/helpers/video-noise-reduction-reference.ts', destination: 'tests/helpers/video-noise-reduction-reference.ts', kind: 'file', label: 'independent RGB noise reduction native byte reference' },
	{ source: 'tests/helpers/video-grain-reference.ts', destination: 'tests/helpers/video-grain-reference.ts', kind: 'file', label: 'independent deterministic Grain native byte reference' },
	{ source: 'tests/helpers/video-dehaze-reference.ts', destination: 'tests/helpers/video-dehaze-reference.ts', kind: 'file', label: 'independent atmospheric Dehaze native byte reference' },
	{ source: 'tests/helpers/framescaper-global-export-fixture.ts', destination: 'tests/helpers/framescaper-global-export-fixture.ts', kind: 'file', label: 'native selected finishing export pixel qualification' },
	{ source: 'tests/helpers/global-develop-webgl-native-fixture.ts', destination: 'tests/helpers/global-develop-webgl-native-fixture.ts', kind: 'file', label: 'native global develop shader qualification' },
	{ source: 'tests/helpers/lightscaper-large-library-seed-publication.ts', destination: 'tests/helpers/lightscaper-large-library-seed-publication.ts', kind: 'file', label: 'bounded sixteen-photo native seed publication' },
	{ source: 'tests/helpers/lightscaper-large-library-seed-diagnostic.ts', destination: 'tests/helpers/lightscaper-large-library-seed-diagnostic.ts', kind: 'file', label: 'bounded native library seed phase observations' },
	{ source: 'tests/helpers/lightscaper-large-library-native-fixture.ts', destination: 'tests/helpers/lightscaper-large-library-native-fixture.ts', kind: 'file', label: 'photo library native workload fixture' },
	{ source: 'tests/helpers/lightscaper-smart-collections-native-fixture.ts', destination: 'tests/helpers/lightscaper-smart-collections-native-fixture.ts', kind: 'file', label: 'saved photo-query native storage qualification' },
	{ source: 'tests/helpers/lightscaper-smart-collections-native-observer.ts', destination: 'tests/helpers/lightscaper-smart-collections-native-observer.ts', kind: 'file', label: 'saved photo-query native request observation' },
	{ source: 'tests/helpers/lightscaper-saved-query-native-fixture.ts', destination: 'tests/helpers/lightscaper-saved-query-native-fixture.ts', kind: 'file', label: 'saved photo-query native execution qualification' },
	{ source: 'tests/helpers/lightscaper-saved-query-native-observer.ts', destination: 'tests/helpers/lightscaper-saved-query-native-observer.ts', kind: 'file', label: 'saved photo-query native execution request observation' },
]);
