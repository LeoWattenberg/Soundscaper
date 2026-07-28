#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only

"""Inspect an archive through libarchive's public C reader API."""

import base64
import ctypes
import json
import os
import sys


ARCHIVE_EOF = 1
ARCHIVE_OK = 0


def bind(library):
	library.archive_version_string.restype = ctypes.c_char_p
	library.archive_read_new.restype = ctypes.c_void_p
	library.archive_read_support_filter_all.argtypes = [ctypes.c_void_p]
	library.archive_read_support_format_all.argtypes = [ctypes.c_void_p]
	library.archive_read_open_filename.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
	library.archive_read_next_header.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
	library.archive_read_data.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
	library.archive_read_data.restype = ctypes.c_ssize_t
	library.archive_read_free.argtypes = [ctypes.c_void_p]
	library.archive_entry_pathname.argtypes = [ctypes.c_void_p]
	library.archive_entry_pathname.restype = ctypes.c_char_p
	library.archive_entry_size.argtypes = [ctypes.c_void_p]
	library.archive_entry_size.restype = ctypes.c_int64
	library.archive_error_string.argtypes = [ctypes.c_void_p]
	library.archive_error_string.restype = ctypes.c_char_p


def check(library, archive, result):
	if result >= ARCHIVE_OK:
		return
	message = library.archive_error_string(archive)
	raise RuntimeError(message.decode('utf-8', errors='replace') if message else f'libarchive error {result}')


def inspect_archive(path):
	library_name = os.environ.get('LIBARCHIVE_LIBRARY', 'libarchive.so.13')
	library = ctypes.CDLL(library_name)
	bind(library)
	archive = library.archive_read_new()
	if not archive:
		raise RuntimeError('archive_read_new failed')
	try:
		check(library, archive, library.archive_read_support_filter_all(archive))
		check(library, archive, library.archive_read_support_format_all(archive))
		check(library, archive, library.archive_read_open_filename(archive, os.fsencode(path), 10240))
		entries = []
		while True:
			entry = ctypes.c_void_p()
			result = library.archive_read_next_header(archive, ctypes.byref(entry))
			if result == ARCHIVE_EOF:
				break
			check(library, archive, result)
			name = library.archive_entry_pathname(entry)
			expected_size = library.archive_entry_size(entry)
			chunks = []
			buffer = ctypes.create_string_buffer(64 * 1024)
			while True:
				count = library.archive_read_data(archive, buffer, len(buffer))
				if count == 0:
					break
				check(library, archive, count)
				chunks.append(buffer.raw[:count])
			payload = b''.join(chunks)
			if expected_size >= 0 and len(payload) != expected_size:
				raise RuntimeError('libarchive returned an unexpected entry size')
			entries.append({
				'fileName': name.decode('utf-8'),
				'byteLength': len(payload),
				'base64': base64.b64encode(payload).decode('ascii'),
			})
		return {
			'version': library.archive_version_string().decode('utf-8'),
			'entries': entries,
		}
	finally:
		library.archive_read_free(archive)


if __name__ == '__main__':
	if len(sys.argv) != 2:
		raise SystemExit('usage: read-libarchive.py ARCHIVE')
	print(json.dumps(inspect_archive(sys.argv[1]), ensure_ascii=False))
