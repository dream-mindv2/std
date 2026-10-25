# What the desktop window is tested with: GTK 3 and WebKitGTK 4.1, which the
# VM finds on LD_LIBRARY_PATH at run time (it links neither), and Xvfb for
# the headless test. Inside the Dream workspace this is the workspace's own
# shell (LLVM, the static libffi) with those added.
#
#   nix-shell mind/std/graphics/shell.nix --run 'just test-graphics-native'
{ pkgs ? import <nixpkgs> {} }:
let
  workspace = ../../../shell.nix;
  graphics = {
    packages = [ pkgs.pkg-config pkgs.cmake pkgs.nodejs pkgs.python3 pkgs.xorg-server ];
    buildInputs = [ pkgs.gtk3 pkgs.webkitgtk_4_1 pkgs.libffi pkgs.openssl ];
  };
  base = if builtins.pathExists workspace then import workspace { inherit pkgs; } else pkgs.mkShell {};
in base.overrideAttrs (old: {
  nativeBuildInputs = (old.nativeBuildInputs or []) ++ graphics.packages;
  buildInputs = (old.buildInputs or []) ++ graphics.buildInputs;
  # tests/native.py finds X11 through ctypes, which reads no rpath.
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
    pkgs.gtk3 pkgs.webkitgtk_4_1 pkgs.glib pkgs.cairo pkgs.gdk-pixbuf pkgs.libsoup_3 pkgs.dbus pkgs.libx11
  ];
})
