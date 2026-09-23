/* Test end-to-end in jsdom con i dati della societa' indicata in data/dati-delle-prove.txt. Uso: npm test (dalla radice del progetto). */
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const html=fs.readFileSync('src/magazzino-sportivo.html','utf8');
const store=require('./dati_prove').seed();
const subs=[];let auto=0;const snap=(id,d)=>({id,exists:d!==undefined,data:()=>d,metadata:{}});const notify=()=>subs.forEach(s=>s());
const db={doc(p){const [c,id]=p.split('/');return{onSnapshot(n){const f=()=>n(snap(id,(store[c]||{})[id]));subs.push(f);f();return()=>{}},
  async update(o){if(!store[c]||!store[c][id])throw{code:'invalid_argument'};store[c][id]={...store[c][id],...o};notify()},async set(o){(store[c]=store[c]||{})[id]=o;notify()},async delete(){delete store[c][id];notify()}}},
 collection(c){return{onSnapshot(n){const f=()=>n({docs:Object.entries(store[c]||{}).map(([id,d])=>snap(id,d))});subs.push(f);f();return()=>{}},async add(o){const id='x'+(++auto);(store[c]=store[c]||{})[id]=o;notify();return{id}}}}};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/#assegnazioni',beforeParse(w){w.claude={use:async n=>n==='db'?db:null};w.scrollTo=()=>{};w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false}}});
const w=dom.window;const errs=[];w.addEventListener('error',e=>errs.push(e.message));const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fail=0;const ok=(c,m)=>{console.log((c?'OK   ':'FAIL ')+m);if(!c)fail++};
// Un pulsante che non fa niente non si vede: la schermata e' giusta, il
// programma non si lamenta, e non succede niente. E' capitato con quattro
// pulsanti insieme - i due dei fogli Excel e i due degli aggiornamenti, cioe'
// proprio quello che installa la versione nuova. Qui si controlla che ogni
// data-act abbia qualcuno che lo ascolta.
const ASCOLTATI_A_PARTE=['legenda','modCampo','modSquadra'];
{const azioni=[...new Set([...html.matchAll(/data-act="([A-Za-z]+)"/g)].map(m=>m[1]))];
 const morti=azioni.filter(a=>!html.includes("case'"+a+"'")&&!ASCOLTATI_A_PARTE.includes(a));
 ok(morti.length===0,`ogni pulsante ha qualcuno che lo ascolta${morti.length?': senza risposta '+morti.join(', '):` (${azioni.length} azioni)`}`);}

(async()=>{await wait(300);
 // Un filtro type="number" non ha il cursore leggibile: ridisegnando, le cifre
 // uscivano al contrario (98 diventava 89).
 ok(!/type="number"[^>]*data-bind=/.test(html),`nessun filtro e' un campo number: le cifre restano nell'ordine`);
 // Le squadre si vedono sempre nell'ordine di distribuzione: anche nelle tendine.
 {const D=w.eval('derive()');const attese=D.perServire.map(x=>x.nome);
  const tendina=[...w.eval(`teamOptions('','tutte')`).matchAll(/value="([^"]*)"/g)].map(m=>m[1]).filter(Boolean);
  ok(JSON.stringify(tendina)===JSON.stringify(attese)&&attese.length>1,`le squadre nelle tendine seguono l'ordine di distribuzione (${attese[0]} prima)`);}
 // Una casella di filtro senza id perde il cursore a ogni tasto: la pagina si
 // ridisegna e il cursore torna solo dove c'e' un id. Col numero di maglia non
 // si riusciva a scrivere la seconda cifra.
 {const senza=[...html.matchAll(/<input[^>]*data-bind="([^"]+)"[^>]*>/g)].filter(m=>!/ id="/.test(m[0])).map(m=>m[1]);
  ok(senza.length===0,`ogni casella di filtro tiene il cursore${senza.length?': senza id '+senza.join(', '):''}`);}
 // Il case c'era, ma chiamava una funzione sparita in un rifacimento: il
 // pulsante "Consegna a tutti" e "Scarica lista" non facevano niente. Qui si
 // controlla che ogni funzione chiamata dalle azioni esista davvero.
 {const righe=html.split('\n').filter(r=>/^\s*case'[A-Za-z]+':/.test(r));
  const nomi=new Set();
  for(const r of righe)for(const m of r.matchAll(/(^|[^.\w])([A-Za-z_]\w*)\(/g))nomi.add(m[2]);
  const PAROLE=new Set(['if','for','while','return','switch','catch','function','typeof','await','async','case','new']);
  const mancano=[...nomi].filter(n=>!PAROLE.has(n)&&w.eval(`typeof ${n}`)==='undefined'&&!new RegExp(`(const|let|var)\\s+${n}\\s*=|\\(${n}\\)|${n}=>`).test(html));
  ok(mancano.length===0,`ogni azione chiama funzioni che esistono${mancano.length?': mancano '+mancano.join(', '):` (${nomi.size} nomi)`}`);}
 const D=w.eval('derive()');const c={OK:0,MANCA:0,ESCLUSA:0};Object.values(D.prop).forEach(p=>c[p.esito]++);
 ok(c.OK===216&&c.MANCA===6&&c.ESCLUSA===0,`esiti iniziali ${JSON.stringify(c)} (attesi 216/6/0 sui dati di partenza)`);
 // La Prima Divisione non e' piu' esclusa da tutto: prende il materiale dal
 // magazzino comune, solo le divise da gara vengono dal suo lotto.
 const pd=Object.entries(D.prop).filter(([rid])=>store.atlete[store.richieste[rid].atletaId].squadra==='PRIMA DIVISIONE');
 ok(pd.length>0&&pd.every(([,p])=>p.esito!=='ESCLUSA'),`le ${pd.length} richieste della Prima Divisione non sono piu' escluse`);
 // I modelli comuni valgono per tutte le squadre: una richiesta di maglia da
 // libero pesca dallo stesso mucchio anche se arriva dalla prima squadra.
 const unaPrima=Object.entries(store.atlete).find(([,a])=>a.squadra==='PRIMA DIVISIONE')[0];
 ok(w.eval(`derive().modelloPer({atletaId:'${unaPrima}',modello:'LIBERO'})`)==='LIBERO','la prima squadra chiede i liberi dal mucchio comune');
 ok(w.eval(`derive().modelloPer({atletaId:'${unaPrima}',modello:''})`)==='PRIMA SQUADRA','ma le divise da gara le prende dal suo lotto');
 const unaU14=Object.entries(store.atlete).find(([,a])=>a.squadra==='UNDER 14')[0];
 ok(w.eval(`derive().modelloPer({atletaId:'${unaU14}',modello:''})`)==='STANDARD','le altre squadre restano sul lotto standard');
 const per={};for(const [rid,p] of Object.entries(D.prop)){if(!p.divisaId)continue;const a=store.atlete[store.richieste[rid].atletaId];const k=a.squadra+'|'+store.divise[p.divisaId].numero;per[k]=(per[k]||0)+1}
 ok(Object.values(per).every(v=>v===1),'nessun numero proposto due volte nella stessa squadra');
 // Ogni schermata deve avere una parte che scorre. E' successo due volte che
 // una schermata nuova non ce l'avesse (Squadre, poi il Manuale): la pagina
 // restava ferma e quello che stava sotto non si raggiungeva.
 {const senza=[];
  for(const v of ['squadre','assegnazioni','magazzino','movimenti','manuale','impostazioni']){
   w.location.hash='#'+v;w.eval('render()');await wait(60);
   if(!w.document.querySelector('#view>.scorrevole'))senza.push(v)}
  w.location.hash='#assegnazioni';w.eval('render()');await wait(60);
  ok(!senza.length,`ogni schermata ha una parte che scorre${senza.length?': manca in '+senza.join(', '):''}`);}
 // Quando in squadra c'e' gia' una divisa della taglia giusta che una compagna
 // sta restituendo, il programma propone quella: le due si scambiano la maglia
 // e il magazzino non si muove.
 {const scambi=Object.entries(D.prop).filter(([,p])=>/Scambio dentro/.test(p.motivo||''));
  const buoni=scambi.filter(([rid,p])=>{
   const d=store.divise[p.divisaId];if(!d||!d.holder||!d.daRestituire)return false;
   const chiLaLascia=store.atlete[d.holder],chiLaPrende=store.atlete[store.richieste[rid].atletaId];
   return chiLaLascia&&chiLaPrende&&chiLaLascia.squadra===chiLaPrende.squadra&&d.holder!==store.richieste[rid].atletaId});
  ok(scambi.length>0&&buoni.length===scambi.length,
    `gli scambi dentro la squadra sono veri scambi fra compagne (${scambi.length})`);}
 const sel=w.document.querySelector('select[data-bind="aTeam"]');sel.value='UNDER 14';sel.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(100);
 // Una richiesta alla volta, come in palestra: si preme Consegna, si conferma,
 // e l'elenco si rifa'. Finche' ce n'e' una pronta, va avanti.
 for(let giro=0;giro<60;giro++){
   const b=w.document.querySelector('[data-act="consegna"]');if(!b)break;
   b.click();await wait(40);
   const conferma=w.document.querySelector('#dlgForm button[value="ok"]');if(!conferma)break;
   conferma.click();await wait(120);
 }
 await wait(400);
 const held=Object.values(store.divise).filter(d=>d.holder&&store.atlete[d.holder].squadra==='UNDER 14'&&!d.daRestituire).map(d=>d.numero);
 ok(held.length===new Set(held).size,"dopo aver consegnato tutto l'U14 nessun numero doppio in squadra");
 // Chi cambia divisa restituisce la vecchia *quando riceve la nuova*. Se il
 // cambio non si puo' fare (il magazzino non ha quella taglia, o il numero e'
 // gia' occupato in squadra) tiene la sua finche' non arriva: non e' un
 // difetto, e da quando le squadre hanno un ordine di distribuzione capita
 // davvero, perche' le squadre piu' grandi prendono prima.
 {const D2=w.eval('derive()');
  const restate=Object.values(store.divise).filter(d=>d.holder&&store.atlete[d.holder].squadra==='UNDER 14'&&d.daRestituire);
  const senzaRicambio=restate.filter(d=>{
    const rid=Object.keys(store.richieste).find(r=>store.richieste[r].atletaId===d.holder&&store.richieste[r].articolo==='DIVISA GARA');
    return rid&&D2.prop[rid].esito!=='OK'});
  ok(restate.length===senzaRicambio.length,
    `U14: le divise da cambiare sono rientrate, tranne ${senzaRicambio.length} che aspettano il ricambio`);}
 // --- cambio di lotto: la divisa vecchia va ritirata, il numero resta ---
 // Chi passa in prima squadra restituisce la sua divisa standard e ne riceve
 // una del lotto nuovo con lo stesso numero. Cercando la vecchia nello stesso
 // lotto della nuova non si trovava: restava in mano sua e il numero si perdeva.
 const squadraPrima='PRIMA DIVISIONE';
 const atletaPrima=Object.entries(store.atlete).find(([,a])=>a.squadra===squadraPrima)[0];
 // le do una divisa STANDARD M n.77 da cambiare, e metto in magazzino la
 // PRIMA SQUADRA M n.77 piu' una M con numero piu' basso, che non deve vincere.
 store.divise.PROVA_VECCHIA={taglia:'M',numero:77,modello:'STANDARD',holder:atletaPrima,daRestituire:true,note:''};
 store.divise.PROVA_NUOVA={taglia:'M',numero:77,modello:'PRIMA SQUADRA',holder:null,daRestituire:false,note:''};
 store.divise.PROVA_BASSA={taglia:'M',numero:5,modello:'PRIMA SQUADRA',holder:null,daRestituire:false,note:''};
 store.richieste.PROVA_RIC={atletaId:atletaPrima,articolo:'DIVISA GARA',modello:'',taglia:'M',numeroDesiderato:null,note:'',ordine:0};
 notify();await wait(200);

 const D2=w.eval('derive()');const pr=D2.prop.PROVA_RIC;
 ok(pr&&pr.esito==='OK'&&pr.divisaId==='PROVA_NUOVA',
   `cambiando lotto le viene proposto lo stesso numero nel lotto nuovo (proposta: ${pr&&pr.divisaId})`);
 const daRendere=w.eval(`ownReturning('${atletaPrima}','PRIMA SQUADRA')`);
 ok(daRendere.includes('PROVA_VECCHIA'),'la divisa vecchia di un altro lotto risulta da restituire');

 // la schermata era ancora filtrata sull'U14 della prova precedente
 w.eval("S.ui.aTeam='';changed()");await wait(200);
 const bottone=w.document.querySelector('[data-act="consegna"][data-id="PROVA_RIC"]');
 ok(!!bottone,'il pulsante Consegna compare in elenco');
 if(bottone)bottone.click();
 await wait(200);
 const conferma=w.document.querySelector('#dlgForm button[value="ok"]');
 if(conferma){conferma.click();await wait(900)}
 ok(store.divise.PROVA_NUOVA.holder===atletaPrima&&!store.divise.PROVA_NUOVA.daRestituire,
   'dopo la consegna ha la divisa nuova');
 ok(store.divise.PROVA_VECCHIA.holder===null,
   'e la vecchia e\' rientrata in magazzino invece di restarle in mano');

 ok(errs.length===0,'nessun errore JavaScript '+(errs.join('; ')));
 process.exit(fail?1:0)})();
