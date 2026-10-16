# SPDX-License-Identifier: AGPL-3.0-only

# Preserve the pinned SDK and its notice. Its unused search-path helper requires
# Files.cpp even with MSVC /OPT:REF, which resolves externals before discarding
# unused functions. The exact-path host does not implement ambient discovery.
function(soundscaper_write_exact_vamp_host_adapter input output)
	file(READ "${input}" source)
	set(start_marker "\nstd::vector<std::string>\nPluginHostAdapter::getPluginPath()\n")
	set(end_marker "\nbool\nPluginHostAdapter::initialise(")
	string(FIND "${source}" "${start_marker}" start)
	string(FIND "${source}" "${end_marker}" end)
	if(start LESS 0 OR end LESS_EQUAL start)
		message(FATAL_ERROR "The exact-path host encountered an unexpected Vamp SDK method boundary")
	endif()
	string(SUBSTRING "${source}" 0 ${start} prefix)
	string(SUBSTRING "${source}" ${end} -1 suffix)
	set(exact "${prefix}${suffix}")
	string(REPLACE "\n#include \"Files.h\"\n" "\n" exact "${exact}")
	if(exact MATCHES "Files::|PluginHostAdapter::getPluginPath")
		message(FATAL_ERROR "The exact-path host encountered an unexpected Vamp SDK search dependency")
	endif()
	file(WRITE "${output}" "${exact}")
endfunction()
