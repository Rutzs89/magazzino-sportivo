// Tutti i dati restano su questo computer, in un file dentro la cartella dati
// dell'applicazione. Niente rete, niente account, nessun servizio esterno.
//
// Stessa impostazione del programma Valutazioni: e' gia' stata provata sul
// campo, non conviene inventarne un'altra.

mod excel;

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::Manager;

/// Un solo salvataggio per volta. Senza, due scritture ravvicinate userebbero
/// lo stesso file temporaneo e potrebbero lasciare l'archivio a meta'.
static SCRITTURA: Mutex<()> = Mutex::new(());

const NOME_FILE: &str = "magazzino.json";
const PREFISSO_COPIA: &str = "magazzino-";
const GIORNI_BACKUP: usize = 30;

/// Riconosce solo i file scritti da noi: `magazzino-AAAA-MM-GG.json`, niente
/// altro.
///
/// Prima bastava che il nome cominciasse per `magazzino-`. Nella cartella la
/// sceglie l'utente (Documenti, una cartella condivisa) e li' dentro puo' esserci
/// di tutto: con il vecchio filtro la pulizia delle copie vecchie poteva
/// cancellare file di qualcun altro.
fn nostra_copia(nome: &str) -> bool {
    let Some(resto) = nome.strip_prefix(PREFISSO_COPIA) else {
        return false;
    };
    let Some(data) = resto.strip_suffix(".json") else {
        return false;
    };
    let p: Vec<&str> = data.split('-').collect();
    p.len() == 3
        && p[0].len() == 4
        && p[1].len() == 2
        && p[2].len() == 2
        && p.iter().all(|x| x.chars().all(|c| c.is_ascii_digit()))
}

fn cartella_dati(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cartella dati non disponibile: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Non riesco a creare la cartella dati: {e}"))?;
    Ok(dir)
}

fn file_dati(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(cartella_dati(app)?.join(NOME_FILE))
}

/// Percorso del file dati, da mostrare nelle impostazioni.
#[tauri::command]
fn percorso_dati(app: tauri::AppHandle) -> Result<String, String> {
    Ok(file_dati(&app)?.to_string_lossy().to_string())
}

/// Legge il file dati. Se non esiste ancora restituisce stringa vuota.
#[tauri::command]
fn carica_dati(app: tauri::AppHandle) -> Result<String, String> {
    let percorso = file_dati(&app)?;
    if !percorso.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&percorso).map_err(|e| format!("Non riesco a leggere i dati: {e}"))
}

/// Scrive il file dati. La scrittura passa da un file temporaneo, cosi' un
/// arresto improvviso non lascia il file a meta'.
///
/// Torna un avviso (testo) quando i dati sono salvati ma la copia del giorno
/// non si e' potuta fare: il salvataggio e' comunque riuscito, la copia no, e
/// chi usa il programma deve saperlo invece di credere di avere copie che non ha.
#[tauri::command]
fn salva_dati(
    app: tauri::AppHandle,
    contenuto: String,
    cartella_copie: Option<String>,
) -> Result<Option<String>, String> {
    let _turno = SCRITTURA
        .lock()
        .map_err(|_| "Salvataggio occupato".to_string())?;

    let percorso = file_dati(&app)?;
    let temporaneo = percorso.with_extension("json.tmp");

    // Si scrive a parte, si forza l'arrivo sul disco, e solo allora si prende
    // il posto del file buono: cosi' un blackout non lascia un file a meta'.
    {
        let mut f =
            fs::File::create(&temporaneo).map_err(|e| format!("Non riesco a salvare: {e}"))?;
        f.write_all(contenuto.as_bytes())
            .map_err(|e| format!("Non riesco a salvare: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("Non riesco a salvare: {e}"))?;
    }

    fs::rename(&temporaneo, &percorso).map_err(|e| format!("Non riesco a salvare: {e}"))?;

    if let Err(e) = copia_di_sicurezza(&app, &contenuto, cartella_copie) {
        eprintln!("copia di sicurezza non riuscita: {e}");
        return Ok(Some(e));
    }
    Ok(None)
}

/// Una copia al giorno, tenuta per un mese. Perdere i dati e' il rischio piu'
/// concreto di un archivio che vive su un solo computer.
///
/// La cartella la sceglie chi usa il programma: un disco esterno o una cartella
/// sincronizzata mettono le copie al riparo anche dal computer che si rompe.
/// Senza scelta si resta accanto all'archivio.
fn copia_di_sicurezza(
    app: &tauri::AppHandle,
    contenuto: &str,
    cartella_copie: Option<String>,
) -> Result<(), String> {
    let scelta = cartella_copie.filter(|c| !c.trim().is_empty());
    let dir = match scelta {
        Some(c) => {
            let d = PathBuf::from(&c);
            // La cartella scelta deve **esistere gia'**. Senza questo controllo,
            // su Mac una chiavetta staccata non da' errore: /Volumes e'
            // scrivibile, quindi si creerebbero le cartelle sul disco interno e
            // un mese di copie finirebbe in un posto fantasma, con le
            // Impostazioni che intanto dicono che le copie ci sono.
            if !d.is_dir() {
                return Err(format!(
                    "la cartella delle copie non c'e': {c}. Se e' su un disco esterno, collegalo."
                ));
            }
            d
        }
        None => {
            let d = cartella_dati(app)?.join("copie");
            fs::create_dir_all(&d)
                .map_err(|e| format!("Non riesco a creare la cartella copie: {e}"))?;
            d
        }
    };

    let oggi = chrono::Local::now().format("%Y-%m-%d").to_string();
    let copia = dir.join(format!("{PREFISSO_COPIA}{oggi}.json"));

    // La copia si riscrive se manca **o se e' rimasta troncata**: prima bastava
    // che il file esistesse, quindi una copia interrotta a meta' (chiavetta
    // sfilata, disco pieno) restava li' per tutto il giorno, contata come buona
    // nell'elenco delle Impostazioni. Una copia rotta e' peggio di nessuna copia.
    let da_rifare = match fs::metadata(&copia) {
        Ok(m) => m.len() as usize != contenuto.len(),
        Err(_) => true,
    };
    if da_rifare {
        // Stesse cautele del file principale: si scrive a parte e poi si prende
        // il posto, cosi' non esiste mai una copia a meta'.
        let temporaneo = copia.with_extension("json.tmp");
        let scritta = (|| -> std::io::Result<()> {
            let mut f = fs::File::create(&temporaneo)?;
            f.write_all(contenuto.as_bytes())?;
            f.sync_all()?;
            drop(f);
            fs::rename(&temporaneo, &copia)
        })();
        if let Err(e) = scritta {
            let _ = fs::remove_file(&temporaneo); // niente avanzi a meta'
            return Err(format!("Non riesco a fare la copia: {e}"));
        }
    }

    // Tiene solo le copie piu' recenti. Si guardano solo i file scritti da noi:
    // la cartella la sceglie l'utente e dentro puo' esserci altro, da non toccare.
    let mut copie: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| format!("Non riesco a leggere le copie: {e}"))?
        .filter_map(|v| v.ok().map(|v| v.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(nostra_copia))
        .collect();
    copie.sort();
    if copie.len() > GIORNI_BACKUP {
        for vecchia in &copie[..copie.len() - GIORNI_BACKUP] {
            let _ = fs::remove_file(vecchia);
        }
    }
    Ok(())
}

/// Elenco delle copie presenti, dalla piu' recente: serve a far vedere nelle
/// impostazioni che le copie ci sono davvero.
#[tauri::command]
fn elenco_copie(
    app: tauri::AppHandle,
    cartella_copie: Option<String>,
) -> Result<Vec<String>, String> {
    let scelta = cartella_copie.filter(|c| !c.trim().is_empty());
    let dir = match scelta {
        Some(c) => PathBuf::from(c),
        None => cartella_dati(&app)?.join("copie"),
    };
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut copie: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("Non riesco a leggere le copie: {e}"))?
        .filter_map(|v| v.ok().map(|v| v.path()))
        .filter_map(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .filter(|n| nostra_copia(n))
                .map(|n| n.to_string())
        })
        .collect();
    copie.sort();
    copie.reverse();
    Ok(copie)
}

/// Salva una copia dove decide l'utente (esportazione).
#[tauri::command]
fn scrivi_file(percorso: String, contenuto: String) -> Result<(), String> {
    fs::write(&percorso, contenuto).map_err(|e| format!("Non riesco a scrivere il file: {e}"))
}

/// Legge un file scelto dall'utente (importazione).
#[tauri::command]
fn leggi_file(percorso: String) -> Result<String, String> {
    fs::read_to_string(&percorso).map_err(|e| format!("Non riesco a leggere il file: {e}"))
}

/// Legge un'immagine scelta dall'utente e la restituisce pronta da mettere in
/// una pagina.
///
/// Serve al logo della societa': il programma e' generico, lo stemma non sta nel
/// codice ma nell'archivio di chi lo usa. Deve essere piccolo: finisce dentro
/// il file dei dati e in ogni copia di sicurezza.
#[tauri::command]
fn leggi_immagine(percorso: String) -> Result<String, String> {
    use base64::Engine;

    const MASSIMO: usize = 512 * 1024;
    let dati = fs::read(&percorso).map_err(|e| format!("Non riesco a leggere l'immagine: {e}"))?;
    if dati.len() > MASSIMO {
        return Err(format!(
            "l'immagine pesa {} KB: il massimo e' {} KB. Rimpiccioliscila prima.",
            dati.len() / 1024,
            MASSIMO / 1024
        ));
    }
    let tipo = match percorso.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        altro => return Err(format!("formato non gestito: {altro}. Usa PNG, JPG o SVG.")),
    };
    Ok(format!(
        "data:{tipo};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&dati)
    ))
}

/// Guarda se c'e' una versione piu' nuova. Torna il numero di versione, oppure
/// niente se siamo gia' aggiornati.
///
/// Il controllo e l'installazione stanno qui e non in JavaScript: il programma
/// non usa impacchettatori, e dare per scontato che la libreria del plugin
/// finisca nella pagina sarebbe una scommessa. Dalla parte Rust e' sicuro.
#[tauri::command]
async fn cerca_aggiornamento(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let agg = app
        .updater()
        .map_err(|e| format!("Non riesco a controllare: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Non riesco a controllare: {e}"))?;
    Ok(agg.map(|u| u.version))
}

static SCARICATI: AtomicU64 = AtomicU64::new(0);
static TOTALE: AtomicU64 = AtomicU64::new(0);
static FINITO: AtomicBool = AtomicBool::new(false);

/// Scarica e installa l'aggiornamento. Il pacchetto viene accettato solo se la
/// firma corrisponde alla chiave pubblica scritta in tauri.conf.json.
#[tauri::command]
async fn installa_aggiornamento(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let agg = app
        .updater()
        .map_err(|e| format!("Non riesco a scaricare: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Non riesco a scaricare: {e}"))?
        .ok_or_else(|| "Non c'e' nessun aggiornamento da installare".to_string())?;

    SCARICATI.store(0, Ordering::Relaxed);
    TOTALE.store(0, Ordering::Relaxed);
    FINITO.store(false, Ordering::Relaxed);

    let esito = agg
        .download_and_install(
            |pezzo, totale| {
                SCARICATI.fetch_add(pezzo as u64, Ordering::Relaxed);
                TOTALE.store(totale.unwrap_or(0), Ordering::Relaxed);
            },
            || {
                FINITO.store(true, Ordering::Relaxed);
            },
        )
        .await;

    if esito.is_err() {
        // Se va male i conti si azzerano, se no la schermata resta li' a dire
        // che sta scaricando qualcosa che non sta piu' scaricando.
        SCARICATI.store(0, Ordering::Relaxed);
        TOTALE.store(0, Ordering::Relaxed);
        FINITO.store(false, Ordering::Relaxed);
    }
    esito.map_err(|e| format!("Non riesco a installare: {e}"))?;
    Ok(())
}

/// A che punto e' lo scaricamento: byte presi, byte in tutto, e se ha finito.
///
/// Si chiede ogni tanto dalla schermata invece di mandare un evento: gli eventi
/// passano dalla libreria JavaScript del plugin, che senza impacchettatore non
/// e' detto ci sia. Stessa ragione di `esci` e `cerca_aggiornamento`.
#[tauri::command]
fn avanzamento_aggiornamento() -> (u64, u64, bool) {
    (
        SCARICATI.load(Ordering::Relaxed),
        TOTALE.load(Ordering::Relaxed),
        FINITO.load(Ordering::Relaxed),
    )
}

/// Chiude davvero il programma.
///
/// Serve per il Mac: li' chiudere la finestra non chiude l'applicazione, che
/// resta accesa nel Dock (trappola gia' pagata con Valutazioni). L'uscita la fa
/// la parte Rust invece del plugin `process`, cosi' non dipende da una libreria
/// JavaScript che potrebbe non essere stata inserita nella pagina.
#[tauri::command]
fn esci(app: tauri::AppHandle) {
    app.exit(0);
}

/// La pagina ha finito di scrivere: adesso si puo' spegnere davvero.
#[tauri::command]
fn conti_chiusi(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;

    // L'uscita si intercetta una volta sola, se no si gira in tondo.
    static USCITA_AVVIATA: AtomicBool = AtomicBool::new(false);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            percorso_dati,
            carica_dati,
            salva_dati,
            elenco_copie,
            scrivi_file,
            leggi_file,
            leggi_immagine,
            cerca_aggiornamento,
            installa_aggiornamento,
            avanzamento_aggiornamento,
            conti_chiusi,
            esci,
            excel::scrivi_excel,
            excel::scrivi_excel_fogli,
            excel::leggi_excel_fogli,
            excel::leggi_excel
        ])
        .build(tauri::generate_context!())
        .expect("errore nell'avvio dell'applicazione")
        .run(|app, evento| {
            // Sul Mac si esce anche con Cmd+Q, dal menu, o spegnendo il
            // computer: nessuna di queste chiude la finestra, quindi non
            // passano da `onCloseRequested` e l'ultima modifica si perderebbe.
            // Qui si ferma l'uscita, si chiede alla pagina di finire di
            // scrivere, e si spegne quando risponde `conti_chiusi`.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &evento {
                if code.is_none() && !USCITA_AVVIATA.swap(true, Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("chiudi-i-conti", ());
                    // Se la pagina non risponde (bloccata, o senza il
                    // gestore), si esce lo stesso: meglio chiudere che
                    // restare accesi per sempre.
                    let h = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        h.exit(0);
                    });
                }
            }
        });
}
