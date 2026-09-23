// Evita la finestra nera del prompt dei comandi su Windows. Non togliere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    magazzino_lib::run()
}
