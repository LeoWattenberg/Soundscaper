# SPDX-License-Identifier: AGPL-3.0-only

set(SOUNDSCAPER_FIXTURE_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/src/fixture_plugin.c")

function(soundscaper_add_fixture name behaviour classification latency stable_id label)
	set(target_name "soundscaper_fixture_${name}")
	add_library("${target_name}" MODULE "${SOUNDSCAPER_FIXTURE_SOURCE}")
	target_compile_features("${target_name}" PRIVATE c_std_11)
	target_compile_definitions("${target_name}" PRIVATE
		SOUNDSCAPER_FIXTURE_BEHAVIOUR=SOUNDSCAPER_FIXTURE_${behaviour}
		SOUNDSCAPER_FIXTURE_CLASS=SOUNDSCAPER_FIXTURE_${classification}
		SOUNDSCAPER_FIXTURE_LATENCY=${latency}
		"SOUNDSCAPER_FIXTURE_STABLE_ID=\"${stable_id}\""
		"SOUNDSCAPER_FIXTURE_NAME=\"${label}\"")
	set_target_properties("${target_name}" PROPERTIES
		C_STANDARD 11
		C_STANDARD_REQUIRED YES
		C_EXTENSIONS NO
		PREFIX ""
		OUTPUT_NAME "${name}"
		SUFFIX ".scapefx"
		C_VISIBILITY_PRESET hidden
		POSITION_INDEPENDENT_CODE YES)
	if(MSVC)
		set_property(TARGET "${target_name}" PROPERTY
			MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
		target_compile_options("${target_name}" PRIVATE /Brepro)
		target_link_options("${target_name}" PRIVATE /Brepro)
	else()
		target_compile_definitions("${target_name}" PRIVATE _POSIX_C_SOURCE=200809L)
		target_compile_options("${target_name}" PRIVATE -fno-ident)
		if(NOT APPLE)
			target_link_options("${target_name}" PRIVATE "LINKER:--build-id=none")
		endif()
	endif()
	install(TARGETS "${target_name}" LIBRARY DESTINATION fixtures RUNTIME DESTINATION fixtures)
endfunction()

soundscaper_add_fixture(clean-effect PASSTHROUGH EFFECT 0
	"soundscaper.fixture.clean" "Fixture Clean Effect")
soundscaper_add_fixture(gain-effect GAIN EFFECT 64
	"soundscaper.fixture.gain" "Fixture Gain")
soundscaper_add_fixture(impulse-effect IMPULSE EFFECT 0
	"soundscaper.fixture.impulse" "Fixture Impulse")
soundscaper_add_fixture(instrument PASSTHROUGH INSTRUMENT 0
	"soundscaper.fixture.instrument" "Fixture Instrument")
soundscaper_add_fixture(duplicate-identity PASSTHROUGH EFFECT 0
	"soundscaper.fixture.clean" "Fixture Duplicate Identity")
soundscaper_add_fixture(crash-on-scan CRASH_ON_SCAN EFFECT 0
	"soundscaper.fixture.crash-scan" "Fixture Crash On Scan")
soundscaper_add_fixture(hang-on-scan HANG_ON_SCAN EFFECT 0
	"soundscaper.fixture.hang-scan" "Fixture Hang On Scan")
soundscaper_add_fixture(crash-on-process CRASH_ON_PROCESS EFFECT 0
	"soundscaper.fixture.crash-process" "Fixture Crash On Process")
soundscaper_add_fixture(oversize-state OVERSIZE_STATE EFFECT 0
	"soundscaper.fixture.oversize" "Fixture Oversize State")
soundscaper_add_fixture(unstable-latency UNSTABLE_LATENCY EFFECT 0
	"soundscaper.fixture.unstable" "Fixture Unstable Latency")

set(no_entry_source "${CMAKE_CURRENT_BINARY_DIR}/no_entry_point.c")
file(WRITE "${no_entry_source}"
	"#if defined(_WIN32)\n__declspec(dllexport)\n#endif\nint soundscaper_unrelated_symbol(void) { return 7; }\n")
add_library(soundscaper_fixture_no_entry MODULE "${no_entry_source}")
set_target_properties(soundscaper_fixture_no_entry PROPERTIES
	C_STANDARD 11
	C_STANDARD_REQUIRED YES
	C_EXTENSIONS NO
	PREFIX ""
	OUTPUT_NAME "no-entry-point"
	SUFFIX ".scapefx"
	C_VISIBILITY_PRESET hidden
	POSITION_INDEPENDENT_CODE YES)
if(MSVC)
	set_property(TARGET soundscaper_fixture_no_entry PROPERTY
		MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
	target_compile_options(soundscaper_fixture_no_entry PRIVATE /Brepro)
	target_link_options(soundscaper_fixture_no_entry PRIVATE /Brepro)
elseif(NOT APPLE)
	target_compile_options(soundscaper_fixture_no_entry PRIVATE -fno-ident)
	target_link_options(soundscaper_fixture_no_entry PRIVATE "LINKER:--build-id=none")
endif()
install(TARGETS soundscaper_fixture_no_entry
	LIBRARY DESTINATION fixtures RUNTIME DESTINATION fixtures)

set(not_a_module "${CMAKE_CURRENT_BINARY_DIR}/not-a-module.scapefx")
file(WRITE "${not_a_module}" "This file is deliberately not a loadable module.\n")
install(FILES "${not_a_module}" DESTINATION fixtures)
