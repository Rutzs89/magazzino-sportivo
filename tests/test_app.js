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
 {const senza=[...html.matchAll(/<(?:input|select)[^>]*data-bind="([^"]+)"[^>]*>/g)].filter(m=>!/ id="/.test(m[0])).map(m=>m[1]);
  ok(senza.length===0,`ogni casella di filtro tiene il cursore${senza.length?': senza id '+senza.join(', '):''}`);}
 // Ogni window.__APP.qualcosa usato dalla pagina deve esistere
 // nell'adattatore: e' cosi' che i pulsanti Excel e aggiornamenti erano morti.
 {const ad=fs.readFileSync('tools/adattatore_tauri.js','utf8');
  const usati=[...new Set([...html.matchAll(/window\.__APP\.(\w+)/g)].map(m=>m[1]))];
  const mancano=usati.filter(n=>!new RegExp('\\b'+n+'\\s*:\\s*(async\\s+)?function').test(ad));
  ok(mancano.length===0,`ogni funzione del programma installato usata dalla pagina esiste${mancano.length?': mancano '+mancano.join(', '):` (${usati.length})`}`);}
 // Tutto il corpo delle azioni, non solo la riga del case: le chiamate
 // sulle righe seguenti prima sfuggivano.
 {const i=html.indexOf("document.addEventListener('click',async e=>{");
  const j=html.indexOf('\n});',i);
  const corpo=html.slice(i,j);
  const nomi=new Set();
  for(const m of corpo.matchAll(/(^|[^.\w$])([A-Za-z_]\w*)\(/g))nomi.add(m[2]);
  const PAROLE=new Set(['if','for','while','return','switch','catch','function','typeof','await','async','case','new','Number','String','Object','Boolean','Math','Date','Array','Set','Map','Promise','JSON','setTimeout','clearTimeout','setInterval','clearInterval','confirm','alert','encodeURIComponent','decodeURIComponent','parseInt','isNaN','RegExp','Error']);
  const locali=new Set([...corpo.matchAll(/(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/g)].map(m=>m[1]));
  const mancano=[...nomi].filter(n=>!PAROLE.has(n)&&!locali.has(n)&&w.eval(`typeof ${n}`)==='undefined');
  ok(mancano.length===0,`ogni funzione chiamata nel gestore dei pulsanti esiste${mancano.length?': mancano '+mancano.join(', '):` (${nomi.size} nomi)`}`);}
 // Nel programma installato la conferma di sistema non va (e senza await
 // passava da sola): ogni domanda passa da chiedi(), sempre con await.
 {const ad=fs.readFileSync('tools/adattatore_tauri.js','utf8');
  const nude=[...html.matchAll(/(^|[^\w.])confirm\(/g)].length+[...html.matchAll(/window\.confirm\(/g)].length;
  const senzaAwait=[...html.matchAll(/(^|[^\w])chiedi\(/g)].filter(m=>!/(await\s*|function\s*)$/.test(html.slice(Math.max(0,m.index-10),m.index+m[1].length)));
  ok(nude===1&&senzaAwait.length===0&&!/window\.confirm\(AVVISO_CHIUSURA\)\)\)/.test(ad.replace(/window\.chiedi \? window\.chiedi\(AVVISO_CHIUSURA\) : window\.confirm\(AVVISO_CHIUSURA\)/g,'')),
    `ogni conferma passa da chiedi() e la aspetta (conferme di sistema dirette: ${nude-1}, senza await: ${senzaAwait.length})`);}
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

 // --- annullare la consegna annulla anche il ritiro, e riapre la richiesta ---
 {const mid=Object.keys(store.movimenti).find(k=>store.movimenti[k].tipo==='CONSEGNA'&&store.movimenti[k].divisaId==='PROVA_NUOVA');
  w.confirm=()=>true;
  await w.eval(`annullaMovimento('${mid}')`);await wait(300);
  ok(store.divise.PROVA_NUOVA.holder===null&&store.divise.PROVA_VECCHIA.holder===atletaPrima&&store.divise.PROVA_VECCHIA.daRestituire===true,
    'annullando la consegna tornano a posto tutte e due le divise');
  ok(!!store.richieste.PROVA_RIC,'e la richiesta consegnata torna aperta');
  ok(!Object.values(store.movimenti).some(m=>m.divisaId==='PROVA_NUOVA'||m.divisaId==='PROVA_VECCHIA'),'i movimenti dell\'operazione spariscono insieme');}

 // --- la maglia che sta restituendo non le viene riproposta ---
 {const sq='UNDER 13';
  const [x,y]=Object.entries(store.atlete).filter(([,a])=>a.squadra===sq).map(e=>e[0]);
  store.divise.PROVA_SUA={taglia:'XXL',numero:98,modello:'STANDARD',holder:x,daRestituire:true,note:''};
  store.divise.PROVA_LIBERA98={taglia:'XXS',numero:98,modello:'STANDARD',holder:null,daRestituire:false,note:''};
  store.richieste.PROVA_R1={atletaId:x,articolo:'DIVISA GARA',modello:'',taglia:'XXL',numeroDesiderato:null,note:'',ordine:0};
  store.richieste.PROVA_R2={atletaId:y,articolo:'DIVISA GARA',modello:'',taglia:'XXS',numeroDesiderato:null,note:'',ordine:0};
  notify();await wait(200);
  const D3=w.eval('derive()');
  ok(D3.prop.PROVA_R1.divisaId!=='PROVA_SUA','la maglia che un\'atleta restituisce non le viene riproposta come nuova');
  ok(D3.prop.PROVA_R2.divisaId!=='PROVA_LIBERA98','il numero di chi cambia maglia resta suo: una compagna non lo prende');
  // e in generale: nessuna proposta usa il numero riservato a una compagna
  const ris={};for(const r of Object.values(store.richieste)){const a=store.atlete[r.atletaId];if(!a)continue;
    const own=w.eval(`mieiDaCambiare('${r.atletaId}',derive().modelloPer(${JSON.stringify(r)}))`);
    if(own)ris[a.squadra+'|'+own.numero]=r.atletaId}
  const rubati=Object.entries(D3.prop).filter(([rid,p])=>{if(!p.divisaId)return false;const r=store.richieste[rid];const d=store.divise[p.divisaId];
    const chi=ris[store.atlete[r.atletaId].squadra+'|'+d.numero];return chi&&chi!==r.atletaId&&d.holder!==chi});
  ok(rubati.length===0,`nessuna proposta prende il numero riservato a una compagna (${rubati.length})`);}

 // --- la stessa persona in due squadre riceve il materiale una volta sola ---
 {const dati=w.eval('omonimiDaChiarire()');
  ok(dati.length>0,`il programma chiede se i nomi uguali in squadre diverse sono la stessa persona (${dati.length})`);
  if(dati.length){const ids=dati[0][1];
    const mat=Object.entries(store.richieste).filter(([,r])=>ids.includes(r.atletaId)&&!w.eval(`derive().conNumero(${JSON.stringify(r.articolo)})`));
    const perArt={};for(const [rid,r] of mat)(perArt[r.articolo]=perArt[r.articolo]||[]).push(rid);
    const doppio=Object.values(perArt).find(v=>v.length>1);
    await w.eval(`collegaSchede(${JSON.stringify(ids)})`);await wait(200);
    ok(ids.every(x=>store.atlete[x].persona&&store.atlete[x].persona===store.atlete[ids[0]].persona),'le schede vengono collegate');
    if(doppio){const D4=w.eval('derive()');const esiti=doppio.map(rid=>D4.prop[rid].esito);
      ok(esiti.filter(e=>e!=='ESCLUSA').length===1,`lo stesso articolo viene preparato una volta sola (${esiti.join(', ')})`)}
    ok(w.eval('omonimiDaChiarire()').length===dati.length-1,'e la domanda per quel nome non compare piu\'');}}

 // --- Consegna a tutti: un movimento per atleta, richieste chiuse, magazzino giusto ---
 {w.confirm=()=>true;
  const D0=w.eval('derive()');
  // la squadra con piu' richieste di materiale ancora aperte
  const perSq={};for(const r of Object.values(store.richieste)){const a=store.atlete[r.atletaId];if(a&&!D0.conNumero(r.articolo))perSq[a.squadra]=(perSq[a.squadra]||0)+1}
  const sq=Object.entries(perSq).sort((x,y)=>y[1]-x[1])[0][0];
  const atl=Object.entries(store.atlete).filter(([,a])=>a.squadra===sq);
  const ric=Object.entries(store.richieste).filter(([,r])=>atl.some(([id])=>id===r.atletaId)&&!D0.conNumero(r.articolo));
  const cont={};ric.forEach(([,r])=>{const k=r.articolo+'|'+r.taglia;cont[k]=(cont[k]||0)+1});
  const [art,tg]=Object.entries(cont).sort((x,y)=>y[1]-x[1])[0][0].split('|');
  const haGia=id=>Object.entries(D0.dotazione[id]||{}).some(([k,v])=>v>0&&k.split('|')[0]===art);
  const attesi=atl.filter(([id,a])=>a.attiva!==false&&!a.inUscita&&!haGia(id)).map(e=>e[0]);
  const ricArt=ric.filter(([,r])=>r.articolo===art&&r.taglia===tg&&attesi.includes(r.atletaId)).map(e=>e[0]);
  const st0=(D0.stock[D0.key(art,tg)]||{ora:0}).ora;
  const movPrima=new Set(Object.keys(store.movimenti));
  w.location.hash='#squadre';await wait(200);
  w.document.querySelector(`[data-act="tuttaSq"][data-n="${sq}"]`).click();await wait(100);
  const selA=w.document.querySelector('#tArt');selA.value=art;selA.dispatchEvent(new w.Event('change'));
  const selT=w.document.querySelector('#tTg');selT.value=tg;selT.dispatchEvent(new w.Event('change'));
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(900);
  const D1=w.eval('derive()');
  const nuovi=Object.entries(store.movimenti).filter(([k])=>!movPrima.has(k)).map(e=>e[1]);
  ok(nuovi.length===attesi.length&&nuovi.every(m=>m.tipo==='CONSEGNA'&&m.qta===1&&m.articolo===art&&m.taglia===tg&&attesi.includes(m.atletaId)),
    `Consegna a tutti: un movimento di consegna per ogni atleta che non l'aveva (${nuovi.length} su ${attesi.length} attesi, ${art} ${tg})`);
  ok(new Set(nuovi.map(m=>m.atletaId)).size===nuovi.length,'nessun atleta registrato due volte');
  ok(((D1.stock[D1.key(art,tg)]||{ora:0}).ora)===st0-attesi.length,`il magazzino cala di quanti ne sono usciti (${st0} -> ${(D1.stock[D1.key(art,tg)]||{ora:0}).ora})`);
  ok(attesi.every(id=>((D1.dotazione[id]||{})[D1.key(art,tg)]||0)>0),'ognuno risulta averlo nella sua dotazione');
  ok(ricArt.length>0&&ricArt.every(rid=>!store.richieste[rid]),`le loro richieste per quell'articolo sono chiuse (${ricArt.length})`);
  // annullandone uno torna tutto come prima per quell'atleta
  const [mid,m1]=Object.entries(store.movimenti).find(([k])=>!movPrima.has(k));
  await w.eval(`annullaMovimento('${mid}')`);await wait(300);
  const D2=w.eval('derive()');
  ok(!store.movimenti[mid]&&((D2.dotazione[m1.atletaId]||{})[D2.key(art,tg)]||0)===0,'annullando una di quelle consegne, quell\'atleta torna senza');
  ok(Object.values(store.richieste).some(r=>r.atletaId===m1.atletaId&&r.articolo===art)===ric.some(([,r])=>r.atletaId===m1.atletaId&&r.articolo===art&&r.taglia===tg),
    'e la sua richiesta, se l\'aveva, torna aperta');}

 // --- uscita di un atleta: restituisce una parte, resta in uscita, poi il resto ---
 {w.confirm=()=>true;
  const D0=w.eval('derive()');
  const aid=Object.keys(store.atlete).find(id=>(D0.perAtleta[id]||[]).length===1&&!(D0.perAtleta[id]||[]).some(x=>store.divise[x].daRestituire));
  const did=D0.perAtleta[aid][0];
  store.movimenti.PROVA_TEE={ts:5,data:'2026-09-22',stagione:'2026/27',tipo:'CONSEGNA',atletaId:aid,articolo:'BORRACCIA ALLUMINIO',taglia:'UNICA',qta:1,divisaId:null,numero:null,note:''};
  store.richieste.PROVA_USCITA={atletaId:aid,articolo:'BORRACCIA PLASTICA',taglia:'UNICA',modello:'',numeroDesiderato:null,note:'',ordine:1};
  notify();await wait(200);
  w.eval(`eliminaAtleta('${aid}')`);await wait(200);
  const caselle=[...w.document.querySelectorAll('#dlgForm input[name="reso"]')];
  ok(caselle.length>=2&&caselle.some(c=>/borraccia/i.test(c.closest('label').textContent)),`l'uscita elenca quello che ha in mano (${caselle.length})`);
  ok(caselle.every(c=>!c.checked),'i capi partono non spuntati: nessun rientro registrato per sbaglio');
  // Nessuno spuntato: si conferma lo stesso, resta tutto com'e' e l'atleta
  // resta con l'eliminazione in attesa di riconsegna.
  const movPrima=Object.keys(store.movimenti).length;
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(500);
  ok(store.atlete[aid]&&store.atlete[aid].inUscita===true&&store.divise[did].holder===aid&&Object.keys(store.movimenti).length===movPrima,
    'confermando senza spunte l\'atleta resta, in attesa di riconsegna, e nessun capo rientra');
  w.eval(`eliminaAtleta('${aid}')`);await wait(200);
  // rende la divisa, la borraccia non l'ha ancora riportata
  [...w.document.querySelectorAll('#dlgForm input[name="reso"]')].filter(c=>!/borraccia/i.test(c.closest('label').textContent)).forEach(c=>{c.checked=true});
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(700);
  ok(store.atlete[aid]&&store.atlete[aid].inUscita===true&&store.divise[did].holder===null,'resa la divisa, resta segnato in uscita');
  const D1=w.eval('derive()');
  ok(D1.prop.PROVA_USCITA&&D1.prop.PROVA_USCITA.esito==='ESCLUSA','chi e\' in uscita non riceve piu\' niente');
  // rende anche la borraccia dalla sua scheda: il programma propone la cancellazione
  w.eval(`dlgRientroMat('${aid}','BORRACCIA ALLUMINIO','UNICA')`);await wait(100);
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(900);
  ok(!store.atlete[aid],'restituito l\'ultimo capo, l\'atleta viene cancellato');
  const suoi=Object.values(store.movimenti).filter(m=>m.a&&!m.atletaId);
  ok(suoi.length>=3,'i suoi movimenti restano nel registro con il nome scritto sopra');
  ok(!store.richieste.PROVA_USCITA,'e le sue richieste aperte spariscono');}

 // --- «Segna da cambiare» apre subito la richiesta della divisa nuova ---
 {const D0=w.eval('derive()');
  const did=Object.keys(store.divise).find(id=>{const d=store.divise[id];return d.holder&&!d.daRestituire&&!d.dismessa&&store.atlete[d.holder]
    &&!Object.values(store.richieste).some(r=>r.atletaId===d.holder&&D0.conNumero(r.articolo))});
  const el=w.document.createElement('button');el.dataset.act='toggleDR';el.dataset.id=did;w.document.body.appendChild(el);
  el.click();await wait(500);
  const dlg=w.document.querySelector('#dlg');
  ok(store.divise[did].daRestituire===true&&dlg.open&&w.document.querySelector('#rArt').value===w.eval('artDivisa()')&&/segnata da cambiare/.test(dlg.textContent),
    '«Segna da cambiare» apre la richiesta della divisa nuova, già impostata');
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(400);
  ok(Object.values(store.richieste).some(r=>r.atletaId===store.divise[did].holder&&r.articolo===w.eval('artDivisa()')),'e confermando la richiesta nasce');
  el.remove();}

 // --- staff ed esterni: solo nome e ruolo, niente atlete ---
 {w.eval('dlgMovimento()');await wait(100);
  ok(!w.document.querySelector('#mChi'),'«Staff ed esterni» non offre le atlete: per loro ci sono scheda e Assegnazioni');
  const n0=Object.keys(store.movimenti).length;
  w.document.querySelector('#mFuori').value='Provetta, allenatrice';
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(400);
  const m=Object.values(store.movimenti).find(x=>x.a==='Provetta, allenatrice');
  ok(Object.keys(store.movimenti).length===n0+1&&m&&m.atletaId===null,'il movimento verso lo staff si registra con il nome scritto');}

 // --- carico: arrivo, ordinati che calano, correzione della giacenza ---
 {const D0=w.eval('derive()');
  const [k]=Object.entries(D0.stock).find(([kk,s])=>!D0.conNumero(kk.split('|')[0])&&s.ora>5);
  const [art,tg]=k.split('|');const st0=D0.stock[k].ora;
  w.eval(`dlgMat(${JSON.stringify(art)},${JSON.stringify(tg)})`);await wait(100);
  w.document.querySelector('#mQ').value='3';w.document.querySelector('#mOrd').value='10';
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(600);
  let D1=w.eval('derive()');
  ok(D1.stock[k].ora===st0+3&&D1.stock[k].ordinati===7,`Registra arrivo: +3 in magazzino e 3 in meno fra gli ordinati (${D1.stock[k].ora}, ${D1.stock[k].ordinati})`);
  w.eval(`dlgMat(${JSON.stringify(art)},${JSON.stringify(tg)})`);await wait(100);
  w.document.querySelector('#mQ').value='2';
  {const r=w.document.querySelector('#dlgForm input[name="azione"][value="rett"]');r.checked=true;r.dispatchEvent(new w.Event('change',{bubbles:true}))}
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(600);
  D1=w.eval('derive()');
  ok(D1.stock[k].ora===2&&D1.stock[k].ordinati===7,'Correggi giacenza: la giacenza diventa quella contata, gli ordinati non cambiano');
  // «Salva ordinati»: solo i pezzi in arrivo, la giacenza non cambia
  w.eval(`dlgMat(${JSON.stringify(art)},${JSON.stringify(tg)})`);await wait(100);
  // anche con una quantita' scritta, «Salva ordinati» tocca solo gli ordinati
  w.document.querySelector('#mQ').value='3';w.document.querySelector('#mOrd').value='5';
  {const r=w.document.querySelector('#dlgForm input[name="azione"][value="ord"]');r.checked=true;r.dispatchEvent(new w.Event('change',{bubbles:true}))}
  ok(w.document.querySelector('#fQ').hidden&&w.document.querySelector('#dlgForm button[value="ok"]').textContent==='Salva ordinati','scegliendo «Ordine» restano solo gli ordinati e un pulsante solo, «Salva ordinati»');
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(600);
  D1=w.eval('derive()');
  ok(D1.stock[k].ora===2&&D1.stock[k].ordinati===5,`Salva ordinati: 5 in arrivo, la giacenza resta ${D1.stock[k].ora}`);
  // Invio fa l'azione scelta e visibile in cima: qui «Inventario»
  w.eval(`dlgMat(${JSON.stringify(art)},${JSON.stringify(tg)})`);await wait(100);
  {const r=w.document.querySelector('#dlgForm input[name="azione"][value="rett"]');r.checked=true;r.dispatchEvent(new w.Event('change',{bubbles:true}))}
  const q=w.document.querySelector('#mQ');q.value='4';
  q.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(600);
  D1=w.eval('derive()');
  ok(D1.stock[k].ora===4,'Invio fa quello che è scelto in cima alla finestra (inventario: la giacenza diventa 4)');
  w.eval('closeDlg()');}

 // --- come nel programma installato: la conferma e' asincrona e la risposta e' no ---
 {const rid=Object.keys(store.richieste)[0];
  w.confirm=async()=>false;
  w.location.hash='#assegnazioni';w.eval("S.ui.aTeam='';S.ui.aArt='';S.ui.aEsito='';S.ui.aQ='';changed()");await wait(300);
  const x=w.document.querySelector(`[data-act="delRichiesta"][data-id="${rid}"]`);
  if(x)x.click();await wait(300);
  ok(!!x&&!!store.richieste[rid],'se alla conferma si risponde no (anche in differita), la richiesta non viene eliminata');
  w.confirm=async()=>true;
  x&&w.document.querySelector(`[data-act="delRichiesta"][data-id="${rid}"]`).click();await wait(300);
  ok(!store.richieste[rid],'rispondendo sì viene eliminata');
  w.confirm=()=>true;}

 // --- squadre che condividono i numeri (le due U17) ---
 {w.confirm=()=>true;
  const A='UNDER 17 NERA',B='UNDER 17 GIALLA';
  w.location.hash='#squadre';w.eval("S.ui.atlTab='elenco';changed()");await wait(300);
  // il menu sta nella finestra «Impostazioni» della squadra, non piu' sulla riga
  w.document.querySelector(`[data-act="impSq"][data-n="${A}"]`).click();await wait(200);
  const menu=w.document.getElementById('dsNum');
  ok(!!menu&&w.document.querySelector('#dlg').open,'nella finestra «Impostazioni» della squadra si sceglie con chi condividere i numeri');
  menu.value=B;menu.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(400);
  const sq=()=>w.eval('S.settings.squadre');
  const gA=sq().find(x=>x.nome===A).gruppoNumeri,gB=sq().find(x=>x.nome===B).gruppoNumeri;
  ok(gA&&gA===gB,'scegliendo l\'altra squadra il collegamento vale per tutte e due');
  const D5=w.eval('derive()');
  ok(D5.occ[A]===D5.occ[B],'le due squadre vedono gli stessi numeri occupati');
  // nessuna proposta usa, in una delle due, un numero in uso nell'altra
  const inUso=new Map();for(const d of Object.values(store.divise)){if(d.dismessa||!d.holder||d.daRestituire)continue;const t=store.atlete[d.holder]&&store.atlete[d.holder].squadra;if(t===A||t===B)inUso.set(Number(d.numero),d.holder)}
  const pestano=Object.entries(D5.prop).filter(([rid,pp])=>{if(!pp.divisaId)return false;const r=store.richieste[rid];const t=store.atlete[r.atletaId].squadra;if(t!==A&&t!==B)return false;
    const n=Number(store.divise[pp.divisaId].numero);const chi=inUso.get(n);return chi&&chi!==r.atletaId&&store.divise[pp.divisaId].holder!==chi});
  ok(pestano.length===0,`nessuna proposta prende un numero già in uso nell'altra squadra del gruppo (${pestano.length})`);
  const perNumero={};for(const [rid,pp] of Object.entries(D5.prop)){if(!pp.divisaId)continue;const t=store.atlete[store.richieste[rid].atletaId].squadra;if(t!==A&&t!==B)continue;const n=store.divise[pp.divisaId].numero;perNumero[n]=(perNumero[n]||0)+1}
  ok(Object.values(perNumero).every(v=>v===1),'nel gruppo nessun numero proposto due volte');
  // un numero doppio fra le due squadre viene segnalato
  const dA=Object.entries(store.divise).find(([,d])=>!d.dismessa&&d.holder&&!d.daRestituire&&store.atlete[d.holder]&&store.atlete[d.holder].squadra===A);
  const dB=Object.entries(store.divise).find(([,d])=>!d.dismessa&&d.holder&&!d.daRestituire&&store.atlete[d.holder]&&store.atlete[d.holder].squadra===B);
  const numB=store.divise[dB[0]].numero;store.divise[dB[0]]={...store.divise[dB[0]],numero:store.divise[dA[0]].numero};notify();await wait(200);
  const dop=w.eval('conNumeroDoppio(derive())');
  ok(dop[store.divise[dA[0]].holder]&&dop[store.divise[dB[0]].holder],'un numero uguale fra le due squadre del gruppo viene segnalato su tutte e due le atlete');
  ok(w.eval('doppioniPerSerie(derive())').filter(x=>x.serie.includes('+')).length===1,'e compare una volta sola, con il nome del gruppo');
  store.divise[dB[0]]={...store.divise[dB[0]],numero:numB};notify();await wait(200);
  // sciogliere: tornano numeri propri tutte e due
  w.eval('closeDlg()');w.document.querySelector(`[data-act="impSq"][data-n="${B}"]`).click();await wait(200);
  const menu2=w.document.getElementById('dsNum');menu2.value='';menu2.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(400);
  ok(!sq().find(x=>x.nome===A).gruppoNumeri&&!sq().find(x=>x.nome===B).gruppoNumeri,'togliendo il collegamento da una delle due, il gruppo si scioglie');
  ok(w.eval('derive()').occ[A]!==w.eval('derive()').occ[B],'e ognuna torna ai suoi numeri');
  w.eval('closeDlg()');}

 // --- lotti di maglie da libero (giovanili e prima squadra) ---
 {w.__rispostaConferme=true;
  const sq=()=>w.eval('S.settings.squadre');const set=()=>w.eval('S.settings');
  const OK=()=>w.document.querySelector('#dlgForm button[value="ok"]');
  // una richiesta di maglia da libero su cui provare (se i dati non ne hanno, la si crea)
  let ridL=Object.keys(store.richieste).find(k=>{const r=store.richieste[k];return r.modello&&w.eval(`tipoLotto(${JSON.stringify(r.modello)})`)==='libero'&&!r.consegnata&&store.atlete[r.atletaId]&&store.atlete[r.atletaId].squadra!=='PRIMA DIVISIONE'});
  if(!ridL){const [k0,r0]=Object.entries(store.richieste).find(([k,r])=>!r.modello&&!r.consegnata&&store.atlete[r.atletaId]&&store.atlete[r.atletaId].squadra!=='PRIMA DIVISIONE'&&w.eval(`!!(derive().prop[${JSON.stringify(k)}]||{}).divisaId`));
    ridL='provaLibero';store.richieste[ridL]={...r0,modello:'LIBERO'};notify();await wait(200)}
  const esiti=()=>{const c={OK:0,MANCA:0,ESCLUSA:0};Object.values(w.eval('derive()').prop).forEach(p=>c[p.esito]++);return JSON.stringify(c)};
  const esitiPrima=esiti();
  const rL=store.richieste[ridL];const T=store.atlete[rL.atletaId].squadra;
  w.location.hash='#magazzino';w.eval("S.ui.magTab='divise';render()");await wait(200);
  ok(!!w.document.querySelector('[data-act="newLotto"]'),'in Magazzino -> Divise c\'è «Aggiungi lotto»');
  ok(w.document.querySelectorAll('[data-act="modLotto"]').length>=3,'ogni lotto ha il suo «Modifica lotto»');
  w.document.querySelector('[data-act="newLotto"]').click();await wait(100);
  w.document.getElementById('ltNome').value='libero giovanili';w.document.getElementById('ltTipo').value='libero';
  const spunta=[...w.document.querySelectorAll('#dlgForm input[name="sq"]')].find(c=>c.value===T);spunta.checked=true;
  OK().click();await wait(700);
  ok(set().modelli.includes('LIBERO GIOVANILI')&&set().tipiLotto['LIBERO GIOVANILI']==='libero','il lotto nuovo nasce con il suo tipo');
  ok(set().tipiLotto.LIBERO==='libero'&&set().tipiLotto.STANDARD==='gara','e i lotti di prima ricevono il tipo scritto');
  ok(sq().find(x=>x.nome===T).modelloLibero==='LIBERO GIOVANILI',`${T} prende i liberi dal lotto nuovo`);
  const unaP=Object.entries(store.atlete).find(([,a])=>a.squadra==='PRIMA DIVISIONE')[0];
  ok(w.eval(`derive().modelloPer({atletaId:'${rL.atletaId}',modello:'LIBERO'})`)==='LIBERO GIOVANILI','una richiesta di libero di quella squadra va al lotto giovanili');
  ok(w.eval(`derive().modelloPer({atletaId:'${unaP}',modello:'LIBERO'})`)==='LIBERO','la prima squadra resta sul lotto LIBERO');
  ok(w.eval(`derive().modelloPer({atletaId:'${rL.atletaId}',modello:''})`)===w.eval(`derive().lotto[${JSON.stringify(T)}]`),'la divisa da gara non cambia');
  ok(w.eval("stessoGenere('LIBERO','LIBERO GIOVANILI')")&&!w.eval("stessoGenere('LIBERO','STANDARD')")&&w.eval("stessoGenere('STANDARD','PRIMA SQUADRA')"),'un libero si cambia con un libero di qualunque lotto, una divisa da gara con una da gara');
  // il lotto e' vuoto: la richiesta resta senza maglia; con una maglia la prende
  ok(!w.eval(`derive().prop[${JSON.stringify(ridL)}].divisaId`),'con il lotto vuoto la richiesta non riceve una maglia di un altro lotto');
  const tg=rL.taglia||'M';
  store.divise.provaLG={taglia:tg,numero:77,modello:'LIBERO GIOVANILI',holder:null,daRestituire:false};notify();await wait(200);
  const pp=w.eval(`derive().prop[${JSON.stringify(ridL)}]`);
  ok(pp.divisaId==='provaLG',`con una maglia nel lotto giovanili la richiesta la riceve (${pp.esito} ${pp.divisaId||''})`);
  // rinominare: maglie, squadre e tipi seguono il nome nuovo
  w.location.hash='#magazzino';w.eval('render()');await wait(200);
  w.document.querySelector('[data-act="modLotto"][data-v="LIBERO GIOVANILI"]').click();await wait(100);
  w.document.getElementById('ltNome').value='Liberi under';OK().click();await wait(700);
  ok(store.divise.provaLG.modello==='LIBERI UNDER'&&sq().find(x=>x.nome===T).modelloLibero==='LIBERI UNDER'&&set().tipiLotto['LIBERI UNDER']==='libero'&&!set().modelli.includes('LIBERO GIOVANILI'),'rinominando il lotto si aggiornano maglie, squadre e tipo');
  // togliendo la squadra dal lotto torna al lotto LIBERO
  w.document.querySelector('[data-act="modLotto"][data-v="LIBERI UNDER"]').click();await wait(100);
  [...w.document.querySelectorAll('#dlgForm input[name="sq"]')].find(c=>c.value===T).checked=false;OK().click();await wait(700);
  ok(sq().find(x=>x.nome===T).modelloLibero==='LIBERO','togliendo la spunta la squadra torna all\'altro lotto da libero');
  // con una maglia dentro non si elimina; vuoto si'
  w.document.querySelector('[data-act="modLotto"][data-v="LIBERI UNDER"]').click();await wait(100);
  ok(!w.document.querySelector('#dlgForm button[value="elimina"]'),'un lotto con maglie non si elimina');
  w.document.querySelector('#dlgForm button[value="cancel"]').click();await wait(100);
  delete store.divise.provaLG;notify();await wait(200);
  w.document.querySelector('[data-act="modLotto"][data-v="LIBERI UNDER"]').click();await wait(100);
  w.document.querySelector('#dlgForm button[value="elimina"]').click();await wait(700);
  ok(!set().modelli.includes('LIBERI UNDER')&&!set().tipiLotto['LIBERI UNDER'],'il lotto vuoto si elimina');
  ok(esiti()===esitiPrima,`dopo le prove le proposte tornano quelle di prima ${esiti()}`);
  if(ridL==='provaLibero'){delete store.richieste.provaLibero;notify();await wait(200)}
  w.__rispostaConferme=undefined;}

 ok(errs.length===0,'nessun errore JavaScript '+(errs.join('; ')));
 process.exit(fail?1:0)})();
