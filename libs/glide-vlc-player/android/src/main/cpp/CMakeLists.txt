cmake_minimum_required(VERSION 3.18.1)

project(glide_vlc_adjust_bridge)

add_library(
    glide_vlc_adjust_bridge
    SHARED
    VlcAdjustBridge.cpp
)

find_library(log-lib log)

target_link_libraries(
    glide_vlc_adjust_bridge
    ${log-lib}
    dl
)
