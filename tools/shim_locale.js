/* Sostituto locale del db di claude.ai: stessa API minima (doc/collection, onSnapshot, get/set/update/delete/add), salvata in localStorage. */
(function(){
 if(window.claude&&typeof window.claude.use==='function')return;
 var KEY='magazzino-sportivo-prova-v1';
 var SEED=__SEED__;
 var store=null;try{store=JSON.parse(localStorage.getItem(KEY))}catch(e){}
 if(!store)store=JSON.parse(JSON.stringify(SEED));
 var subs=new Set(),n=0;
 function save(){try{localStorage.setItem(KEY,JSON.stringify(store))}catch(e){}}
 function notify(){save();setTimeout(function(){subs.forEach(function(f){f()})},0)}
 function snap(id,d){return{id:id,exists:d!==undefined,data:function(){return d},metadata:{fromCache:false,hasPendingWrites:false}}}
 var db={doc:function(p){var s=p.split('/'),c=s[0],id=s[1];return{id:id,path:p,
   get:async function(){return snap(id,(store[c]||{})[id])},
   onSnapshot:function(next){var f=function(){next(snap(id,(store[c]||{})[id]))};subs.add(f);setTimeout(f,0);return function(){subs.delete(f)}},
   set:async function(o){(store[c]=store[c]||{})[id]=o;notify()},
   update:async function(o){if(!store[c]||!store[c][id])throw{code:'invalid_argument',message:'missing'};store[c][id]=Object.assign({},store[c][id],o);notify()},
   delete:async function(){if(store[c])delete store[c][id];notify()}}},
  collection:function(c){return{path:c,
   onSnapshot:function(next){var f=function(){var docs=Object.keys(store[c]||{}).map(function(id){return snap(id,store[c][id])});next({docs:docs,size:docs.length,empty:!docs.length})};subs.add(f);setTimeout(f,0);return function(){subs.delete(f)}},
   add:async function(o){var id='L'+Date.now().toString(36)+(n++);(store[c]=store[c]||{})[id]=o;notify();return db.doc(c+'/'+id)},
   doc:function(id){return db.doc(c+'/'+id)}}}};
 var downloads={save:async function(r){var b=new Blob([r.data],{type:'text/csv;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=r.filename;document.body.appendChild(a);a.click();a.remove();return{status:'saved'}}};
 window.claude={use:async function(name){return name==='db'?db:name==='downloads'?downloads:null}};
 window.__PROVA={reset:function(){localStorage.removeItem(KEY);location.reload()}};
})();
