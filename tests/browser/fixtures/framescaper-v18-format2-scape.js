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
	'mM5D6j9KDLEuZozeJ2v4RhE3fL3+qA97uPt5lnz/Y8Zj/JjQcom34+05trcPUYjMIIGnAFkDFvT1vIIcUvWtu9e6LSfD8/8AUEsHCD6mgEH5BgAASBIAAFBL',
	'AwQUAAgICAAAYA1dAAAAAAAAAAAAAAAAHAAtAG1lZGlhL2FyY2hpdmUtdmlkZW8vb3JpZ2luYWxVVAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivdAQAQtYAK',
	'K90BABC1gAor3QEB0wAs/wckQV57mLXS7wwpRmOAnbrX9BEuS2iFor/c+RYzUG2Kp8Th/hs4VXKPrMnmAyA9WneUsc7rCCVCX3yZttPwDSpHZIGeu9j1Ei9M',
	'aYajwN36FzRRbouoxeL/HDlWc5CtyucEIT5beJWyz+wJJkNgfZq31PEOK0hlgp+82fYTME1qh6TB3vsYNVJvjKnG4wAdOld0ka7L6AUiP1x5lrPQ7QonRGF+',
	'm7jV8g8sSWaDoL3a9xQxTmuIpcLf/Bk2U3CNqsfkAR47WHWSr8zpBiNAXXqXtNFQSwcItxHFnNgAAADTAAAAUEsDBBQACAgIAABgDV0AAAAAAAAAAAAAAABL',
	'AC0AcHJveHkvNWIzNDk2NjY4ODcxMmVkNGMxZmZiODc2ZjMxNDg1Njc1YzI5MTFiODVkZTBlZDViOWM3Yjc5M2EwZTFlMDI0Yy9ib2R5VVQFAAGglX1qCgAg',
	'AAAAAAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BAYkAdv8AESIzRFVmd4iZqrvM3e7/ECEyQ1RldoeYqbrL3O3+DyAxQlNkdYaXqLnK2+z9Dh8wQVJj',
	'dIWWp7jJ2uv8DR4vQFFic4SVprfI2er7DB0uP1BhcoOUpbbH2On6CxwtPk9gcYKTpLXG1+j5ChssPU5fcIGSo7TF1uf4CRorPE1eb4CRorPE1eb3CFBLBwhw',
	'j3jOjgAAAIkAAABQSwMEFAAICAgAAGANXQAAAAAAAAAAAAAAAEwALQB0aW1pbmcvMDM3YjlmZjU5N2IwN2UzYTk0MDI2NzRmZGFjZmIyOGIxZDI2ZTcyMTYy',
	'N2U5ZjI1MmY1MjU4OGJiMWQyMjU4MS5zY3RpVVQFAAGglX1qCgAgAAAAAAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BC3YO8WRkUGDgYmAAY0YG7AAm',
	'zgSlmaE0C5RmhdJsUJodSnNAaU4oDQBQSwcIKJgnqCkAAABwAAAAUEsDBBQACAgIAABgDV0AAAAAAAAAAAAAAAANAC0AbWFuaWZlc3QuanNvblVUBQABoJV9',
	'agoAIAAAAAAAAQAYAAAQtYAKK90BABC1gAor3QEAELWACivdAaWTu47bMBBF/2Vq2eKbQ3Up0y9SJEjBx9DLzUoyJK0Rx/C/B7LsQDYSpDDAhneImXvPgCfI',
	'/dD6CRoYo9/TZj/0bxQnqK6FLzSMpe+gERXEgfxE6dP8WjBhNgw3XL5w1rD5bBljX6GCW4vmBNRNwxGam7R9G/sOKmhLSy/HPUEDfr9/L9FPpe/qa3WMr9T6',
	'P4M5VjCWXwSNMsgqGF+90Ga2QNYnCtZLiZH5zJBzKbVjXnOpBKETLHBvMGEwQSumgjZaZanISY8ZzhX4caRphObbCcb+Y4j0Oc2mhvhaDrQ5lEQ9VPCjdLN8',
	'u1IX+1S6HTTQD2VXOv9+UZesLaXi67sW9erZKvtSa/cKbgkF56uASiKSz8akyJ0K3iSUyumQbEBnU+RknVCZOW3JR52SZIjJYyBjY7ICztVdrMu8ecM/j5tl',
	'SKODVM4Yg2i5oKQizzmgNVlyhdpYHYXjPKBOxCjp4KIN1knPiBMTKj7AWZrfI1pPPfAVqItUP+ugDn06/o8rl3bF9enQf+U6lbZ0uxtYJm1wOWtnA7MkvVNM',
	'GKty8jEHgYEnYcgKboQll4UWWQuNGOaC0MgfwS7d78mO/UeXLt922Nx5uMO8aPWzhrZjnMq//+6hS9uVn+2D6+sauFit4WlE5+/n31BLBwjnnzQv6QEAAMAE',
	'AABQSwECAAMUAAgICAAAYA1dPqaAQfkGAABIEgAADAAtAAAAAAAAAAAApAEAAAAAcHJvamVjdC5qc29uVVQFAAGglX1qCgAgAAAAAAABABgAABC1gAor3QEA',
	'ELWACivdAQAQtYAKK90BUEsBAgADFAAICAgAAGANXbcRxZzYAAAA0wAAABwALQAAAAAAAAAAAKQBYAcAAG1lZGlhL2FyY2hpdmUtdmlkZW8vb3JpZ2luYWxV',
	'VAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivdAQAQtYAKK90BABC1gAor3QFQSwECAAMUAAgICAAAYA1dcI94zo4AAACJAAAASwAtAAAAAAAAAAAApAGvCAAA',
	'cHJveHkvNWIzNDk2NjY4ODcxMmVkNGMxZmZiODc2ZjMxNDg1Njc1YzI5MTFiODVkZTBlZDViOWM3Yjc5M2EwZTFlMDI0Yy9ib2R5VVQFAAGglX1qCgAgAAAA',
	'AAABABgAABC1gAor3QEAELWACivdAQAQtYAKK90BUEsBAgADFAAICAgAAGANXSiYJ6gpAAAAcAAAAEwALQAAAAAAAAAAAKQB4wkAAHRpbWluZy8wMzdiOWZm',
	'NTk3YjA3ZTNhOTQwMjY3NGZkYWNmYjI4YjFkMjZlNzIxNjI3ZTlmMjUyZjUyNTg4YmIxZDIyNTgxLnNjdGlVVAUAAaCVfWoKACAAAAAAAAEAGAAAELWACivd',
	'AQAQtYAKK90BABC1gAor3QFQSwECAAMUAAgICAAAYA1d5580L+kBAADABAAADQAtAAAAAAAAAAAApAGzCgAAbWFuaWZlc3QuanNvblVUBQABoJV9agoAIAAA',
	'AAAAAQAYAAAQtYAKK90BABC1gAor3QEAELWACivdAVBLBQYAAAAABQAFAJMCAAAEDQAAAAA=',
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
