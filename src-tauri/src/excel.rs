//! Legge e scrive fogli Excel, e basta.
//!
//! Qui dentro non c'e' nessuna regola del magazzino: questa parte sa solo
//! mettere righe in un foglio e ritirarle fuori. Cosa significano le colonne lo
//! decide l'app, che e' anche il posto dove si va a guardare quando una regola
//! cambia. Un giorno si cambia modello senza toccare il Rust.

use calamine::{Data, Reader, Xlsx, open_workbook};
use rust_xlsxwriter::{Format, Workbook};

/// Scrive un modello: un foglio con i dati e uno con le istruzioni.
///
/// Se `righe` e' vuoto esce un modello da compilare; se contiene qualcosa esce
/// lo stesso foglio gia' pieno di quello che c'e' nel programma, buono sia da
/// controllare sia da rimandare indietro modificato.
#[tauri::command]
pub async fn scrivi_excel(
    percorso: String,
    foglio: String,
    intestazioni: Vec<String>,
    righe: Vec<Vec<String>>,
    istruzioni: Vec<String>,
) -> Result<(), String> {
    let mut libro = Workbook::new();

    let grassetto = Format::new()
        .set_bold()
        .set_background_color(0xF2C230)
        .set_border(rust_xlsxwriter::FormatBorder::Thin);

    let dati = libro.add_worksheet();
    dati.set_name(&foglio).map_err(|e| e.to_string())?;

    for (c, testo) in intestazioni.iter().enumerate() {
        dati.write_string_with_format(0, c as u16, testo, &grassetto)
            .map_err(|e| e.to_string())?;
        // Larghezza a occhio sul titolo: meglio che vedere "####" ovunque.
        let larghezza = (testo.chars().count() as f64 + 4.0).max(12.0);
        dati.set_column_width(c as u16, larghezza)
            .map_err(|e| e.to_string())?;
    }
    for (r, riga) in righe.iter().enumerate() {
        for (c, cella) in riga.iter().enumerate() {
            dati.write_string(r as u32 + 1, c as u16, cella)
                .map_err(|e| e.to_string())?;
        }
    }
    // La prima riga resta ferma scorrendo: con centocinquanta atlete serve.
    dati.set_freeze_panes(1, 0).map_err(|e| e.to_string())?;

    let guida = libro.add_worksheet();
    guida.set_name("Istruzioni").map_err(|e| e.to_string())?;
    guida.set_column_width(0, 100.0).map_err(|e| e.to_string())?;
    for (r, testo) in istruzioni.iter().enumerate() {
        guida
            .write_string(r as u32, 0, testo)
            .map_err(|e| e.to_string())?;
    }

    libro.save(&percorso).map_err(|e| format!("Impossibile scrivere il file: {e}"))
}


/// Un foglio del modulo: il nome della squadra, le colonne, le righe.
#[derive(serde::Deserialize)]
pub struct FoglioDati {
    pub nome: String,
    pub intestazioni: Vec<String>,
    pub righe: Vec<Vec<String>>,
}

/// Scrive un modello a piu' fogli: uno per squadra, piu' le istruzioni.
///
/// Serve al modulo di distribuzione, dove il nome del foglio *e'* il nome della
/// squadra: cosi' chi compila non deve riscriverla su ogni riga, e non la puo'
/// sbagliare.
#[tauri::command]
pub async fn scrivi_excel_fogli(
    percorso: String,
    fogli: Vec<FoglioDati>,
    istruzioni: Vec<String>,
) -> Result<(), String> {
    let mut libro = Workbook::new();
    let grassetto = Format::new()
        .set_bold()
        .set_background_color(0xF2C230)
        .set_border(rust_xlsxwriter::FormatBorder::Thin);

    for foglio in &fogli {
        let dati = libro.add_worksheet();
        // Excel non accetta piu' di 31 caratteri, ne' : \ / ? * [ ]
        let nome = pulisci_nome(&foglio.nome);
        dati.set_name(&nome).map_err(|e| e.to_string())?;
        for (c, testo) in foglio.intestazioni.iter().enumerate() {
            dati.write_string_with_format(0, c as u16, testo, &grassetto)
                .map_err(|e| e.to_string())?;
            let larghezza = (testo.chars().count() as f64 + 3.0).max(11.0);
            dati.set_column_width(c as u16, larghezza)
                .map_err(|e| e.to_string())?;
        }
        for (r, riga) in foglio.righe.iter().enumerate() {
            for (c, cella) in riga.iter().enumerate() {
                dati.write_string(r as u32 + 1, c as u16, cella)
                    .map_err(|e| e.to_string())?;
            }
        }
        dati.set_freeze_panes(1, 2).map_err(|e| e.to_string())?;
    }

    let guida = libro.add_worksheet();
    guida.set_name("Istruzioni").map_err(|e| e.to_string())?;
    guida.set_column_width(0, 100.0).map_err(|e| e.to_string())?;
    for (r, testo) in istruzioni.iter().enumerate() {
        guida
            .write_string(r as u32, 0, testo)
            .map_err(|e| e.to_string())?;
    }

    libro
        .save(&percorso)
        .map_err(|e| format!("Impossibile scrivere il file: {e}"))
}

/// Legge tutti i fogli, e per ognuno dice come si chiama.
#[tauri::command]
pub async fn leggi_excel_fogli(percorso: String) -> Result<Vec<(String, Vec<Vec<String>>)>, String> {
    let mut libro: Xlsx<_> =
        open_workbook(&percorso).map_err(|e| format!("Impossibile aprire il file: {e}"))?;
    let nomi = libro.sheet_names().to_vec();
    let mut fuori = Vec::new();
    for nome in nomi {
        let foglio = match libro.worksheet_range(&nome) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut righe = Vec::new();
        for riga in foglio.rows() {
            let celle: Vec<String> = riga.iter().map(cella_in_testo).collect();
            if celle.iter().any(|c| !c.trim().is_empty()) {
                righe.push(celle);
            }
        }
        fuori.push((nome, righe));
    }
    Ok(fuori)
}

/// Il nome di un foglio Excel: al massimo 31 caratteri e senza : \ / ? * [ ]
fn pulisci_nome(n: &str) -> String {
    let pulito: String = n
        .chars()
        .map(|c| match c {
            ':' | '\\' | '/' | '?' | '*' | '[' | ']' => ' ',
            altro => altro,
        })
        .collect();
    let tagliato: String = pulito.trim().chars().take(31).collect();
    if tagliato.is_empty() {
        "Foglio".to_string()
    } else {
        tagliato
    }
}

/// Legge il primo foglio e lo restituisce come righe di testo.
///
/// Tutto diventa testo, numeri compresi: i numeri interi senza decimali finti,
/// perche' un numero di maglia letto come "8.0" poi non combacia con niente.
#[tauri::command]
pub async fn leggi_excel(percorso: String) -> Result<Vec<Vec<String>>, String> {
    let mut libro: Xlsx<_> =
        open_workbook(&percorso).map_err(|e| format!("Impossibile aprire il file: {e}"))?;
    let nome = libro
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "Il file non ha nessun foglio".to_string())?;
    let foglio = libro
        .worksheet_range(&nome)
        .map_err(|e| format!("Impossibile leggere il foglio: {e}"))?;

    let mut fuori = Vec::new();
    for riga in foglio.rows() {
        let celle: Vec<String> = riga.iter().map(cella_in_testo).collect();
        // Le righe completamente vuote non interessano: in fondo ai fogli
        // compilati a mano ce ne sono sempre a decine.
        if celle.iter().any(|c| !c.trim().is_empty()) {
            fuori.push(celle);
        }
    }
    Ok(fuori)
}

fn cella_in_testo(c: &Data) -> String {
    match c {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => {
            if (f.fract()).abs() < f64::EPSILON {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => (if *b { "si" } else { "no" }).to_string(),
        Data::DateTime(d) => d
            .as_datetime()
            .map(|x| x.format("%d/%m/%Y").to_string())
            .unwrap_or_default(),
        altro => altro.to_string().trim().to_string(),
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Scrive e rilegge: quello che entra deve uscire uguale.
    #[test]
    fn andata_e_ritorno() {
        let f = std::env::temp_dir().join("prova-magazzino.xlsx");
        let p = f.to_string_lossy().to_string();
        scrivi_excel(
            p.clone(),
            "Atlete".into(),
            vec!["Squadra".into(), "Cognome".into(), "Numero".into()],
            vec![
                vec!["UNDER 14".into(), "Rossi".into(), "8".into()],
                vec!["UNDER 14".into(), "Verdi".into(), "12".into()],
            ],
            vec!["Istruzioni di prova".into()],
        )
        .expect("scrittura");

        let righe = leggi_excel(p).expect("lettura");
        assert_eq!(righe.len(), 3, "intestazione piu' due righe");
        assert_eq!(righe[0][0], "Squadra");
        assert_eq!(righe[1], vec!["UNDER 14", "Rossi", "8"]);
        // Il numero non deve tornare come "8.0": non combacerebbe con niente.
        assert_eq!(righe[2][2], "12");
        let _ = std::fs::remove_file(&f);
    }

    /// Legge i fogli veri fatti con openpyxl: chi scrive e chi legge sono due
    /// librerie diverse, e non e' scontato che si capiscano.
    #[test]
    fn legge_i_fogli_fatti_con_python() {
        // Una societa' qualunque fra quelle locali: `data/<societa>/modelli`.
        // Le cartelle delle societa' non sono versionate, quindi su una copia
        // pulita del progetto questa prova si salta.
        let Some(base) = std::fs::read_dir("../data")
            .ok()
            .and_then(|d| {
                d.filter_map(|v| v.ok().map(|v| v.path().join("modelli")))
                    .find(|p| p.join("atlete.xlsx").is_file())
            })
        else {
            eprintln!("salto: nessun data/<societa>/modelli con dentro i fogli");
            return;
        };
        for (file, colonna_uno, minimo) in [
            ("atlete.xlsx", "Squadra", 100),
            ("divise.xlsx", "Modello", 100),
            ("articoli.xlsx", "Articolo", 50),
            ("richieste.xlsx", "Squadra", 200),
        ] {
            let p = base.join(file).to_string_lossy().to_string();
            let righe = leggi_excel(p).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert!(righe.len() > minimo, "{file}: solo {} righe", righe.len());
            assert_eq!(righe[0][0], colonna_uno, "{file}: prima colonna");
            assert!(
                righe[1].iter().any(|c| !c.is_empty()),
                "{file}: la prima riga di dati e' vuota"
            );
        }
    }
}
