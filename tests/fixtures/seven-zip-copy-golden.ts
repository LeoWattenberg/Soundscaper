/* SPDX-License-Identifier: AGPL-3.0-only */

export const SEVEN_ZIP_COPY_GOLDEN_BASE64 =
	'N3q8ryccAARAO6j1BQAAAAAAAABXAAAAAAAAAIk2i9EBAgMEBQEEBgACCQMCCgEdgLxVdCPfVQAHCwIAAQEAAQEADAMCCgEdgLxVdCPfVQAIAAAFAhEjAGwAZQBhAGQALgB3AGEAdgAAAEIA5ABzAC4AdwBhAHYAAAAAAA==';

export const SEVEN_ZIP_COPY_GOLDEN_SHA256 =
	'c1bf99ca05549c4c324d6976ef823628d00c83ca73cef20ce24149a9c6c50ba7';

export const SEVEN_ZIP_COPY_GOLDEN_PROVENANCE = Object.freeze({
	byteLength: 124,
	entries: Object.freeze([
		Object.freeze({ fileName: 'lead.wav', bytes: Object.freeze([1, 2, 3]) }),
		Object.freeze({ fileName: 'Bäs.wav', bytes: Object.freeze([4, 5]) }),
	]),
	format: '7z Copy, one non-solid folder per file',
	officialSevenZip: Object.freeze({
		artifactSha256: '41aaba7b1235304ab5aa0624530c67ae829496cd29e875925271efdccc28c03e',
		artifactUrl: 'https://github.com/ip7z/7zip/releases/download/26.02/7z2602-linux-x64.tar.xz',
		version: '7-Zip (z) 26.02 (x64)',
	}),
	libarchive: Object.freeze({
		api: 'archive_read_support_format_all',
		version: 'libarchive 3.6.0',
	}),
});
