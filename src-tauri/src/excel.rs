//! Legge e scrive fogli Excel, e basta.
//!
//! Qui dentro non c'e' nessuna regola del magazzino: questa parte sa solo
//! mettere righe in un foglio e ritirarle fuori. Cosa significano le colonne lo
//! decide l'app, che e' anche il posto dove si va a guardare quando una regola
//! cambia. Un giorno si cambia modello senza toccare il Rust.

use calamine::{Data, Reader, Xlsx, open_workbook};
use rust_xlsxwriter::{
    column_number_to_name, DataValidation, DataValidationErrorStyle, DataValidationRule, Format,
    FormatAlign, FormatBorder, Formula, Workbook, Worksheet,
};

/// Come si compila una colonna. Tutto lo decide l'app; qui si traduce in
/// regole di Excel:
/// - `valori`: menu a tendina. Con `libero` si puo' scrivere anche altro (una
///   squadra nuova): Excel lo segnala ma lo accetta;
/// - `intero`: [minimo, massimo], solo numeri interi;
/// - `lunghezza`: al massimo tanti caratteri;
/// - `aiuto`: il messaggio che Excel mostra selezionando la casella;
/// - `obbligatoria` e `informativa` cambiano il colore del titolo; una
///   colonna informativa ha anche le caselle in grigio.
#[derive(serde::Deserialize, Clone, Default)]
pub struct Menu {
    #[serde(default)]
    pub valori: Vec<String>,
    #[serde(default)]
    pub libero: bool,
    #[serde(default)]
    pub intero: Option<(i32, i32)>,
    #[serde(default)]
    pub lunghezza: Option<u32>,
    #[serde(default)]
    pub aiuto: String,
    #[serde(default)]
    pub obbligatoria: bool,
    #[serde(default)]
    pub informativa: bool,
}

/// Il foglio nascosto con gli elenchi troppo lunghi per stare dentro la regola
/// (Excel accetta al massimo 255 caratteri): una colonna per elenco.
const ELENCHI: &str = "Elenchi";

fn taglia(testo: &str, massimo: usize) -> String {
    testo.chars().take(massimo).collect()
}

/// La regola di Excel per una colonna, se ne serve una.
fn regola(m: &Menu, titolo: &str, elenchi: &mut Vec<Vec<String>>) -> Result<Option<DataValidation>, String> {
    let e = |x: rust_xlsxwriter::XlsxError| x.to_string();
    let valori: Vec<&str> = m.valori.iter().map(|v| v.as_str()).filter(|v| !v.is_empty()).collect();
    let (mut r, errore) = if !valori.is_empty() {
        let lungo = valori.iter().map(|v| v.chars().count() + 1).sum::<usize>() > 255
            || valori.iter().any(|v| v.contains(','));
        let r = if lungo {
            elenchi.push(valori.iter().map(|v| v.to_string()).collect());
            let c = column_number_to_name((elenchi.len() - 1) as u16);
            DataValidation::new().allow_list_formula(Formula::new(format!(
                "={ELENCHI}!${c}$1:${c}${}",
                valori.len()
            )))
        } else {
            DataValidation::new().allow_list_strings(&valori).map_err(e)?
        };
        let errore = if m.libero {
            "Il valore non è fra quelli del menu. Confermare solo se è voluto."
        } else {
            "Scegliere un valore dal menu a tendina, oppure lasciare la casella vuota."
        };
        (r, errore.to_string())
    } else if let Some((minimo, massimo)) = m.intero {
        (
            DataValidation::new().allow_whole_number(DataValidationRule::Between(minimo, massimo)),
            format!("Serve un numero intero da {minimo} a {massimo}."),
        )
    } else if let Some(n) = m.lunghezza {
        (
            DataValidation::new().allow_text_length(DataValidationRule::LessThanOrEqualTo(n)),
            format!("Al massimo {n} caratteri."),
        )
    } else if !m.aiuto.is_empty() {
        (DataValidation::new().allow_any_value(), String::new())
    } else {
        return Ok(None);
    };
    if !errore.is_empty() {
        r = if m.libero {
            r.set_error_style(DataValidationErrorStyle::Information)
                .set_error_title("Valore non in elenco")
        } else {
            r.set_error_title("Valore non ammesso")
        }
        .and_then(|r| r.set_error_message(&errore))
        .map_err(e)?;
    }
    if !m.aiuto.is_empty() {
        r = r
            .set_input_title(taglia(titolo, 32))
            .and_then(|r| r.set_input_message(taglia(&m.aiuto, 255)))
            .map_err(e)?;
    }
    Ok(Some(r))
}

/// Il foglio nascosto degli elenchi lunghi, se ne e' servito uno.
fn scrivi_elenchi(libro: &mut Workbook, elenchi: &[Vec<String>]) -> Result<(), String> {
    if elenchi.is_empty() {
        return Ok(());
    }
    let foglio = libro.add_worksheet();
    foglio.set_name(ELENCHI).map_err(|e| e.to_string())?;
    for (c, valori) in elenchi.iter().enumerate() {
        for (r, v) in valori.iter().enumerate() {
            foglio.write_string(r as u32, c as u16, v).map_err(|e| e.to_string())?;
        }
    }
    foglio.set_hidden(true);
    Ok(())
}

/// Quante righe sotto quelle scritte hanno ancora il menu: chi compila
/// aggiunge atleti in fondo.
const RIGHE_IN_PIU: u32 = 300;

fn intestazione() -> Format {
    Format::new()
        .set_bold()
        .set_background_color(0xF2C230)
        .set_border(FormatBorder::Thin)
}

/// Intestazioni, righe e menu di un foglio di dati. Torna quante righe
/// occupa l'intestazione.
///
/// Con `gruppi` l'intestazione e' su due righe: sopra il nome del gruppo (nel
/// modulo, l'articolo) su una casella unita, sotto il titolo di ogni colonna.
/// Una colonna senza gruppo occupa tutte e due le righe.
fn scrivi_dati(
    dati: &mut Worksheet,
    intestazioni: &[String],
    gruppi: &[String],
    righe: &[Vec<String>],
    menu: &[Option<Menu>],
    elenchi: &mut Vec<Vec<String>>,
) -> Result<u32, String> {
    let guida = |c: usize| menu.get(c).and_then(|m| m.as_ref());
    let informativa = |c: usize| guida(c).is_some_and(|m| m.informativa);
    let obbligatoria = |c: usize| guida(c).is_some_and(|m| m.obbligatoria);
    let grigio_titolo = Format::new()
        .set_bold()
        .set_italic()
        .set_font_color(0x595959)
        .set_background_color(0xD9D9D9)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let grigio_cella = Format::new().set_background_color(0xEFEFEF).set_font_color(0x595959);
    let grassetto = intestazione();
    // Le colonne con il menu sono di testo: una taglia 5-6 scelta dal menu
    // non deve diventare una data.
    let testo = Format::new().set_num_format("@");
    let due = gruppi.iter().any(|g| !g.trim().is_empty());
    let alte: u32 = if due { 2 } else { 1 };
    // Il testo piu' lungo di ogni colonna, fino a 40 caratteri: la colonna
    // si allarga su quello, non solo sul titolo.
    let contenuto: Vec<usize> = (0..intestazioni.len())
        .map(|c| righe.iter().map(|r| r.get(c).map_or(0, |v| v.chars().count())).max().unwrap_or(0).min(40))
        .collect();
    let larghezza = |c: usize, titolo: &str, gruppo: &str, colonne: usize| {
        let per_gruppo = (gruppo.chars().count() as f64 / colonne.max(1) as f64).ceil() + 3.0;
        let dentro = contenuto.get(c).copied().unwrap_or(0) as f64 + 2.0;
        (titolo.chars().count() as f64 + 3.0).max(per_gruppo).max(dentro).max(11.0)
    };
    if !due {
        for (c, titolo) in intestazioni.iter().enumerate() {
            let f = if informativa(c) { &grigio_titolo } else { &grassetto };
            dati.write_string_with_format(0, c as u16, titolo, f)
                .map_err(|e| e.to_string())?;
            // Larghezza a occhio sul titolo: meglio che vedere "####" ovunque.
            dati.set_column_width(c as u16, larghezza(c, titolo, "", 1))
                .map_err(|e| e.to_string())?;
        }
    } else {
        let centro = |f: Format| {
            f.set_bold()
                .set_border(FormatBorder::Thin)
                .set_align(FormatAlign::Center)
                .set_align(FormatAlign::VerticalCenter)
                .set_text_wrap()
        };
        let singola = centro(Format::new().set_background_color(0xF2C230));
        // due colori che si alternano, cosi' si vede dove finisce un articolo
        let sopra = [
            centro(Format::new().set_background_color(0xF2C230)),
            centro(Format::new().set_background_color(0xF7DD85)),
        ];
        let sotto = [
            centro(Format::new().set_background_color(0xFBEBB5)),
            centro(Format::new().set_background_color(0xFDF5DA)),
        ];
        // le colonne obbligatorie hanno il titolo di sotto piu' scuro
        let sotto_obbligatoria = centro(Format::new().set_background_color(0xF2C230));
        let n = intestazioni.len();
        let gruppo = |c: usize| gruppi.get(c).map(|g| g.trim()).unwrap_or("");
        let (mut c, mut alterna) = (0usize, 0usize);
        while c < n {
            let g = gruppo(c);
            if g.is_empty() {
                dati.merge_range(0, c as u16, 1, c as u16, &intestazioni[c], &singola)
                    .map_err(|e| e.to_string())?;
                dati.set_column_width(c as u16, larghezza(c, &intestazioni[c], "", 1))
                    .map_err(|e| e.to_string())?;
                c += 1;
                continue;
            }
            let mut fine = c;
            while fine + 1 < n && gruppo(fine + 1) == g {
                fine += 1;
            }
            let tutto_grigio = (c..=fine).all(|k| informativa(k));
            let f_sopra = if tutto_grigio { &grigio_titolo } else { &sopra[alterna] };
            if fine > c {
                dati.merge_range(0, c as u16, 0, fine as u16, g, f_sopra)
                    .map_err(|e| e.to_string())?;
            } else {
                dati.write_string_with_format(0, c as u16, g, f_sopra)
                    .map_err(|e| e.to_string())?;
            }
            for k in c..=fine {
                let f_sotto = if informativa(k) {
                    &grigio_titolo
                } else if obbligatoria(k) {
                    &sotto_obbligatoria
                } else {
                    &sotto[alterna]
                };
                dati.write_string_with_format(1, k as u16, &intestazioni[k], f_sotto)
                    .map_err(|e| e.to_string())?;
                dati.set_column_width(k as u16, larghezza(k, &intestazioni[k], g, fine - c + 1))
                    .map_err(|e| e.to_string())?;
            }
            alterna = 1 - alterna;
            c = fine + 1;
        }
        dati.set_row_height(0, 30).map_err(|e| e.to_string())?;
    }
    for (r, riga) in righe.iter().enumerate() {
        for (c, cella) in riga.iter().enumerate() {
            let r = r as u32 + alte;
            if informativa(c) {
                match cella.trim().parse::<i32>() {
                    Ok(n) => dati.write_number_with_format(r, c as u16, n, &grigio_cella),
                    Err(_) => dati.write_string_with_format(r, c as u16, cella, &grigio_cella),
                }
                .map_err(|e| e.to_string())?;
                continue;
            }
            // In una colonna di numeri interi il numero si scrive come numero:
            // la regola di Excel lo controlla e non compare il triangolino
            // verde del "numero salvato come testo".
            if let (Some(m), Ok(n)) = (guida(c), cella.trim().parse::<i32>()) {
                if m.intero.is_some() {
                    dati.write_number(r, c as u16, n).map_err(|e| e.to_string())?;
                    continue;
                }
            }
            dati.write_string(r, c as u16, cella).map_err(|e| e.to_string())?;
        }
    }
    let ultima = righe.len() as u32 + alte - 1 + RIGHE_IN_PIU;
    for (c, m) in menu.iter().enumerate() {
        let Some(m) = m else { continue };
        if c >= intestazioni.len() {
            continue;
        }
        let Some(r) = regola(m, &intestazioni[c], elenchi)? else {
            continue;
        };
        if !m.valori.is_empty() {
            dati.set_column_format(c as u16, &testo).map_err(|e| e.to_string())?;
        }
        dati.add_data_validation(alte, c as u16, ultima, c as u16, &r)
            .map_err(|e| e.to_string())?;
    }
    Ok(alte)
}

/// Il foglio delle istruzioni. Ogni riga arriva gia' classificata dall'app,
/// con il tipo davanti separato da una tabulazione:
///
///   titolo<TAB>testo              il titolo del foglio
///   sezione<TAB>testo             l'intestazione di un gruppo
///   voce<TAB>nome<TAB>spiegazione una colonna o un valore, e cosa vuol dire
///   testo<TAB>testo               un paragrafo
///
/// Una riga vuota lascia uno spazio; una riga senza tipo e' un paragrafo.
fn scrivi_guida(libro: &mut Workbook, istruzioni: &[String]) -> Result<(), String> {
    const LARGA_A: f64 = 26.0;
    const LARGA_B: f64 = 84.0;
    let guida = libro.add_worksheet();
    guida.set_name("Istruzioni").map_err(|e| e.to_string())?;
    guida.set_column_width(0, LARGA_A).map_err(|e| e.to_string())?;
    guida.set_column_width(1, LARGA_B).map_err(|e| e.to_string())?;
    let titolo = Format::new().set_bold().set_font_size(16);
    let sezione = Format::new()
        .set_bold()
        .set_background_color(0xFBEBB5)
        .set_border_bottom(FormatBorder::Thin);
    let nome = Format::new().set_bold().set_align(FormatAlign::Top);
    let spiegazione = Format::new().set_text_wrap().set_align(FormatAlign::Top);
    // Excel non allarga da solo le righe di celle unite: l'altezza si stima
    // dalla lunghezza del testo.
    let altezza = |testo: &str, larga: f64| {
        let per_riga = (larga * 1.15).max(1.0);
        let righe = (testo.chars().count() as f64 / per_riga).ceil().max(1.0);
        15.0 * righe
    };
    for (r, riga) in istruzioni.iter().enumerate() {
        let r = r as u32;
        let parti: Vec<&str> = riga.split('\t').collect();
        let (tipo, resto) = match parti.as_slice() {
            [t, resto @ ..] if !resto.is_empty() && ["titolo", "sezione", "voce", "testo"].contains(t) => (*t, resto.to_vec()),
            _ => ("testo", vec![riga.as_str()]),
        };
        let unito = resto.join(" ");
        if unito.trim().is_empty() {
            continue;
        }
        match tipo {
            "titolo" => {
                guida.write_string_with_format(r, 0, &unito, &titolo).map_err(|e| e.to_string())?;
                guida.set_row_height(r, 24).map_err(|e| e.to_string())?;
            }
            "sezione" => {
                guida.merge_range(r, 0, r, 1, &unito, &sezione).map_err(|e| e.to_string())?;
            }
            "voce" => {
                let spiega = resto[1..].join(" ");
                guida.write_string_with_format(r, 0, resto[0], &nome).map_err(|e| e.to_string())?;
                guida.write_string_with_format(r, 1, &spiega, &spiegazione).map_err(|e| e.to_string())?;
                let h = altezza(&spiega, LARGA_B).max(altezza(resto[0], LARGA_A));
                guida.set_row_height(r, h).map_err(|e| e.to_string())?;
            }
            _ => {
                guida.merge_range(r, 0, r, 1, &unito, &spiegazione).map_err(|e| e.to_string())?;
                guida.set_row_height(r, altezza(&unito, LARGA_A + LARGA_B)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

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
    menu: Option<Vec<Option<Menu>>>,
    gruppi: Option<Vec<String>>,
) -> Result<(), String> {
    let mut libro = Workbook::new();
    let mut elenchi = Vec::new();

    let dati = libro.add_worksheet();
    dati.set_name(&foglio).map_err(|e| e.to_string())?;
    let alte = scrivi_dati(
        dati,
        &intestazioni,
        &gruppi.unwrap_or_default(),
        &righe,
        &menu.unwrap_or_default(),
        &mut elenchi,
    )?;
    // L'intestazione resta ferma scorrendo: con centocinquanta atlete serve.
    dati.set_freeze_panes(alte, 0).map_err(|e| e.to_string())?;

    scrivi_guida(&mut libro, &istruzioni)?;
    scrivi_elenchi(&mut libro, &elenchi)?;
    libro.save(&percorso).map_err(|e| format!("Impossibile scrivere il file: {e}"))
}


/// Un foglio del modulo: il nome della squadra, le colonne, le righe.
#[derive(serde::Deserialize)]
pub struct FoglioDati {
    pub nome: String,
    pub intestazioni: Vec<String>,
    pub righe: Vec<Vec<String>>,
    #[serde(default)]
    pub menu: Vec<Option<Menu>>,
    /// Il gruppo di ogni colonna, per l'intestazione su due righe; vuoto = nessuno.
    #[serde(default)]
    pub gruppi: Vec<String>,
    /// Un foglio che non si vede: la fotografia del modulo com'era allo scarico.
    #[serde(default)]
    pub nascosto: bool,
    /// Colonne da nascondere (0 = la prima): gli articoli che in quella squadra
    /// non servono. Restano nel file e si rileggono, ma non ingombrano la stampa.
    #[serde(default, rename = "colonneNascoste")]
    pub colonne_nascoste: Vec<u16>,
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
    let mut elenchi = Vec::new();

    // Le istruzioni per prime: in ultima posizione, aprendo il file non si
    // vedevano (analisi del 25/09/2026).
    scrivi_guida(&mut libro, &istruzioni)?;
    for foglio in &fogli {
        let dati = libro.add_worksheet();
        // Excel non accetta piu' di 31 caratteri, ne' : \ / ? * [ ]
        let nome = pulisci_nome(&foglio.nome);
        dati.set_name(&nome).map_err(|e| e.to_string())?;
        if foglio.nascosto {
            for (r, riga) in foglio.righe.iter().enumerate() {
                for (c, v) in riga.iter().enumerate() {
                    dati.write_string(r as u32, c as u16, v).map_err(|e| e.to_string())?;
                }
            }
            dati.set_hidden(true);
            continue;
        }
        let alte = scrivi_dati(dati, &foglio.intestazioni, &foglio.gruppi, &foglio.righe, &foglio.menu, &mut elenchi)?;
        dati.set_freeze_panes(alte, 2).map_err(|e| e.to_string())?;
        for &c in &foglio.colonne_nascoste {
            dati.set_column_hidden(c).map_err(|e| e.to_string())?;
        }
        // Si porta in palestra: in orizzontale, larga quanto la pagina, e con
        // titoli e nomi ripetuti su ogni pagina (prima erano cinque pagine e dalla
        // seconda non si sapeva di chi fosse la riga).
        dati.set_landscape();
        dati.set_paper_size(9); // A4
        dati.set_print_fit_to_pages(1, 0);
        dati.set_repeat_rows(0, alte - 1).map_err(|e| e.to_string())?;
        dati.set_repeat_columns(0, 1).map_err(|e| e.to_string())?;
    }

    scrivi_elenchi(&mut libro, &elenchi)?;
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
        // Le righe vuote in mezzo si tengono: se no dopo una riga vuota il
        // numero di riga negli errori era quello di sopra. Si tolgono solo in
        // fondo. Le righe partono dalla prima del foglio anche se e' vuota.
        let (primo, _) = foglio.start().unwrap_or((0, 0));
        for _ in 0..primo {
            righe.push(Vec::new());
        }
        for riga in foglio.rows() {
            righe.push(riga.iter().map(cella_in_testo).collect::<Vec<String>>());
        }
        while righe.last().map_or(false, |r: &Vec<String>| r.iter().all(|c| c.trim().is_empty())) {
            righe.pop();
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

    /// I comandi sono asincroni: nelle prove si aspettano sul posto.
    fn b<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    /// Scrive e rilegge: quello che entra deve uscire uguale.
    #[test]
    fn andata_e_ritorno() {
        let f = std::env::temp_dir().join("prova-magazzino.xlsx");
        let p = f.to_string_lossy().to_string();
        b(scrivi_excel(
            p.clone(),
            "Atlete".into(),
            vec!["Squadra".into(), "Cognome".into(), "Numero".into()],
            vec![
                vec!["UNDER 14".into(), "Rossi".into(), "8".into()],
                vec!["UNDER 14".into(), "Verdi".into(), "12".into()],
            ],
            vec!["Istruzioni di prova".into()],
            None,
            None,
        ))
        .expect("scrittura");

        let righe = b(leggi_excel(p)).expect("lettura");
        assert_eq!(righe.len(), 3, "intestazione piu' due righe");
        assert_eq!(righe[0][0], "Squadra");
        assert_eq!(righe[1], vec!["UNDER 14", "Rossi", "8"]);
        // Il numero non deve tornare come "8.0": non combacerebbe con niente.
        assert_eq!(righe[2][2], "12");
        let _ = std::fs::remove_file(&f);
    }

    /// Con i menu e la guida impaginata il foglio si scrive e si rilegge uguale;
    /// un elenco troppo lungo per Excel lascia la colonna senza menu invece di
    /// far fallire tutto.
    #[test]
    fn menu_e_guida() {
        let f = std::env::temp_dir().join("prova-magazzino-menu.xlsx");
        let p = f.to_string_lossy().to_string();
        let lungo: Vec<String> = (0..200).map(|i| format!("valore numero {i}")).collect();
        b(scrivi_excel(
            p.clone(),
            "Divise".into(),
            vec!["Taglia".into(), "Da cambiare".into(), "Modello".into(), "Numero".into(), "Codice".into(), "Stato".into()],
            vec![vec!["5-6".into(), "sì".into(), "STANDARD".into(), "8".into(), "A001".into(), "in uso".into()]],
            vec![
                "titolo\tDIVISE".into(),
                "".into(),
                "sezione\tColonne".into(),
                "voce\tTaglia\tla taglia stampata sull'etichetta".into(),
                "testo\tUn paragrafo lungo che va a capo da solo nella cella.".into(),
                "una riga di prima, senza tipo".into(),
            ],
            Some(vec![
                Some(Menu { valori: lungo, aiuto: "La taglia".into(), obbligatoria: true, ..Default::default() }),
                Some(Menu { valori: vec!["sì".into(), "no".into()], ..Default::default() }),
                Some(Menu { valori: vec!["STANDARD".into(), "LIBERO".into()], libero: true, ..Default::default() }),
                Some(Menu { intero: Some((0, 99)), aiuto: "Numero di maglia".into(), ..Default::default() }),
                Some(Menu { lunghezza: Some(12), ..Default::default() }),
                Some(Menu { informativa: true, aiuto: "Solo informativa".into(), ..Default::default() }),
            ]),
            Some(vec!["Da compilare".into(); 5].into_iter().chain(["Solo informative".into()]).collect()),
        ))
        .expect("scrittura con menu");
        let righe = b(leggi_excel(p.clone())).expect("lettura");
        // sopra i gruppi, sotto i titoli, poi i dati; il numero torna uguale
        assert_eq!(righe[0][0], "Da compilare");
        assert_eq!(righe[1][0], "Taglia");
        assert_eq!(righe[2], vec!["5-6", "sì", "STANDARD", "8", "A001", "in uso"]);
        // l'elenco lungo e' finito nel foglio nascosto, dopo le istruzioni
        let fogli = b(leggi_excel_fogli(p)).expect("lettura dei fogli");
        let nomi: Vec<&str> = fogli.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(nomi, vec!["Divise", "Istruzioni", "Elenchi"]);
        assert_eq!(fogli[2].1.len(), 200);
        let _ = std::fs::remove_file(&f);
    }

    /// Il modulo con l'intestazione su due righe: sopra l'articolo, sotto
    /// Risposta e Taglia. Rileggendo, la casella unita ha il nome nella prima
    /// colonna; le colonne senza gruppo hanno il titolo sopra e niente sotto.
    #[test]
    fn modulo_con_i_gruppi() {
        let f = std::env::temp_dir().join("prova-magazzino-gruppi.xlsx");
        let p = f.to_string_lossy().to_string();
        let t = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<String>>();
        b(scrivi_excel_fogli(
            p.clone(),
            vec![
                FoglioDati {
                    nome: "UNDER 14".into(),
                    intestazioni: t(&["Cognome", "Nome", "Risposta", "Taglia", "Risposta", "Note"]),
                    righe: vec![t(&["Provetta", "Esempia", "mi manca", "M", "", ""]), t(&["", "", "", "", "", ""]),
                        t(&["Esempia", "Provetta", "ce l'ho", "", "", ""])],
                    menu: vec![],
                    gruppi: t(&["", "", "Felpa", "Felpa", "Borsone", ""]),
                    nascosto: false,
                    colonne_nascoste: vec![4],
                },
                FoglioDati {
                    nome: "Origine".into(),
                    intestazioni: vec![],
                    righe: vec![t(&["UNDER 14", "Provetta", "Esempia", "{}"])],
                    menu: vec![],
                    gruppi: vec![],
                    nascosto: true,
                    colonne_nascoste: vec![],
                },
            ],
            vec!["titolo\tMODULO".into()],
        ))
        .expect("scrittura");
        let fogli = b(leggi_excel_fogli(p)).expect("lettura");
        // le istruzioni per prime, poi la squadra, poi il foglio nascosto
        let nomi: Vec<&str> = fogli.iter().map(|x| x.0.as_str()).collect();
        assert_eq!(nomi, vec!["Istruzioni", "UNDER 14", "Origine"]);
        let righe = &fogli[1].1;
        assert_eq!(righe[0], t(&["Cognome", "Nome", "Felpa", "", "Borsone", "Note"]));
        assert_eq!(righe[1], t(&["", "", "Risposta", "Taglia", "Risposta", ""]));
        assert_eq!(righe[2], t(&["Provetta", "Esempia", "mi manca", "M", "", ""]));
        // la riga vuota in mezzo resta: il numero di riga negli errori e' quello vero
        assert!(righe[3].iter().all(|c| c.is_empty()));
        assert_eq!(righe[4][0], "Esempia");
        assert_eq!(fogli[2].1[0], t(&["UNDER 14", "Provetta", "Esempia", "{}"]));
        let _ = std::fs::remove_file(&f);
    }

    /// Scrive davvero i fogli preparati dalle prove JavaScript, per aprirli in
    /// Excel e guardarli: `SALVA_FOGLI=<cartella> node tests/test_excel.js`,
    /// poi `SALVA_FOGLI=<cartella> cargo test -- --ignored scrive_i_fogli`.
    #[test]
    #[ignore]
    fn scrive_i_fogli_salvati() {
        #[derive(serde::Deserialize)]
        struct Foglio { foglio: String, intestazioni: Vec<String>, righe: Vec<Vec<String>>, istruzioni: Vec<String>, menu: Option<Vec<Option<Menu>>>, gruppi: Option<Vec<String>> }
        #[derive(serde::Deserialize)]
        struct Modulo { fogli: Vec<FoglioDati>, istruzioni: Vec<String> }
        #[derive(serde::Deserialize)]
        struct Tutto { fogli: Vec<Foglio>, modulo: Modulo }
        let dir = std::path::PathBuf::from(std::env::var("SALVA_FOGLI").expect("SALVA_FOGLI"));
        let t: Tutto = serde_json::from_str(&std::fs::read_to_string(dir.join("fogli.json")).unwrap()).unwrap();
        for f in t.fogli {
            let p = dir.join(format!("{}.xlsx", f.foglio.to_lowercase())).to_string_lossy().to_string();
            b(scrivi_excel(p, f.foglio, f.intestazioni, f.righe, f.istruzioni, f.menu, f.gruppi)).unwrap();
        }
        let p = dir.join("modulo.xlsx").to_string_lossy().to_string();
        b(scrivi_excel_fogli(p, t.modulo.fogli, t.modulo.istruzioni)).unwrap();
    }

    /// Legge i fogli veri fatti con openpyxl: chi scrive e chi legge sono due
    /// librerie diverse, e non e' scontato che si capiscano.
    #[test]
    fn legge_i_fogli_fatti_con_python() {
        // La societa' delle prove, la stessa delle prove JavaScript: la indica
        // `data/dati-delle-prove.txt` (una riga, relativa alla radice del
        // progetto). Non e' versionata, quindi su una copia pulita del
        // progetto questa prova si salta.
        let radice = std::path::Path::new("..");
        let Some(base) = std::fs::read_to_string(radice.join("data/dati-delle-prove.txt"))
            .ok()
            .map(|d| radice.join(d.trim()).join("modelli"))
            .filter(|p| p.join("atlete.xlsx").is_file())
        else {
            eprintln!("salto: data/dati-delle-prove.txt non indica una societa' con i fogli");
            return;
        };
        for (file, colonna_uno, minimo) in [
            ("atlete.xlsx", "Squadra", 100),
            ("divise.xlsx", "Modello", 100),
            ("articoli.xlsx", "Articolo", 50),
            ("richieste.xlsx", "Squadra", 200),
        ] {
            let p = base.join(file).to_string_lossy().to_string();
            let righe = b(leggi_excel(p)).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert!(righe.len() > minimo, "{file}: solo {} righe", righe.len());
            assert_eq!(righe[0][0], colonna_uno, "{file}: prima colonna");
            assert!(
                righe[1].iter().any(|c| !c.is_empty()),
                "{file}: la prima riga di dati e' vuota"
            );
        }
    }
}
