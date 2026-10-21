{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  packages = [ pkgs.pkg-config pkgs.rustc pkgs.cargo ];
  buildInputs = [ pkgs.gtk3 pkgs.webkitgtk_4_1 ];
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
    pkgs.gtk3 pkgs.webkitgtk_4_1 pkgs.glib pkgs.cairo pkgs.gdk-pixbuf
    pkgs.libsoup_3 pkgs.dbus
  ];
}
