# SPDX-License-Identifier: AGPL-3.0-only

cmake_minimum_required(VERSION 3.25)
project(soundscaper_os_audio_codec_host VERSION 1.0.0 LANGUAGES NONE)

if(APPLE)
	if(NOT CMAKE_OSX_ARCHITECTURES STREQUAL "arm64")
		message(FATAL_ERROR "Soundscaper OS audio codecs support only macOS ARM64")
	endif()
	enable_language(C CXX OBJCXX)
elseif(WIN32)
	if(NOT CMAKE_GENERATOR_PLATFORM STREQUAL "x64"
		AND NOT CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
		message(FATAL_ERROR "Soundscaper OS audio codecs support only Windows x64 or ARM64")
	endif()
	enable_language(C CXX)
else()
	message(FATAL_ERROR
		"Soundscaper OS audio codecs support only Windows x64, Windows ARM64, and macOS ARM64")
endif()

if(NOT DEFINED SOUNDSCAPER_NODE_API_INCLUDE
	OR NOT EXISTS "${SOUNDSCAPER_NODE_API_INCLUDE}/node_api.h")
	message(FATAL_ERROR
		"SOUNDSCAPER_NODE_API_INCLUDE must name authenticated Electron 43.1.1 Node-API headers")
endif()

set(SOUNDSCAPER_REVIEWED_CODEC_ROOT
	"${CMAKE_CURRENT_SOURCE_DIR}/../soundscaper-professional-host")
set(SOUNDSCAPER_REVIEWED_CODEC_SOURCE "${SOUNDSCAPER_REVIEWED_CODEC_ROOT}/src")
set(SOUNDSCAPER_REVIEWED_CODEC_TESTS "${SOUNDSCAPER_REVIEWED_CODEC_ROOT}/tests")

add_library(soundscaper_os_audio_codec_core STATIC
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_aac_m4a_profile.cpp"
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_aac_m4a_profile.h"
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_audio_codec.h"
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_mp3_profile.cpp"
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_mp3_profile.h"
)
target_compile_features(soundscaper_os_audio_codec_core PRIVATE cxx_std_20)
target_include_directories(soundscaper_os_audio_codec_core PUBLIC
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}")
set_target_properties(soundscaper_os_audio_codec_core PROPERTIES
	POSITION_INDEPENDENT_CODE YES
	CXX_VISIBILITY_PRESET hidden
	VISIBILITY_INLINES_HIDDEN YES
)

if(APPLE)
	target_sources(soundscaper_os_audio_codec_core PRIVATE
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_audio_codec_mac.mm")
	target_link_libraries(soundscaper_os_audio_codec_core PRIVATE
		"-framework AudioToolbox"
		"-framework CoreFoundation"
	)
elseif(WIN32)
	target_sources(soundscaper_os_audio_codec_core PRIVATE
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_audio_codec_windows.cpp"
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_audio_codec_windows_session.h"
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_mp3_encode_windows.cpp"
	)
	target_link_libraries(soundscaper_os_audio_codec_core PRIVATE
		mfplat mfreadwrite mfuuid ole32)
endif()

add_library(soundscaper_os_audio_codec MODULE src/node_api_bridge.cpp)
target_compile_features(soundscaper_os_audio_codec PRIVATE cxx_std_20)
target_include_directories(soundscaper_os_audio_codec PRIVATE
	"${SOUNDSCAPER_NODE_API_INCLUDE}"
	"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}"
)
target_compile_definitions(soundscaper_os_audio_codec PRIVATE NAPI_VERSION=8)
target_link_libraries(soundscaper_os_audio_codec PRIVATE soundscaper_os_audio_codec_core)
if(APPLE)
	target_link_options(soundscaper_os_audio_codec PRIVATE
		"LINKER:-undefined,dynamic_lookup")
endif()
set_target_properties(soundscaper_os_audio_codec PROPERTIES
	PREFIX ""
	OUTPUT_NAME "soundscaper_os_audio_codec"
	SUFFIX ".node"
	CXX_VISIBILITY_PRESET hidden
	VISIBILITY_INLINES_HIDDEN YES
)
install(TARGETS soundscaper_os_audio_codec
	LIBRARY DESTINATION .
	RUNTIME DESTINATION .
)

include(CTest)
if(BUILD_TESTING)
	add_executable(soundscaper_os_mp3_profile_self_test
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}/os_mp3_profile.cpp"
		"${SOUNDSCAPER_REVIEWED_CODEC_TESTS}/os_mp3_profile_self_test.cpp"
	)
	target_compile_features(soundscaper_os_mp3_profile_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_mp3_profile_self_test PRIVATE
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}")
	add_test(NAME soundscaper_os_mp3_profile_self_test
		COMMAND soundscaper_os_mp3_profile_self_test)

	add_executable(soundscaper_os_audio_codec_self_test
		"${SOUNDSCAPER_REVIEWED_CODEC_TESTS}/os_audio_codec_self_test.cpp")
	target_compile_features(soundscaper_os_audio_codec_self_test PRIVATE cxx_std_20)
	target_include_directories(soundscaper_os_audio_codec_self_test PRIVATE
		"${SOUNDSCAPER_REVIEWED_CODEC_SOURCE}")
	target_link_libraries(soundscaper_os_audio_codec_self_test PRIVATE
		soundscaper_os_audio_codec_core)
	add_test(NAME soundscaper_os_audio_codec_self_test
		COMMAND soundscaper_os_audio_codec_self_test)
endif()

file(GENERATE
	OUTPUT "${CMAKE_BINARY_DIR}/soundscaper-os-audio-codec-toolchain.json"
	CONTENT "{\n\
\t\"cmake\":\"${CMAKE_VERSION}\",\n\
\t\"generator\":\"${CMAKE_GENERATOR}\",\n\
\t\"cxxCompilerId\":\"${CMAKE_CXX_COMPILER_ID}\",\n\
\t\"cxxCompilerVersion\":\"${CMAKE_CXX_COMPILER_VERSION}\",\n\
\t\"systemName\":\"${CMAKE_SYSTEM_NAME}\",\n\
\t\"systemProcessor\":\"${CMAKE_SYSTEM_PROCESSOR}\"\n\
}\n")
