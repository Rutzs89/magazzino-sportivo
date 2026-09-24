//! Legge e scrive fogli Excel, e basta.
//!
//! Qui dentro non c'e' nessuna regola del magazzino: questa parte sa solo
//! mettere righe in un foglio e ritirarle fuori. Cosa significano le colonne lo
//! decide l'app, che e' anche il posto dove si va a guardare quando una regola
//! cambia. Un giorno si cambia modello senza toccare il Rust.

use calamine::{Data, Reader, Xlsx, open_workbook};
use rust_xlsxwriter::{
    DataValidation, DataValidationErrorStyle, Format, FormatAlign, FormatBorder, Workbook,
    Worksheet,
};

/// Il menu a tendina di una colonna: i valori fra cui scegliere. Con `libero`
/// si puo' scrivere anche altro (per esempio una squadra nuova): Excel lo
/// segnala ma lo accetta. Quali valori e perche' lo decide l'app.
#[derive(serde::Deserialize, Clone, Default)]
pub struct Menu {
    pub valori: Vec<String>,
    #[serde(default)]
    pub libero: bool,
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
) -> Result<u32, String> {
    let grassetto = intestazione();
    // Le colonne con il menu sono di testo: una taglia 5-6 scelta dal menu
    // non deve diventare una data.
    let testo = Format::new().set_num_format("@");
    let due = gruppi.iter().any(|g| !g.trim().is_empty());
    let alte: u32 = if due { 2 } else { 1 };
    let larghezza = |titolo: &str, gruppo: &str, colonne: usize| {
        let per_gruppo = (gruppo.chars().count() as f64 / colonne.max(1) as f64).ceil() + 3.0;
        (titolo.chars().count() as f64 + 3.0).max(per_gruppo).max(11.0)
    };
    if !due {
        for (c, titolo) in intestazioni.iter().enumerate() {
            dati.write_string_with_format(0, c as u16, titolo, &grassetto)
                .map_err(|e| e.to_string())?;
            // Larghezza a occhio sul titolo: meglio che vedere "####" ovunque.
            dati.set_column_width(c as u16, larghezza(titolo, "", 1))
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
        let n = intestazioni.len();
        let gruppo = |c: usize| gruppi.get(c).map(|g| g.trim()).unwrap_or("");
        let (mut c, mut alterna) = (0usize, 0usize);
        while c < n {
            let g = gruppo(c);
            if g.is_empty() {
                dati.merge_range(0, c as u16, 1, c as u16, &intestazioni[c], &singola)
                    .map_err(|e| e.to_string())?;
                dati.set_column_width(c as u16, larghezza(&intestazioni[c], "", 1))
                    .map_err(|e| e.to_string())?;
                c += 1;
                continue;
            }
            let mut fine = c;
            while fine + 1 < n && gruppo(fine + 1) == g {
                fine += 1;
            }
            if fine > c {
                dati.merge_range(0, c as u16, 0, fine as u16, g, &sopra[alterna])
                    .map_err(|e| e.to_string())?;
            } else {
                dati.write_string_with_format(0, c as u16, g, &sopra[alterna])
                    .map_err(|e| e.to_string())?;
            }
            for k in c..=fine {
                dati.write_string_with_format(1, k as u16, &intestazioni[k], &sotto[alterna])
                    .map_err(|e| e.to_string())?;
                dati.set_column_width(k as u16, larghezza(&intestazioni[k], g, fine - c + 1))
                    .map_err(|e| e.to_string())?;
            }
            alterna = 1 - alterna;
            c = fine + 1;
        }
        dati.set_row_height(0, 30).map_err(|e| e.to_string())?;
    }
    for (r, riga) in righe.iter().enumerate() {
        for (c, cella) in riga.iter().enumerate() {
            dati.write_string(r as u32 + alte, c as u16, cella)
                .map_err(|e| e.to_string())?;
        }
    }
    let ultima = righe.len() as u32 + alte - 1 + RIGHE_IN_PIU;
    for (c, m) in menu.iter().enumerate() {
        let Some(m) = m else { continue };
        let valori: Vec<&str> = m.valori.iter().map(|v| v.as_str()).filter(|v| !v.is_empty()).collect();
        if valori.is_empty() || c >= intestazioni.len() {
            continue;
        }
        // Excel non accetta elenchi piu' lunghi di 255 caratteri: in quel caso
        // la colonna resta senza menu, il controllo lo fa comunque il
        // programma al caricamento.
        let Ok(regola) = DataValidation::new().allow_list_strings(&valori) else {
            continue;
        };
        let regola = (if m.libero {
            regola
                .set_error_style(DataValidationErrorStyle::Information)
                .set_error_title("Valore non in elenco")
                .and_then(|r| r.set_error_message("Il valore non è fra quelli del menu. Confermare solo se è voluto."))
        } else {
            regola
                .set_error_title("Valore non ammesso")
                .and_then(|r| r.set_error_message("Scegliere un valore dal menu a tendina, oppure lasciare la casella vuota."))
        })
        .map_err(|e| e.to_string())?;
        dati.set_column_format(c as u16, &testo)
            .map_err(|e| e.to_string())?;
        dati.add_data_validation(alte, c as u16, ultima, c as u16, &regola)
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
) -> Result<(), String> {
    let mut libro = Workbook::new();

    let dati = libro.add_worksheet();
    dati.set_name(&foglio).map_err(|e| e.to_string())?;
    scrivi_dati(dati, &intestazioni, &[], &righe, &menu.unwrap_or_default())?;
    // La prima riga resta ferma scorrendo: con centocinquanta atlete serve.
    dati.set_freeze_panes(1, 0).map_err(|e| e.to_string())?;

    scrivi_guida(&mut libro, &istruzioni)?;
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

    for foglio in &fogli {
        let dati = libro.add_worksheet();
        // Excel non accetta piu' di 31 caratteri, ne' : \ / ? * [ ]
        let nome = pulisci_nome(&foglio.nome);
        dati.set_name(&nome).map_err(|e| e.to_string())?;
        let alte = scrivi_dati(dati, &foglio.intestazioni, &foglio.gruppi, &foglio.righe, &foglio.menu)?;
        dati.set_freeze_panes(alte, 2).map_err(|e| e.to_string())?;
    }

    scrivi_guida(&mut libro, &istruzioni)?;
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
            vec!["Taglia".into(), "Da cambiare".into(), "Modello".into()],
            vec![vec!["5-6".into(), "sì".into(), "STANDARD".into()]],
            vec![
                "titolo\tDIVISE".into(),
                "".into(),
                "sezione\tColonne".into(),
                "voce\tTaglia\tla taglia stampata sull'etichetta".into(),
                "testo\tUn paragrafo lungo che va a capo da solo nella cella.".into(),
                "una riga di prima, senza tipo".into(),
            ],
            Some(vec![
                Some(Menu { valori: lungo, libero: false }),
                Some(Menu { valori: vec!["sì".into(), "no".into()], libero: false }),
                Some(Menu { valori: vec!["STANDARD".into(), "LIBERO".into()], libero: true }),
            ]),
        ))
        .expect("scrittura con menu");
        let righe = b(leggi_excel(p)).expect("lettura");
        assert_eq!(righe[1], vec!["5-6", "sì", "STANDARD"]);
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
            vec![FoglioDati {
                nome: "UNDER 14".into(),
                intestazioni: t(&["Cognome", "Nome", "Risposta", "Taglia", "Risposta", "Note"]),
                righe: vec![t(&["Provetta", "Esempia", "mi manca", "M", "", ""])],
                menu: vec![],
                gruppi: t(&["", "", "Felpa", "Felpa", "Borsone", ""]),
            }],
            vec!["titolo\tMODULO".into()],
        ))
        .expect("scrittura");
        let fogli = b(leggi_excel_fogli(p)).expect("lettura");
        let righe = &fogli[0].1;
        assert_eq!(righe[0], t(&["Cognome", "Nome", "Felpa", "", "Borsone", "Note"]));
        assert_eq!(righe[1], t(&["", "", "Risposta", "Taglia", "Risposta", ""]));
        assert_eq!(righe[2], t(&["Provetta", "Esempia", "mi manca", "M", "", ""]));
        let _ = std::fs::remove_file(&f);
    }

    /// Scrive davvero i fogli preparati dalle prove JavaScript, per aprirli in
    /// Excel e guardarli: `SALVA_FOGLI=<cartella> node tests/test_excel.js`,
    /// poi `SALVA_FOGLI=<cartella> cargo test -- --ignored scrive_i_fogli`.
    #[test]
    #[ignore]
    fn scrive_i_fogli_salvati() {
        #[derive(serde::Deserialize)]
        struct Foglio { foglio: String, intestazioni: Vec<String>, righe: Vec<Vec<String>>, istruzioni: Vec<String>, menu: Option<Vec<Option<Menu>>> }
        #[derive(serde::Deserialize)]
        struct Modulo { fogli: Vec<FoglioDati>, istruzioni: Vec<String> }
        #[derive(serde::Deserialize)]
        struct Tutto { fogli: Vec<Foglio>, modulo: Modulo }
        let dir = std::path::PathBuf::from(std::env::var("SALVA_FOGLI").expect("SALVA_FOGLI"));
        let t: Tutto = serde_json::from_str(&std::fs::read_to_string(dir.join("fogli.json")).unwrap()).unwrap();
        for f in t.fogli {
            let p = dir.join(format!("{}.xlsx", f.foglio.to_lowercase())).to_string_lossy().to_string();
            b(scrivi_excel(p, f.foglio, f.intestazioni, f.righe, f.istruzioni, f.menu)).unwrap();
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
