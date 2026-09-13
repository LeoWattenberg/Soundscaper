# SPDX-License-Identifier: AGPL-3.0-only

cmake_minimum_required(VERSION 3.25)
project(soundscaper_native_helper_addon LANGUAGES C)

set(SOUNDSCAPER_CLAIMED_TARGETS linux-x64 linux-arm64 mac-arm64 win-x64 win-arm64)
if(NOT DEFINED SOUNDSCAPER_TARGET_ID
	OR NOT SOUNDSCAPER_TARGET_ID IN_LIST SOUNDSCAPER_CLAIMED_TARGETS)
	message(FATAL_ERROR "SOUNDSCAPER_TARGET_ID must name one claimed native-helper target")
endif()
if(NOT DEFINED SOUNDSCAPER_NODE_API_INCLUDE
	OR NOT EXISTS "${SOUNDSCAPER_NODE_API_INCLUDE}/node_api.h")
	message(FATAL_ERROR
		"SOUNDSCAPER_NODE_API_INCLUDE must name authenticated Electron 43.1.1 Node-API headers")
endif()
if(NOT DEFINED SOUNDSCAPER_ADDON_VERSION
	OR NOT SOUNDSCAPER_ADDON_VERSION MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
	message(FATAL_ERROR "SOUNDSCAPER_ADDON_VERSION must be the source-manifest version")
endif()
if(NOT DEFINED SOUNDSCAPER_NAPI_VERSION OR NOT SOUNDSCAPER_NAPI_VERSION EQUAL 8)
	message(FATAL_ERROR "SOUNDSCAPER_NAPI_VERSION must be the source-manifest Node-API version")
endif()
if(APPLE AND NOT SOUNDSCAPER_TARGET_ID STREQUAL "mac-arm64")
	message(FATAL_ERROR "The macOS native-helper build must target mac-arm64")
elseif(WIN32 AND NOT SOUNDSCAPER_TARGET_ID MATCHES "^win-(x64|arm64)$")
	message(FATAL_ERROR "The Windows native-helper build must target Windows")
elseif(UNIX AND NOT APPLE AND NOT SOUNDSCAPER_TARGET_ID MATCHES "^linux-(x64|arm64)$")
	message(FATAL_ERROR "The Linux native-helper build must target Linux")
endif()

file(GLOB SOUNDSCAPER_HELPER_SOURCES CONFIGURE_DEPENDS "src/*.c")
add_library(soundscaper_helper MODULE ${SOUNDSCAPER_HELPER_SOURCES})
target_compile_features(soundscaper_helper PRIVATE c_std_11)
target_include_directories(soundscaper_helper PRIVATE
	"${SOUNDSCAPER_NODE_API_INCLUDE}"
	"${CMAKE_CURRENT_SOURCE_DIR}/src")
target_compile_definitions(soundscaper_helper PRIVATE
	NAPI_VERSION=${SOUNDSCAPER_NAPI_VERSION}
	SOUNDSCAPER_ADDON_VERSION="${SOUNDSCAPER_ADDON_VERSION}"
	SOUNDSCAPER_ADDON_BUILD_ID="${SOUNDSCAPER_ADDON_VERSION}+${SOUNDSCAPER_TARGET_ID}")
set_target_properties(soundscaper_helper PROPERTIES
	C_STANDARD 11
	C_STANDARD_REQUIRED YES
	C_EXTENSIONS NO
	PREFIX ""
	SUFFIX ".node"
	C_VISIBILITY_PRESET hidden
	POSITION_INDEPENDENT_CODE YES)

if(MSVC)
	set_property(TARGET soundscaper_helper PROPERTY
		MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
	# MSVC exposes the C11 atomics used by the lock-free audio ring behind an
	# explicit opt-in while its C implementation remains experimental.
	target_compile_options(soundscaper_helper PRIVATE /Brepro /experimental:c11atomics)
	target_link_options(soundscaper_helper PRIVATE /Brepro)
elseif(APPLE)
	target_compile_definitions(soundscaper_helper PRIVATE _POSIX_C_SOURCE=200809L)
	target_compile_options(soundscaper_helper PRIVATE -fno-ident -fno-strict-aliasing)
	target_link_options(soundscaper_helper PRIVATE "LINKER:-undefined,dynamic_lookup")
else()
	target_compile_definitions(soundscaper_helper PRIVATE _GNU_SOURCE _POSIX_C_SOURCE=200809L)
	target_include_directories(soundscaper_helper PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/pipewire-headers/pipewire-0.3"
		"${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/pipewire-headers/spa-0.2")
	target_compile_options(soundscaper_helper PRIVATE -fno-ident -fno-strict-aliasing)
	target_link_options(soundscaper_helper PRIVATE "LINKER:--build-id=none")
	target_link_libraries(soundscaper_helper PRIVATE dl m)
endif()

install(TARGETS soundscaper_helper LIBRARY DESTINATION . RUNTIME DESTINATION .)

add_subdirectory(
	"${CMAKE_CURRENT_SOURCE_DIR}/../soundscaper-fixture-plugins"
	"${CMAKE_CURRENT_BINARY_DIR}/fixture-plugins")

file(GENERATE
	OUTPUT "${CMAKE_BINARY_DIR}/native-helper-addon-toolchain-$<CONFIG>.json"
	CONTENT "{\n\
\t\"target\":\"${SOUNDSCAPER_TARGET_ID}\",\n\
\t\"generator\":\"${CMAKE_GENERATOR}\",\n\
\t\"compilerId\":\"${CMAKE_C_COMPILER_ID}\",\n\
\t\"compilerVersion\":\"${CMAKE_C_COMPILER_VERSION}\",\n\
\t\"systemName\":\"${CMAKE_SYSTEM_NAME}\",\n\
\t\"systemProcessor\":\"${CMAKE_SYSTEM_PROCESSOR}\"\n\
}\n")
