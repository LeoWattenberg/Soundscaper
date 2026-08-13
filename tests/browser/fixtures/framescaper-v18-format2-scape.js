/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	BlobReader,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

// Generated only from the repository-owned V18 archive fixture. The original,
// proxy, and timing bodies are deterministic synthetic bytes with no
// third-party media. Keeping the archive fixed makes browser acceptance catch
// wire drift independently of the production writer.
const FORMAT_2_SCAPE_BASE64 = [
	'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',
	'pyG1P0r0sY4niN4mq/+Nwhu81D/wnQ26n6OGL/6Y8eh/TKhwdW2H27NvbxsiF5mewp7cyOpnQZdNK+jx9B9QSwcIv4dBpe8GAAAx',
	'EgAAUEsDBBQACggIAABgDV0AAAAAAAAAAAAAAAAcAC0AbWVkaWEvYXJjaGl2ZS12aWRlby9vcmlnaW5hbFVUBQABoJV9agoAIAAA',
	'AAAAAQAYAAAQtYAKK90BABC1gAor3QEAELWACivdAQHTACz/ByRBXnuYtdLvDClGY4Cdutf0ES5LaIWiv9z5FjNQbYqnxOH+GzhV',
	'co+syeYDID1ad5SxzusIJUJffJm20/ANKkdkgZ672PUSL0xphqPA3foXNFFui6jF4v8cOVZzkK3K5wQhPlt4lbLP7AkmQ2B9mrfU',
	'8Q4rSGWCn7zZ9hMwTWqHpMHe+xg1Um+MqcbjAB06V3SRrsvoBSI/XHmWs9DtCidEYX6buNXyDyxJZoOgvdr3FDFOa4ilwt/8GTZT',
	'cI2qx+QBHjtYdZKvzOkGI0Bdepe00VBLBwi3EcWc2AAAANMAAABQSwMEFAAKCAgAAGANXQAAAAAAAAAAAAAAAEsALQBwcm94eS81',
	'YjM0OTY2Njg4NzEyZWQ0YzFmZmI4NzZmMzE0ODU2NzVjMjkxMWI4NWRlMGVkNWI5YzdiNzkzYTBlMWUwMjRjL2JvZHlVVAUAAaCV',
	'fWoKACAAAAAAAAEAGAAAELWACivdAQAQtYAKK90BABC1gAor3QEBiQB2/wARIjNEVWZ3iJmqu8zd7v8QITJDVGV2h5ipusvc7f4P',
	'IDFCU2R1hpeoucrb7P0OHzBBUmN0hZanuMna6/wNHi9AUWJzhJWmt8jZ6vsMHS4/UGFyg5SltsfY6foLHC0+T2BxgpOktcbX6PkK',
	'Gyw9Tl9wgZKjtMXW5/gJGis8TV5vgJGis8TV5vcIUEsHCHCPeM6OAAAAiQAAAFBLAwQUAAoICAAAYA1dAAAAAAAAAAAAAAAATAAt',
	'AHRpbWluZy8wMzdiOWZmNTk3YjA3ZTNhOTQwMjY3NGZkYWNmYjI4YjFkMjZlNzIxNjI3ZTlmMjUyZjUyNTg4YmIxZDIyNTgxLnNj',
	'dGlVVAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivdAQAQtYAKK90BABC1gAor3QELdg7xZGRQYOBiYABjRgbsACbOBKWZoTQLlGaF',
	'0mxQmh1Kc0BpTigNAFBLBwgomCeoKQAAAHAAAABQSwMEFAAKCAgAAGANXQAAAAAAAAAAAAAAAA0ALQBtYW5pZmVzdC5qc29uVVQF',
	'AAGglX1qCgAgAAAAAAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BpVO5jtswEP0X1pbF+1CXMv0iRYIUJGe45u7qgKQYcQz/',
	'eygfgWwkSGFABfVmOPPem+GRpH5s/UwaMkU/YDWM/RvGmWyugS84TrnvSMM3JI7oZ4RPSzanXFfUVky8MNrQ5dtSSr+Wi7cSzZFg',
	'N4+Hkn2Ftm9TKbUhbW7x5TBgifhh+MjRz6VHfY1OcYet/9OY2QLlXyVZamXKeee50uWqNd4nxQ0k4V1M3Blhk4iCC40qMke1cuB5',
	'jMDQMup1oloayakAx4wActoQP004T6T5diRT/2OM+BkWUmPc5T1W+wzYF0bvuVvg2y92sYfcvRaoH/Nr7vzHGb1obRGyr+9K1Ku0',
	'lfZLrB0kuSnkjK0ESmEt+qQ1FDUyeA1WSKcCmGCdKSAax2WiThn0UQEIai14G1CbCIYXgXeyzv2WCf88VJcmjQqlotbaWsM4gows',
	'pWCNToJJq7RRkTvGglWAFEEFF00wTniKDCmX8cGcS/F7i9Zd92xl1Bmqn2VQhx4O//OVifXiPC36r77OuS2Cb8ZSYYJLSTkTqMGy',
	'oLI8GCMT+JgCt4EB12g409ygS1zxssnK2rAEyoE9Gnupfu9sodDB+dmO1R2HO5svWP0soe0U5/zvt7vvYLvis31gfR0D46sxPG3R',
	'6fvpN1BLBwiDAhy75wEAAMAEAABQSwECAAMUAAoICAAAYA1dv4dBpe8GAAAxEgAADAAtAAAAAAAAAAAApAEAAAAAcHJvamVjdC5q',
	'c29uVVQFAAGglX1qCgAgAAAAAAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BUEsBAgADFAAKCAgAAGANXbcRxZzYAAAA0wAA',
	'ABwALQAAAAAAAAAAAKQBVgcAAG1lZGlhL2FyY2hpdmUtdmlkZW8vb3JpZ2luYWxVVAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivd',
	'AQAQtYAKK90BABC1gAor3QFQSwECAAMUAAoICAAAYA1dcI94zo4AAACJAAAASwAtAAAAAAAAAAAApAGlCAAAcHJveHkvNWIzNDk2',
	'NjY4ODcxMmVkNGMxZmZiODc2ZjMxNDg1Njc1YzI5MTFiODVkZTBlZDViOWM3Yjc5M2EwZTFlMDI0Yy9ib2R5VVQFAAGglX1qCgAg',
	'AAAAAAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BUEsBAgADFAAKCAgAAGANXSiYJ6gpAAAAcAAAAEwALQAAAAAAAAAAAKQB',
	'2QkAAHRpbWluZy8wMzdiOWZmNTk3YjA3ZTNhOTQwMjY3NGZkYWNmYjI4YjFkMjZlNzIxNjI3ZTlmMjUyZjUyNTg4YmIxZDIyNTgx',
	'LnNjdGlVVAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivdAQAQtYAKK90BABC1gAor3QFQSwECAAMUAAoICAAAYA1dgwIcu+cBAADA',
	'BAAADQAtAAAAAAAAAAAApAGpCgAAbWFuaWZlc3QuanNvblVUBQABoJV9agoAIAAAAAAAAQAYAAAQtYAKK90BABC1gAor3QEAELWA',
	'CivdAVBLBQYAAAAABQAFAJMCAAD4DAAAAAA=',
].join('');

export async function createFramescaperV18Format2Scape() {
	const source = new ZipReader(
		new BlobReader(new Blob([Buffer.from(FORMAT_2_SCAPE_BASE64, 'base64')])),
		{ useWebWorkers: false },
	);
	const output = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
	try {
		for (const entry of await source.getEntries()) {
			if (entry.directory) throw new Error('The fixed V18 archive cannot contain directories.');
			const bytes = await entry.getData(new Uint8ArrayWriter());
			await output.add(entry.filename, new Uint8ArrayReader(bytes), {
				level: 0,
				lastModDate: new Date('2026-08-13T10:00:00.000Z'),
			});
		}
		return Object.freeze({
			name: 'framescaper-v18-format2.scape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			buffer: Buffer.from(await output.close()),
		});
	} finally {
		await source.close();
	}
}

export const framescaperV18Format2Expectation = Object.freeze({
	projectId: 'framescaper-v18-archive',
	projectTitle: 'Framescaper archive',
	schemaVersion: 18,
	formatVersion: 2,
	assets: Object.freeze([
		Object.freeze({
			kind: 'video',
			sha256: '4388eaf66dc194ba6d83495bd7b897dc1e7924f0957eac5dd3088da8be67cd72',
			size: 211,
		}),
		Object.freeze({
			kind: 'video-proxy',
			sha256: '5b34966688712ed4c1ffb876f31485675c2911b85de0ed5b9c7b793a0e1e024c',
			size: 137,
		}),
		Object.freeze({
			kind: 'video-timing',
			sha256: '037b9ff597b07e3a9402674fdacfb28b1d26e721627e9f252f52588bb1d22581',
			size: 112,
		}),
	]),
});
