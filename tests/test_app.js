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

 // --- le finestre delle divise usano le taglie dell'articolo della divisa ---
 {const set=w.eval('S.settings');const i=set.articoli.findIndex(a=>a.nome===w.eval('artDivisa()'));
  const prima=set.articoli[i].taglie;
  store.settings.main={...store.settings.main,articoli:set.articoli.map((a,j)=>j===i?{...a,taglie:['12 anni',...(a.taglie||[])]}:a)};notify();await wait(200);
  w.eval('dlgDivisa(null)');await wait(100);
  ok([...w.document.querySelectorAll('#nTg option')].some(o=>o.textContent==='12 anni'),'«Aggiungi divisa» propone le taglie dell’articolo, anche quelle da bambino');
  w.eval('closeDlg()');
  store.settings.main={...store.settings.main,articoli:set.articoli.map((a,j)=>j===i?{...a,taglie:prima}:a)};notify();await wait(200);}

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
  // rinominare: maglie, squadre e tipi seguono il nome nuovo. Anche una
  // maglia dismessa e la copia di una richiesta dentro un movimento: con la
  // dismessa rimasta col nome vecchio, il lotto vecchio ricompariva vuoto.
  store.divise.provaLGdis={taglia:tg,numero:78,modello:'LIBERO GIOVANILI',holder:null,daRestituire:false,dismessa:true};
  store.movimenti=store.movimenti||{};
  store.movimenti.provaMovLG={ts:1,data:'2026-11-04',tipo:'CONSEGNA',atletaId:rL.atletaId,articolo:rL.articolo,taglia:tg,qta:1,richiesta:{...rL,modello:'LIBERO GIOVANILI'},richieste:[{...rL,modello:'LIBERO GIOVANILI'}]};
  notify();await wait(200);
  w.location.hash='#magazzino';w.eval('render()');await wait(200);
  w.document.querySelector('[data-act="modLotto"][data-v="LIBERO GIOVANILI"]').click();await wait(100);
  w.document.getElementById('ltNome').value='Liberi under';OK().click();await wait(700);
  ok(store.divise.provaLG.modello==='LIBERI UNDER'&&sq().find(x=>x.nome===T).modelloLibero==='LIBERI UNDER'&&set().tipiLotto['LIBERI UNDER']==='libero'&&!set().modelli.includes('LIBERO GIOVANILI'),'rinominando il lotto si aggiornano maglie, squadre e tipo');
  ok(store.divise.provaLGdis.modello==='LIBERI UNDER','anche la maglia dismessa passa al nome nuovo');
  ok(store.movimenti.provaMovLG.richiesta.modello==='LIBERI UNDER'&&store.movimenti.provaMovLG.richieste[0].modello==='LIBERI UNDER','e la copia della richiesta nei movimenti');
  w.eval("S.ui.magTab='divise';render()");
  ok(!w.document.querySelector('[data-act="modLotto"][data-v="LIBERO GIOVANILI"]'),'il lotto col nome vecchio non ricompare in Magazzino');
  // archivi rinominati con la 1.0.0: dismesse rimaste col nome vecchio, il lotto non va mostrato
  store.divise.provaLGdis={...store.divise.provaLGdis,modello:'NOME DI PRIMA'};notify();await wait(150);
  w.eval("S.ui.magTab='divise';render()");
  ok(!w.document.querySelector('[data-act="modLotto"][data-v="NOME DI PRIMA"]'),'un lotto con sole maglie dismesse non compare fra i lotti');
  delete store.divise.provaLGdis;delete store.movimenti.provaMovLG;notify();await wait(150);
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

 // Divisa da gara e maglia da libero con lo stesso numero alla stessa atleta:
 // non e' un numero ripetuto (falso allarme visto sull'archivio vero).
 {const [aid,a]=Object.entries(store.atlete).find(([id,x])=>x.attiva!==false&&!Object.values(store.divise).some(d=>d.holder===id));
  const T=a.squadra;
  const libero=w.eval('derive().lottiLibero[0]');const gara=w.eval(`derive().lotto[${JSON.stringify(T)}]||'STANDARD'`);
  const usati=new Set(Object.values(store.divise).filter(d=>d.holder&&store.atlete[d.holder]&&w.eval(`stessaSerie(derive(),${JSON.stringify(store.atlete[d.holder].squadra)},${JSON.stringify(T)})`)).map(d=>Number(d.numero)));
  let n=1;while(usati.has(n))n++;
  const prima=w.eval('doppioniPerSerie(derive()).length');
  store.divise.provaGaraN={taglia:'M',numero:n,modello:gara,holder:aid,daRestituire:false};
  store.divise.provaLibN={taglia:'M',numero:n,modello:libero,holder:aid,daRestituire:false};notify();await wait(150);
  ok(w.eval('doppioniPerSerie(derive()).length')===prima&&!(w.eval('conNumeroDoppio(derive())')[aid]||[]).includes(n),
    'divisa e maglia da libero con lo stesso numero alla stessa atleta: nessun numero ripetuto');
  const [aid2]=Object.entries(store.atlete).find(([id,x])=>id!==aid&&x.squadra===T);
  store.divise.provaAltraN={taglia:'L',numero:n,modello:gara,holder:aid2,daRestituire:false};notify();await wait(150);
  ok(w.eval('doppioniPerSerie(derive()).length')===prima+1,'lo stesso numero a una compagna di squadra resta segnalato');
  delete store.divise.provaGaraN;delete store.divise.provaLibN;delete store.divise.provaAltraN;notify();await wait(150);}
 // Le taglie delle divise si raggiungono da Magazzino -> Divise (Andrea,
 // 06/11/2026: «le divise non sono in materiale ma in divise nel magazzino»).
 {w.location.hash='#magazzino';w.eval("S.ui.magTab='divise';render()");await wait(100);
  const b=w.document.querySelector('.barraMag [data-act="taglieDivise"]');
  ok(!!b,'in Magazzino -> Divise c\'è il pulsante «Taglie»');
  b.click();await wait(150);
  const art=w.eval('artDivisa()');const dlg=w.document.getElementById('dlg');
  const righe=w.document.querySelectorAll('#dlgForm [data-orig]').length;
  // anche le taglie fuori elenco ma ancora usate (tratteggiate, da unire)
  ok(dlg.open&&righe>=w.eval('(S.settings.articoli.find(a=>a.conNumero).taglie||[]).filter(Boolean).length')&&(new RegExp(art,'i').test(w.document.getElementById('dlgForm').textContent)||[...w.document.querySelectorAll('#dlgForm input')].some(x=>x.value===art)),
    `«Taglie» apre le taglie dell'articolo della divisa (${righe} taglie)`);
  w.document.querySelector('#dlgForm button[value="cancel"]').click();await wait(100);
  // in Materiale l'articolo della divisa non c'e' piu' (ne' la sua famiglia, se vuota)
  w.eval("S.ui.magTab='materiale';render()");await wait(100);
  const iDiv=w.eval('(S.settings.articoli||[]).findIndex(a=>a.conNumero)');
  ok(!w.document.querySelector(`[data-act="modArticolo"][data-i="${iDiv}"]`)&&!/si contano uno per uno/.test(w.document.getElementById('view').textContent),
    'in Materiale l\'articolo della divisa non compare più');
  ok(w.document.querySelectorAll('[data-act="modArticolo"]').length===w.eval('(S.settings.articoli||[]).filter(a=>!a.conNumero&&!(a.base&&a.base!==a.nome)).length'),
    'e tutti gli altri articoli ci sono ancora');}
 // Listino e valore del magazzino (Andrea, 17/11/2026)
 {const set=()=>w.eval('S.settings');
  const arts=set().articoli;const iM=arts.findIndex(a=>!a.conNumero&&!(a.base&&a.base!==a.nome));const am=arts[iM];
  const iD=arts.findIndex(a=>a.conNumero);
  ok(w.eval('[leggiEuro("12,50"),leggiEuro("€ 1.234,5"),leggiEuro("8.9"),leggiEuro(""),Number.isNaN(leggiEuro("dodici"))].join("|")')==='12.5|1234.5|8.9||true',
    'i prezzi si leggono in euro: 12,50 · € 1.234,5 · 8.9; vuoto = non indicato; un testo è un errore');
  // dalla finestra dell'articolo
  w.location.hash='#magazzino';w.eval("S.ui.magTab='materiale';render()");await wait(100);
  w.document.querySelector(`[data-act="modArticolo"][data-i="${iM}"]`).click();await wait(100);
  w.document.getElementById('acPrezzo').value='15,00';w.document.getElementById('acCosto').value='9,5';
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(400);
  ok(set().articoli[iM].prezzo===15&&set().articoli[iM].costo===9.5,'dalla finestra dell\'articolo si salvano prezzo di vendita e costo d\'acquisto');
  w.document.querySelector(`[data-act="modArticolo"][data-i="${iM}"]`).click();await wait(100);
  ok(w.document.getElementById('acPrezzo').value==='15,00'&&w.document.getElementById('acCosto').value==='9,50','riaprendo la finestra i prezzi sono scritti in euro');
  w.document.getElementById('acPrezzo').value='quindici';w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(200);
  ok(w.document.getElementById('dlg').open&&set().articoli[iM].prezzo===15,'un prezzo scritto male non si salva e la finestra resta aperta');
  w.document.querySelector('#dlgForm button[value="cancel"]').click();await wait(100);
  w.document.querySelector(`[data-act="modArticolo"][data-i="${iD}"]`)||w.eval(`dlgArticolo(${iD})`);await wait(100);
  ok(!w.document.getElementById('acPrezzo')&&!!w.document.getElementById('acCosto'),'la divisa da gara ha solo il costo d\'acquisto: non si vende');
  w.document.querySelector('#dlgForm button[value="cancel"]').click();await wait(100);
  // valore in magazzino
  const D=w.eval('derive()');
  const pezzi=Object.entries(D.stock).filter(([k])=>k.split('|')[0]===am.nome).reduce((z,[,q])=>z+Math.max(0,q.ora),0);
  const val=w.eval('valoreMagazzino(derive())');
  ok(Math.abs(val.perArt[am.nome]-pezzi*9.5)<0.001,`valore in magazzino = pezzi × costo (${pezzi} × 9,50)`);
  w.eval("S.ui.magTab='materiale';render()");await wait(100);
  ok(w.document.getElementById('view').textContent.includes(w.eval(`euro(${pezzi*9.5})`)),'il valore compare in Materiale');
  w.location.hash='';w.eval('render()');await wait(100);
  ok(/valore/.test(w.document.getElementById('view').textContent),'e nella pagina iniziale');
  // il foglio del listino: andata e ritorno senza cambiare niente
  const righe=w.eval('MODELLI_EXCEL.listino.righe()');
  ok(righe.length===arts.length&&righe.every(r=>r.length===8),'il listino ha una riga per articolo, con le colonne informative');
  const giro=await w.eval(`MODELLI_EXCEL.listino.applica(${JSON.stringify(righe.map(r=>r.slice(0,3)))},true)`);
  ok(giro.aggiornati===0&&!giro.problemi.length,'ricaricando il listino così com\'è non cambia niente');
  const am2=arts.find((a,k)=>k!==iM&&!a.conNumero&&!(a.base&&a.base!==a.nome));
  const es=await w.eval(`MODELLI_EXCEL.listino.applica(${JSON.stringify([
    [am2.nome,'7,90','4,20'],[am.nome,'',''],['ARTICOLO CHE NON ESISTE','1',''],[am2.nome,'8',''],
    [arts[iD].nome,'30','12'],['','abc','']])},false)`);
  await wait(200);
  const a2=set().articoli.find(a=>a.nome===am2.nome);
  ok(a2.prezzo===7.9&&a2.costo===4.2,'il listino aggiorna prezzo e costo');
  ok(set().articoli[iM].prezzo===15&&set().articoli[iM].costo===9.5,'una casella vuota lascia il prezzo com\'è');
  ok(es.problemi.some(x=>/non esiste/.test(x))&&es.problemi.some(x=>/manca l'articolo/.test(x)),'un articolo sconosciuto e una riga senza articolo sono segnalati');
  ok(es.avvisi.some(x=>/più volte/.test(x))&&es.avvisi.some(x=>/non si vende/.test(x))&&set().articoli[iD].prezzo==null&&set().articoli[iD].costo===12,
    'riga ripetuta ignorata; la divisa prende il costo ma non il prezzo di vendita');
  ok(w.eval('valoreMagazzino(derive()).divise')===12*w.eval('Object.values(S.divise).filter(d=>!d.dismessa&&!d.holder).length'),'il valore delle divise conta le maglie in magazzino');
  // Storico e ordini: gli importi accanto all'articolo
  w.location.hash='#magazzino';w.eval("S.ui.magTab='storico';render()");await wait(150);
  ok(/arrivati|consegnati/.test([...w.document.querySelectorAll('#view .group-head span')].map(x=>x.textContent).join(' ')),'in Storico e ordini compaiono gli importi');
  // via i prezzi di prova
  store.settings.main={...store.settings.main,articoli:store.settings.main.articoli.map(a=>{const x={...a};delete x.prezzo;delete x.costo;return x})};notify();await wait(150);}
 // Vendite e cassa (Andrea, 17/11/2026)
 {w.__rispostaConferme=true;
  const D0=w.eval('derive()');
  // due articoli di materiale con pezzi in magazzino, uno con il prezzo di listino
  const conPezzi=Object.entries(D0.stock).filter(([k,q])=>q.ora>=3&&!D0.conNumero(k.split('|')[0])).map(([k])=>k.split('|'));
  const [art1,tg1]=conPezzi[0];const [art2,tg2]=conPezzi.find(([a])=>a!==art1);
  const arts=store.settings.main.articoli.map(x=>x.nome===art1?{...x,prezzo:12.5,costo:7}:x);
  store.settings.main={...store.settings.main,articoli:arts};notify();await wait(150);
  const [aid]=Object.entries(store.atlete).find(([,x])=>x.attiva!==false);
  const st=(a,t)=>w.eval(`(derive().stock[${JSON.stringify(a+'|'+t)}]||{ora:0}).ora`);
  const st1=st(art1,tg1),st2=st(art2,tg2);
  const dot0=JSON.stringify(w.eval(`derive().dotazione[${JSON.stringify(aid)}]||{}`));
  w.location.hash='#atleta/'+aid;w.eval('render()');await wait(100);
  w.document.querySelector(`[data-act="vendi"][data-id="${aid}"]`).click();await wait(120);
  const riga=n=>w.document.querySelectorAll('#vRighe .vRiga')[n];
  const scegli=(r,art,tg)=>{const sa=r.querySelector('.vArt');sa.value=art;sa.dispatchEvent(new w.Event('change',{bubbles:true}));r.querySelector('.vTg').value=tg};
  scegli(riga(0),art1,tg1);
  ok(riga(0).querySelector('.vPrz').value==='12,50','il prezzo proposto è quello del listino');
  {const r0=riga(0);const sa=r0.querySelector('.vArt');sa.value=art1;sa.dispatchEvent(new w.Event('change',{bubbles:true}));
   const tgProp=r0.querySelector('.vTg').value;
   ok(st(art1,tgProp)>0,`la taglia proposta ha pezzi in magazzino (${tgProp})`);
   r0.querySelector('.vTg').value=tg1;}
  ok(w.document.getElementById('dlg').classList.contains('largo'),'la finestra della vendita è più larga, per leggere il nome dell\'articolo');
  riga(0).querySelector('.vQta').value='2';
  w.document.getElementById('vAgg').click();await wait(50);
  scegli(riga(1),art2,tg2);
  ok(riga(1).querySelector('.vPrz').value==='','senza prezzo di listino la casella resta da riempire');
  // senza prezzo non si registra
  w.document.getElementById('vStato').value='daIncassare';w.document.getElementById('vStato').dispatchEvent(new w.Event('change',{bubbles:true}));
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(200);
  ok(w.document.getElementById('dlg').open&&!Object.values(store.movimenti).some(m=>m.tipo==='VENDITA'),'una riga senza prezzo non fa registrare la vendita');
  riga(1).querySelector('.vPrz').value='8';riga(1).querySelector('.vPrz').dispatchEvent(new w.Event('input',{bubbles:true}));
  ok(w.document.getElementById('vTot').textContent.replace(/\s/g,'')===w.eval('euro(33)').replace(/\s/g,''),'il totale si aggiorna mentre si scrive (2 × 12,50 + 8)');
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(500);
  const vend=Object.entries(store.movimenti).filter(([,m])=>m.tipo==='VENDITA');
  ok(vend.length===2&&vend[0][1].gruppo&&vend[0][1].gruppo===vend[1][1].gruppo,'una vendita di due articoli: due movimenti della stessa operazione');
  ok(vend.some(([,m])=>m.articolo===art1&&m.qta===2&&m.prezzo===12.5&&m.importo===25)&&vend.every(([,m])=>m.pagamento.stato==='daIncassare'),'con prezzo, importo e pagamento da incassare');
  ok(st(art1,tg1)===st1-2&&st(art2,tg2)===st2-1,'i pezzi venduti escono dal magazzino');
  ok(JSON.stringify(w.eval(`derive().dotazione[${JSON.stringify(aid)}]||{}`))===dot0,'e non entrano nella dotazione dell\'atleta');
  w.eval('render()');await wait(100);
  ok(/Acquisti/.test(w.document.getElementById('view').textContent)&&/da incassare/.test(w.document.getElementById('view').textContent),'sulla scheda compaiono gli acquisti, da incassare');
  // cassa
  const gid=vend[0][1].gruppo;
  let c=w.eval(`riepilogoCassa(S.settings.stagione)`);
  ok(c.daIncassare===33&&c.incassato===0&&c.aperte.length===1,'in Cassa la vendita è da incassare (33 €)');
  w.location.hash='';w.eval('render()');await wait(80);
  ok(/da incassare/.test(w.document.getElementById('view').textContent),'la pagina iniziale ricorda quanto c\'è da incassare');
  w.location.hash='#movimenti';w.eval("S.ui.mvTab='cassa';render()");await wait(100);
  ok(!!w.document.querySelector('.cassaTot')&&!!w.document.querySelector(`[data-act="incassa"][data-id="${gid}"]`),'la scheda Cassa mostra i totali e la vendita da incassare');
  w.document.querySelector(`[data-act="incassa"][data-id="${gid}"]`).click();await wait(100);
  w.document.getElementById('iMetodo').value='POS';
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(400);
  c=w.eval(`riepilogoCassa(S.settings.stagione)`);
  ok(c.incassato===33&&c.daIncassare===0&&c.perMetodo.POS===33&&Object.values(store.movimenti).filter(m=>m.tipo==='VENDITA').every(m=>m.pagamento.stato==='incassato'),
    'segnata incassata con il POS: tutte le righe della vendita cambiano insieme');
  // l'acquisto: un arrivo con il costo
  const arrivo=Object.keys(store.movimenti).length;
  store.movimenti.provaArrivoCassa={ts:Date.now(),data:'2026-11-17',tipo:'CARICO',articolo:art1,taglia:tg1,qta:4,stagione:store.settings.main.stagione,costoUnit:7};notify();await wait(150);
  c=w.eval(`riepilogoCassa(S.settings.stagione)`);
  ok(c.acquisti>=28&&c.saldo===Math.round((c.incassato-c.acquisti)*100)/100,'gli acquisti contano gli arrivi per il costo, e il saldo è incassato − acquisti');
  delete store.movimenti.provaArrivoCassa;notify();await wait(150);
  // storico: i venduti contano fra i consegnati
  const sto=w.eval(`storicoStagione(derive(),S.settings.stagione)[${JSON.stringify(art1+'|'+tg1)}]`);
  ok(sto&&sto.distr>=2,'in Storico e ordini i pezzi venduti contano fra i consegnati');
  // movimenti: filtro e annullamento della vendita intera
  w.eval("S.ui.mvTab='registro';S.ui.mvTipo='VENDITA';render()");await wait(100);
  ok(w.document.querySelectorAll('#view .list .item').length===2,'nel registro il filtro «Vendita» mostra le due righe');
  w.eval("S.ui.mvTipo='';render()");
  await w.eval(`annullaMovimento(${JSON.stringify(vend[0][0])})`);await wait(400);
  ok(!Object.values(store.movimenti).some(m=>m.tipo==='VENDITA')&&st(art1,tg1)===st1&&st(art2,tg2)===st2,'annullando la vendita spariscono tutte le righe e i pezzi tornano in magazzino');
  ok(!w.document.getElementById('dlg').classList.contains('largo'),'chiusa la vendita, le altre finestre tornano della misura solita');
  // eliminando chi ha ancora da pagare, il programma lo ricorda
  {store.movimenti.provaVendDaInc={ts:Date.now(),data:'2026-11-17',tipo:'VENDITA',atletaId:aid,articolo:art1,taglia:tg1,qta:1,prezzo:5,importo:5,pagamento:{stato:'daIncassare'},stagione:store.settings.main.stagione,gruppo:'gProvaDaInc'};
   notify();await wait(150);
   let dom='';w.__rispostaConferme=t=>{dom=t;return false};
   await w.eval(`cancellaDavvero(${JSON.stringify(aid)})`);await wait(100);
   ok(/da incassare/.test(dom)&&/Cassa/.test(dom)&&!!store.atlete[aid],'eliminando un atleta con vendite da incassare il programma lo ricorda (e con «no» non elimina)');
   w.__rispostaConferme=true;delete store.movimenti.provaVendDaInc;notify();await wait(150);}
  // venduti oltre la giacenza: si chiede conferma
  let domanda='';w.__rispostaConferme=t=>{domanda=t;return false};
  w.eval(`dlgVendita(${JSON.stringify(aid)})`);await wait(100);
  scegli(riga(0),art1,tg1);riga(0).querySelector('.vQta').value=String(st1+5);
  w.document.querySelector('#dlgForm button[value="ok"]').click();await wait(300);
  ok(/non ne risultano abbastanza/.test(domanda)&&!Object.values(store.movimenti).some(m=>m.tipo==='VENDITA'),'vendendo più pezzi di quelli in magazzino il programma chiede, e con «no» non registra');
  w.document.querySelector('#dlgForm button[value="cancel"]').click();await wait(100);
  w.__rispostaConferme=true;w.eval("S.ui.mvTab='registro'");
  store.settings.main={...store.settings.main,articoli:store.settings.main.articoli.map(x=>{const y={...x};delete y.prezzo;delete y.costo;return y})};notify();await wait(150);}
 // Ogni versione pubblicata ha il suo messaggio simpatico (Andrea, 04/11/2026):
 // la prova si ferma se la versione in tauri.conf.json non ce l'ha.
 {const versione=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).version;
  const nov=w.eval('NOVITA');
  ok(!!nov[versione],`la versione ${versione} ha il suo messaggio dopo l'aggiornamento (NOVITA)`);
  const storti=Object.entries(nov).filter(([v,n])=>!/^\d+\.\d+\.\d+$/.test(v)||!n.titolo||!Array.isArray(n.testo)||!n.testo.length||/\$\{/.test(JSON.stringify(n)));
  ok(storti.length===0,'ogni messaggio ha versione, titolo e testo'+(storti.length?': '+storti.map(x=>x[0]).join(', '):''));}
 ok(errs.length===0,'nessun errore JavaScript '+(errs.join('; ')));
 process.exit(fail?1:0)})();
