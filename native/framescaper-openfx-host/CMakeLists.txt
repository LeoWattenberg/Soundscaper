# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.28)
project(framescaper_openfx_host VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)
find_package(Boost 1.92.0 EXACT REQUIRED)

set(FRAMESCAPER_MEDIA_CONTRACT_ROOT
	"${CMAKE_CURRENT_SOURCE_DIR}/../framescaper-media-host/src"
)

set(FRAMESCAPER_OPENFX_SOURCE_ROOT "" CACHE PATH "Verified OpenFX 1.5.1 source root")
if(NOT EXISTS "${FRAMESCAPER_OPENFX_SOURCE_ROOT}/include/ofxImageEffect.h")
	message(FATAL_ERROR "FRAMESCAPER_OPENFX_SOURCE_ROOT must be the verified OpenFX 1.5.1 ab77951 tree")
endif()

add_library(framescaper-openfx-host-contract STATIC
	src/dynamic_library.cpp
	src/gpu_runtime.cpp
	src/host_runtime.cpp
	src/interact_v1_invocation.cpp
	src/loaded_plugin_binary.cpp
	src/parameter_values.cpp
	src/sha256.cpp
	src/v12_cancellation_channel.cpp
	src/v12_host_invocation.cpp
	src/v12_gpu_qualification.cpp
	src/v12_output_file.cpp
	src/v12_retime_authority.cpp
	src/v12_video_timing_grants.cpp
	src/v12_transition_authority.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/legacy_plan_semantics.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/legacy_plan_v8_filter_semantics.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/media_file_grants.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/media_plan.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/sha256.cpp
	${FRAMESCAPER_MEDIA_CONTRACT_ROOT}/strict_json.cpp
)
add_executable(framescaper-ofx-scanner src/ofx_scanner.cpp)
add_executable(framescaper-ofx-runtime-host src/ofx_runtime_host.cpp)
target_link_libraries(framescaper-ofx-scanner PRIVATE framescaper-openfx-host-contract)
target_link_libraries(framescaper-ofx-runtime-host PRIVATE framescaper-openfx-host-contract)

foreach(target framescaper-openfx-host-contract framescaper-ofx-scanner framescaper-ofx-runtime-host)
	target_include_directories(${target} PRIVATE
		"${FRAMESCAPER_OPENFX_SOURCE_ROOT}/include"
		"${FRAMESCAPER_MEDIA_CONTRACT_ROOT}"
	)
	target_compile_definitions(${target} PRIVATE
		FRAMESCAPER_OPENFX_VERSION="1.5.1"
		FRAMESCAPER_OPENFX_COMMIT="ab77951"
	)
	if(MSVC)
		target_compile_options(${target} PRIVATE /W4 /WX /permissive- /Brepro)
	else()
		target_compile_options(${target} PRIVATE
			-Wall -Wextra -Wpedantic -Werror
			-ffile-prefix-map=${CMAKE_SOURCE_DIR}=.
			-fdebug-prefix-map=${CMAKE_SOURCE_DIR}=.
			-fno-ident
		)
	endif()
endforeach()

target_link_libraries(framescaper-openfx-host-contract PRIVATE
	Boost::headers Threads::Threads ${CMAKE_DL_LIBS}
)
if(APPLE)
	target_link_options(framescaper-ofx-scanner PRIVATE -Wl,-no_uuid)
	target_link_options(framescaper-ofx-runtime-host PRIVATE -Wl,-no_uuid)
elseif(UNIX)
	target_link_options(framescaper-ofx-scanner PRIVATE -Wl,--build-id=none)
	target_link_options(framescaper-ofx-runtime-host PRIVATE -Wl,--build-id=none)
endif()

install(TARGETS framescaper-ofx-scanner framescaper-ofx-runtime-host RUNTIME DESTINATION bin)
