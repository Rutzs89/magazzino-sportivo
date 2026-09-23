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
use std::sync::OnceLock;
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
    fs::create_dir_all(&dir).map_err(|e| format!("Impossibile creare la cartella dati: {e}"))?;
    Ok(dir)
}

fn file_dati(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(cartella_dati(app)?.join(NOME_FILE))
}

/// Scrive un file senza mai lasciarlo a meta': si scrive accanto, si forza
/// l'arrivo sul disco, e solo allora si prende il posto di quello vecchio.
fn scrivi_sicuro(percorso: &std::path::Path, contenuto: &[u8]) -> std::io::Result<()> {
    let mut nome = percorso.as_os_str().to_owned();
    nome.push(".tmp");
    let temporaneo = PathBuf::from(nome);
    let esito = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&temporaneo)?;
        f.write_all(contenuto)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&temporaneo, percorso)
    })();
    if esito.is_err() {
        let _ = fs::remove_file(&temporaneo); // niente avanzi a meta'
    }
    esito
}

/// Una copia intera finisce con la graffa che chiude l'archivio. Una copia
/// interrotta a meta' (chiavetta sfilata, disco pieno) no.
fn copia_intera(p: &std::path::Path) -> bool {
    match fs::read(p) {
        Ok(b) => b.iter().rev().find(|c| !c.is_ascii_whitespace()) == Some(&b'}'),
        Err(_) => false,
    }
}

/// La cartella delle copie: quella scelta, se esiste, oppure `copie` accanto
/// all'archivio.
fn cartella_copie_da(app: &tauri::AppHandle, cartella_copie: Option<String>) -> Result<PathBuf, String> {
    match cartella_copie.filter(|c| !c.trim().is_empty()) {
        Some(c) => {
            let d = PathBuf::from(&c);
            // La cartella scelta deve **esistere gia'**. Senza questo controllo,
            // su Mac una chiavetta staccata non da' errore: /Volumes e'
            // scrivibile, quindi si creerebbero le cartelle sul disco interno e
            // un mese di copie finirebbe in un posto fantasma.
            if !d.is_dir() {
                return Err(format!(
                    "la cartella delle copie non è raggiungibile: {c}. Se si trova su un disco esterno, occorre collegarlo."
                ));
            }
            Ok(d)
        }
        None => {
            let d = cartella_dati(app)?.join("copie");
            fs::create_dir_all(&d)
                .map_err(|e| format!("Impossibile creare la cartella copie: {e}"))?;
            Ok(d)
        }
    }
}

/// Percorso del file dati, da mostrare nelle impostazioni.
#[tauri::command]
fn percorso_dati(app: tauri::AppHandle) -> Result<String, String> {
    Ok(file_dati(&app)?.to_string_lossy().to_string())
}

/// Legge il file dati. Se non esiste ancora restituisce stringa vuota.
#[tauri::command]
async fn carica_dati(app: tauri::AppHandle) -> Result<String, String> {
    let percorso = file_dati(&app)?;
    if !percorso.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&percorso).map_err(|e| format!("Impossibile leggere i dati: {e}"))
}

/// Scrive il file dati. La scrittura passa da un file temporaneo, cosi' un
/// arresto improvviso non lascia il file a meta'.
///
/// E' `async`: i comandi normali girano sul filo della finestra, e con le copie
/// su una chiavetta lenta la finestra si bloccava a ogni salvataggio.
///
/// Torna un avviso (testo) quando i dati sono salvati ma la copia del giorno
/// non si e' potuta fare: il salvataggio e' comunque riuscito, la copia no, e
/// chi usa il programma deve saperlo invece di credere di avere copie che non ha.
#[tauri::command]
async fn salva_dati(
    app: tauri::AppHandle,
    contenuto: String,
    cartella_copie: Option<String>,
) -> Result<Option<String>, String> {
    let _turno = SCRITTURA
        .lock()
        .map_err(|_| "Salvataggio occupato".to_string())?;

    let percorso = file_dati(&app)?;

    // Prima di scrivere il nuovo, la copia del giorno: e' l'archivio com'era
    // prima della prima modifica di oggi. Cosi' un errore fatto in mattinata si
    // recupera dalla copia di oggi; prima la copia inseguiva il file vivo e
    // conteneva gia' l'errore.
    let avviso = copia_del_giorno(&app, &percorso, &contenuto, cartella_copie).err();

    scrivi_sicuro(&percorso, contenuto.as_bytes()).map_err(|e| format!("Impossibile salvare: {e}"))?;

    if let Some(e) = &avviso {
        eprintln!("copia di sicurezza non riuscita: {e}");
    }
    Ok(avviso)
}

/// Una copia al giorno, tenuta per un mese. Perdere i dati e' il rischio piu'
/// concreto di un archivio che vive su un solo computer.
///
/// La copia di oggi si scrive una volta sola, alla prima modifica della
/// giornata, con l'archivio **di prima**; poi non si tocca piu'. Si riscrive
/// solo se e' rimasta a meta'.
///
/// La cartella la sceglie chi usa il programma: un disco esterno o una cartella
/// sincronizzata mettono le copie al riparo anche dal computer che si rompe.
/// Senza scelta si resta accanto all'archivio.
fn copia_del_giorno(
    app: &tauri::AppHandle,
    archivio: &std::path::Path,
    nuovo: &str,
    cartella_copie: Option<String>,
) -> Result<(), String> {
    let dir = cartella_copie_da(app, cartella_copie)?;
    let oggi = chrono::Local::now().format("%Y-%m-%d").to_string();
    let copia = dir.join(format!("{PREFISSO_COPIA}{oggi}.json"));

    if !copia_intera(&copia) {
        // L'archivio di prima, se c'e' ed e' intero; al primissimo avvio non
        // c'e' niente di prima e si mette via quello nuovo.
        let prima = if copia_intera(archivio) {
            fs::read(archivio).map_err(|e| format!("Impossibile leggere l'archivio: {e}"))?
        } else {
            nuovo.as_bytes().to_vec()
        };
        scrivi_sicuro(&copia, &prima).map_err(|e| format!("Impossibile fare la copia: {e}"))?;
    }

    // Tiene solo le copie piu' recenti. Si guardano solo i file scritti da noi:
    // la cartella la sceglie l'utente e dentro puo' esserci altro, da non toccare.
    let mut copie: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| format!("Impossibile leggere le copie: {e}"))?
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

/// Prima di sostituire tutto l'archivio con un altro (Riprendi da una copia)
/// si mette via quello di adesso, nella cartella delle copie e con data e ora
/// nel nome: prima finiva accanto al file scelto, sempre con lo stesso nome, e
/// una seconda importazione cancellava la prima rete di sicurezza.
/// Se questa copia non riesce, l'importazione non si fa.
#[tauri::command]
async fn copia_prima_di_importare(
    app: tauri::AppHandle,
    contenuto: String,
    cartella_copie: Option<String>,
) -> Result<String, String> {
    let dir = cartella_copie_da(&app, cartella_copie)?;
    let quando = chrono::Local::now().format("%Y-%m-%d-%H%M%S").to_string();
    let p = dir.join(format!("prima-di-riprendere-{quando}.json"));
    scrivi_sicuro(&p, contenuto.as_bytes()).map_err(|e| format!("Impossibile fare la copia: {e}"))?;
    Ok(p.to_string_lossy().to_string())
}

/// Legge una delle copie automatiche per nome. Serve sul Mac: la cartella dei
/// dati sta dentro una cartella che il Finder mostra come un'applicazione, e
/// dalla finestra "apri" non ci si arriva. Si accettano solo nomi di copie
/// nostre, niente percorsi.
#[tauri::command]
async fn leggi_copia(
    app: tauri::AppHandle,
    nome: String,
    cartella_copie: Option<String>,
) -> Result<String, String> {
    let nostra = nostra_copia(&nome)
        || (nome.starts_with("prima-di-riprendere-")
            && nome.ends_with(".json")
            && !nome.contains(['/', '\\']));
    if !nostra {
        return Err("Il file non è una copia del programma".to_string());
    }
    let dir = cartella_copie_da(&app, cartella_copie)?;
    fs::read_to_string(dir.join(&nome)).map_err(|e| format!("Impossibile leggere la copia: {e}"))
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
        .map_err(|e| format!("Impossibile leggere le copie: {e}"))?
        .filter_map(|v| v.ok().map(|v| v.path()))
        .filter_map(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .filter(|n| nostra_copia(n) || (n.starts_with("prima-di-riprendere-") && n.ends_with(".json")))
                .map(|n| n.to_string())
        })
        .collect();
    copie.sort();
    copie.reverse();
    Ok(copie)
}

/// Salva una copia dove decide l'utente (esportazione). Anche questa passa
/// dal file temporaneo: salvando sopra un'esportazione vecchia, un errore a
/// meta' non deve distruggere quella che c'era.
#[tauri::command]
async fn scrivi_file(percorso: String, contenuto: String) -> Result<(), String> {
    scrivi_sicuro(std::path::Path::new(&percorso), contenuto.as_bytes())
        .map_err(|e| format!("Impossibile scrivere il file: {e}"))
}

/// Legge un file scelto dall'utente (importazione).
#[tauri::command]
async fn leggi_file(percorso: String) -> Result<String, String> {
    fs::read_to_string(&percorso).map_err(|e| format!("Impossibile leggere il file: {e}"))
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
    let dati = fs::read(&percorso).map_err(|e| format!("Impossibile leggere l'immagine: {e}"))?;
    if dati.len() > MASSIMO {
        return Err(format!(
            "l'immagine pesa {} KB: il massimo e' {} KB. Occorre ridurne le dimensioni.",
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
        altro => return Err(format!("formato non gestito: {altro}. Sono accettati PNG, JPG e SVG.")),
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
        .map_err(|e| format!("Impossibile controllare: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Impossibile controllare: {e}"))?;
    Ok(agg.map(|u| u.version))
}

static SCARICATI: AtomicU64 = AtomicU64::new(0);
static TOTALE: AtomicU64 = AtomicU64::new(0);
static FINITO: AtomicBool = AtomicBool::new(false);

/// L'aggiornamento scaricato e non ancora installato.
fn in_attesa() -> &'static Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> {
    static PRONTO: OnceLock<Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>> = OnceLock::new();
    PRONTO.get_or_init(|| Mutex::new(None))
}

/// Scarica l'aggiornamento, senza installarlo. Il pacchetto viene accettato
/// solo se la firma corrisponde alla chiave pubblica scritta in tauri.conf.json.
///
/// In due tempi apposta: fra lo scaricamento e l'installazione la pagina
/// finisce di salvare. Prima si faceva tutto in un colpo, e su Windows il
/// programma si chiudeva per installare mentre una modifica fatta durante lo
/// scaricamento aspettava ancora di essere scritta.
#[tauri::command]
async fn scarica_aggiornamento(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let agg = app
        .updater()
        .map_err(|e| format!("Impossibile scaricare: {e}"))?
        .check()
        .await
        .map_err(|e| format!("Impossibile scaricare: {e}"))?
        .ok_or_else(|| "Nessun aggiornamento da installare".to_string())?;

    SCARICATI.store(0, Ordering::Relaxed);
    TOTALE.store(0, Ordering::Relaxed);
    FINITO.store(false, Ordering::Relaxed);

    let esito = agg
        .download(
            |pezzo, totale| {
                SCARICATI.fetch_add(pezzo as u64, Ordering::Relaxed);
                TOTALE.store(totale.unwrap_or(0), Ordering::Relaxed);
            },
            || {
                FINITO.store(true, Ordering::Relaxed);
            },
        )
        .await;

    match esito {
        Ok(byte) => {
            *in_attesa().lock().map_err(|_| "Aggiornamento occupato".to_string())? = Some((agg, byte));
            Ok(())
        }
        Err(e) => {
            // Se va male i conti si azzerano, se no la schermata resta li' a
            // dire che sta scaricando qualcosa che non sta piu' scaricando.
            SCARICATI.store(0, Ordering::Relaxed);
            TOTALE.store(0, Ordering::Relaxed);
            FINITO.store(false, Ordering::Relaxed);
            Err(format!("Impossibile scaricare: {e}"))
        }
    }
}

/// Installa l'aggiornamento gia' scaricato e riapre il programma.
///
/// Su Windows l'installazione chiude il programma da sola e lo riapre
/// l'installatore. Sul Mac invece si limita a sostituire il programma: senza
/// riavviarlo, la schermata restava ferma al 100% e diceva di non chiudere.
#[tauri::command]
async fn applica_aggiornamento(app: tauri::AppHandle) -> Result<(), String> {
    let pronto = in_attesa()
        .lock()
        .map_err(|_| "Aggiornamento occupato".to_string())?
        .take()
        .ok_or_else(|| "L'aggiornamento non è stato scaricato".to_string())?;
    let (agg, byte) = pronto;
    agg.install(byte).map_err(|e| format!("Impossibile installare: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    app.restart();
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        Ok(())
    }
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

/// Ogni richiesta di uscita ha un numero: se la pagina dice di aspettare
/// (non e' riuscita a salvare e chiede cosa fare), la rete di sicurezza che
/// spegne dopo qualche secondo non vale piu' per quella richiesta.
static USCITA_N: AtomicU64 = AtomicU64::new(0);
static USCITA_AVVIATA: AtomicBool = AtomicBool::new(false);

/// La pagina non e' riuscita a salvare: l'uscita si ferma, e si puo' chiedere
/// di nuovo piu' tardi.
#[tauri::command]
fn annulla_uscita() {
    USCITA_N.fetch_add(1, Ordering::SeqCst);
    USCITA_AVVIATA.store(false, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;

    tauri::Builder::default()
        // Un programma solo per volta: due finestre aperte sullo stesso
        // archivio si cancellavano a vicenda le modifiche. Aprendolo di nuovo
        // si torna alla finestra che c'e' gia'. Deve essere il primo plugin.
        .plugin(tauri_plugin_single_instance::init(|app, _argomenti, _cartella| {
            if let Some(f) = app.get_webview_window("main") {
                let _ = f.unminimize();
                let _ = f.show();
                let _ = f.set_focus();
            }
        }))
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
            copia_prima_di_importare,
            leggi_copia,
            cerca_aggiornamento,
            scarica_aggiornamento,
            applica_aggiornamento,
            avanzamento_aggiornamento,
            conti_chiusi,
            annulla_uscita,
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
                    // restare accesi per sempre. A meno che la pagina abbia
                    // detto di aspettare (annulla_uscita).
                    let n = USCITA_N.load(Ordering::SeqCst);
                    let h = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        if USCITA_N.load(Ordering::SeqCst) == n {
                            h.exit(0);
                        }
                    });
                }
            }
        });
}
