{ pkgs ? import <nixpkgs> {} }:
pkgs.rustPlatform.buildRustPackage {
  pname = "dream-graphics-host";
  version = "0.1.0";
  src = ./host;
  cargoLock.lockFile = ./host/Cargo.lock;
  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [ pkgs.gtk3 pkgs.webkitgtk_4_1 ];
  meta.platforms = pkgs.lib.platforms.linux;
}
