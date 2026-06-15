/* ====================================================================
   MOCKUP DE CAMISETA — editor (página única)
   Monta o mockup de uma camiseta (frente e verso): troca modelo e cor,
   adiciona textos, imagens e formas, e exporta em PNG.
   Estrutura pronta para receber, no futuro, mais tipos de camiseta
   (basta acrescentar itens em PRODUCTS). JS puro, sem dependências.
   ==================================================================== */

'use strict';

/* ------------------------------------------------------------------ */
/* 1. MODELOS (camisetas) — extensível                                 */
/* ------------------------------------------------------------------ */

// SVGs (viewBox 0 0 600 600). `currentColor` = cor do tecido.
const SHIRTS = {
  camiseta: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M210 80 L120 120 L70 230 L140 270 L175 235 L175 540 Q175 552 187 552 L413 552 Q425 552 425 540 L425 235 L460 270 L530 230 L480 120 L390 80 Q360 150 300 150 Q240 150 210 80 Z" fill="currentColor" stroke="#0000002e" stroke-width="2"/>
    <path d="M210 80 Q240 150 300 150 Q360 150 390 80" fill="none" stroke="#0000002e" stroke-width="3"/></svg>`,
  babylook: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M218 86 L132 124 L86 224 L150 262 L188 232 L196 540 Q196 552 208 552 L392 552 Q404 552 404 540 L412 232 L450 262 L514 224 L468 124 L382 86 Q356 150 300 150 Q244 150 218 86 Z" fill="currentColor" stroke="#0000002e" stroke-width="2"/>
    <path d="M218 86 Q244 150 300 150 Q356 150 382 86" fill="none" stroke="#0000002e" stroke-width="3"/></svg>`,
  regata: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M240 90 Q235 150 195 185 Q230 205 230 250 L230 540 Q230 552 242 552 L358 552 Q370 552 370 540 L370 250 Q370 205 405 185 Q365 150 360 90 Q345 145 300 145 Q255 145 240 90 Z" fill="currentColor" stroke="#0000002e" stroke-width="2"/>
    <path d="M240 90 Q300 175 360 90" fill="none" stroke="#0000002e" stroke-width="3"/></svg>`,
  mangalonga: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M210 80 L120 120 L60 360 L135 388 L175 270 L175 540 Q175 552 187 552 L413 552 Q425 552 425 540 L425 270 L465 388 L540 360 L480 120 L390 80 Q360 150 300 150 Q240 150 210 80 Z" fill="currentColor" stroke="#0000002e" stroke-width="2"/>
    <path d="M210 80 Q240 150 300 150 Q360 150 390 80" fill="none" stroke="#0000002e" stroke-width="3"/></svg>`,
  moletom: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M205 90 L115 130 L62 350 L138 380 L175 280 L175 528 L165 555 L175 565 L425 565 L435 555 L425 528 L425 280 L462 380 L538 350 L485 130 L395 90 Q360 165 300 165 Q240 165 205 90 Z" fill="currentColor" stroke="#0000002e" stroke-width="2"/>
    <path d="M205 90 Q230 160 300 162 Q370 160 395 90" fill="none" stroke="#0000002e" stroke-width="10" stroke-linecap="round"/>
    <rect x="235" y="430" width="130" height="80" rx="8" fill="none" stroke="#0000002e" stroke-width="3"/></svg>`,
};

// Para incluir novos tipos no futuro, basta adicionar aqui.
const PRODUCTS = [
  { id:'camiseta',   name:'Básica',      icon:SHIRTS.camiseta },
  { id:'babylook',   name:'Baby Look',   icon:SHIRTS.babylook },
  { id:'regata',     name:'Regata',      icon:SHIRTS.regata },
  { id:'mangalonga', name:'Manga Longa', icon:SHIRTS.mangalonga },
  { id:'moletom',    name:'Moletom',     icon:SHIRTS.moletom },
];

const COLORS = [
  { name:'Branco', hex:'#ffffff' }, { name:'Preto', hex:'#1c1c1e' },
  { name:'Cinza', hex:'#9aa0a8' },  { name:'Marinho', hex:'#1f2d52' },
  { name:'Azul Royal', hex:'#2f54c9' }, { name:'Vermelho', hex:'#cf2f33' },
  { name:'Verde', hex:'#2f8f4e' },  { name:'Amarelo', hex:'#f2c12e' },
  { name:'Rosa', hex:'#e86a9c' },   { name:'Roxo', hex:'#7a3fb0' },
  { name:'Bege', hex:'#d9cbb2' },   { name:'Vinho', hex:'#6e1f33' },
];

const FONTS = ['Inter','Anton','Bebas Neue','Oswald','Montserrat','Caveat','Pacifico','Lobster','Permanent Marker'];
const SHAPES = ['rect','circle','triangle','line','star','heart'];

// proporções da área de estampa em relação ao mockup (frações)
const PA = { x:0.333, y:0.292, w:0.333, h:0.425 };

// As coordenadas dos elementos (x, y, w, h, size) são guardadas como FRAÇÕES
// (0..1) da área de estampa — assim funcionam em qualquer tamanho de tela
// (desktop, tablet, celular) sem desalinhar. SIZE_REF só converte a fração
// do texto para um número "em px" amigável no controle de tamanho.
const SIZE_REF = 300;
function paDims(){ return [els.printArea.offsetWidth || 1, els.printArea.offsetHeight || 1]; }

/* ------------------------------------------------------------------ */
/* 2. ESTADO                                                           */
/* ------------------------------------------------------------------ */

const state = {
  product:'camiseta', color:COLORS[0], side:'front', zoom:1,
  elements:{ front:[], back:[] }, selectedId:null, seq:1,
};
let activeTool = 'produto';
let booted = false;   // evita abrir a gaveta do painel durante o carregamento
const history = [];
let historyIndex = -1;

/* ------------------------------------------------------------------ */
/* 3. DOM + UTIL                                                       */
/* ------------------------------------------------------------------ */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const els = {};

const uid = () => 'e' + (state.seq++);
const product = id => PRODUCTS.find(p => p.id === id);
const curList = () => state.elements[state.side];
const selected = () => curList().find(e => e.id === state.selectedId) || null;

function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toHex(c){
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  if (/^#([0-9a-f]{3})$/i.test(c)) return '#'+c.slice(1).split('').map(x=>x+x).join('');
  return '#000000';
}
function toast(msg){
  els.toast.textContent = msg; els.toast.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.classList.remove('show'), 1900);
}

/* ------------------------------------------------------------------ */
/* 4. PERSISTÊNCIA (autosave)                                          */
/* ------------------------------------------------------------------ */

const SAVE_KEY = 'mockup-camiseta-v2';
function saveLocal(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify({
    product:state.product, color:state.color, elements:state.elements, seq:state.seq,
  })); }catch(e){}
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if(!d) return;
    if (product(d.product)) state.product = d.product;
    if (d.color && d.color.hex) state.color = d.color;
    if (d.elements && d.elements.front && d.elements.back) state.elements = d.elements;
    if (d.seq) state.seq = d.seq;
  }catch(e){}
}
function resetDesign(){
  try{ localStorage.removeItem(SAVE_KEY); }catch(e){}
  state.elements = { front:[], back:[] }; state.selectedId = null;
  state.product='camiseta'; state.color=COLORS[0];
  renderShirt(); renderElements(); renderPanel(); renderInspector(); snapshot();
  toast('Projeto reiniciado');
}

/* ------------------------------------------------------------------ */
/* 5. HISTÓRICO                                                        */
/* ------------------------------------------------------------------ */

function snapshot(){
  history.splice(historyIndex + 1);
  history.push(JSON.stringify(state.elements));
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedo(); saveLocal();
}
function restore(json){ state.elements = JSON.parse(json); state.selectedId = null; renderElements(); renderInspector(); }
function undo(){ if (historyIndex > 0){ historyIndex--; restore(history[historyIndex]); updateUndoRedo(); } }
function redo(){ if (historyIndex < history.length-1){ historyIndex++; restore(history[historyIndex]); updateUndoRedo(); } }
function updateUndoRedo(){ $('#undo').disabled = historyIndex<=0; $('#redo').disabled = historyIndex>=history.length-1; }

/* ------------------------------------------------------------------ */
/* 6. RENDER DA CAMISETA + ELEMENTOS                                   */
/* ------------------------------------------------------------------ */

function renderShirt(){
  els.shirtSvg.innerHTML = product(state.product).icon;
  els.shirtSvg.firstElementChild.style.color = state.color.hex;
}

function shapeInner(shape, fill){
  const f = toHex(fill);
  return ({
    rect:`<rect x="2" y="2" width="96" height="96" rx="6" fill="${f}"/>`,
    circle:`<circle cx="50" cy="50" r="48" fill="${f}"/>`,
    triangle:`<polygon points="50,4 96,96 4,96" fill="${f}"/>`,
    line:`<rect x="2" y="44" width="96" height="12" rx="6" fill="${f}"/>`,
    star:`<polygon points="50,3 61,38 98,38 68,60 79,96 50,73 21,96 32,60 2,38 39,38" fill="${f}"/>`,
    heart:`<path d="M50 88 L18 54 Q2 36 18 22 Q34 8 50 30 Q66 8 82 22 Q98 36 82 54 Z" fill="${f}"/>`,
  })[shape] || `<rect x="2" y="2" width="96" height="96" rx="6" fill="${f}"/>`;
}
function shapeSVG(shape, fill){
  const w = document.createElement('div'); w.className='shape-fill';
  w.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">${shapeInner(shape,fill)}</svg>`;
  return w;
}

function renderElements(){
  els.printArea.innerHTML = '';
  const [paW, paH] = paDims();
  curList().sort((a,b) => a.z - b.z).forEach(el => {
    const node = document.createElement('div');
    node.className = 'el is-' + (el.type==='text' ? 'text' : el.type);
    node.dataset.id = el.id;
    node.style.left = (el.x*paW)+'px'; node.style.top = (el.y*paH)+'px'; node.style.width = (el.w*paW)+'px';
    node.style.height = el.type==='text' ? 'auto' : (el.h*paH)+'px';
    node.style.transform = `translate(-50%,-50%) rotate(${el.rot}deg)`;
    node.style.zIndex = el.z;
    if (el.type==='text'){
      node.textContent = el.text || ' ';
      node.style.fontFamily = `'${el.font}', sans-serif`;
      node.style.fontSize = (el.size*paW)+'px'; node.style.color = el.color;
      node.style.fontWeight = el.bold?'800':'400'; node.style.fontStyle = el.italic?'italic':'normal';
      node.style.textAlign = el.align; node.style.textTransform = el.upper?'uppercase':'none';
    } else if (el.type==='image'){
      const img=document.createElement('img'); img.src=el.src; node.appendChild(img); node.style.opacity=el.opacity;
    } else if (el.type==='shape'){
      node.appendChild(shapeSVG(el.shape, el.fill)); node.style.opacity=el.opacity;
    }
    if (el.id===state.selectedId){
      node.classList.add('is-selected');
      node.appendChild(makeHandle('h-rotate','↻'));
      node.appendChild(makeHandle('h-resize',''));
      node.appendChild(makeHandle('h-del','×'));
    }
    bindElementEvents(node, el);
    els.printArea.appendChild(node);
  });
}
function makeHandle(cls,label){ const h=document.createElement('div'); h.className='handle '+cls; h.textContent=label; return h; }

/* ------- interação ------- */
function bindElementEvents(node, el){
  node.addEventListener('pointerdown', ev => {
    if (ev.target.classList.contains('handle')) return;
    ev.stopPropagation(); selectElement(el.id); startDrag(ev, el);
  });
  const ro=node.querySelector('.h-rotate'), re=node.querySelector('.h-resize'), de=node.querySelector('.h-del');
  if (ro) ro.addEventListener('pointerdown', ev=>{ ev.stopPropagation(); startRotate(ev,el); });
  if (re) re.addEventListener('pointerdown', ev=>{ ev.stopPropagation(); startResize(ev,el); });
  if (de) de.addEventListener('pointerdown', ev=>{ ev.stopPropagation(); deleteElement(el.id); });
}
function startDrag(ev, el){
  const sx=ev.clientX, sy=ev.clientY, ox=el.x, oy=el.y, z=state.zoom, [paW,paH]=paDims();
  const move=e=>{ el.x=ox+(e.clientX-sx)/z/paW; el.y=oy+(e.clientY-sy)/z/paH; syncNode(el); };
  const up=()=>{ detach(move,up); snapshot(); }; attach(move,up);
}
function startResize(ev, el){
  const sx=ev.clientX, sy=ev.clientY, z=state.zoom, [paW,paH]=paDims();
  if (el.type==='text'){
    const o=el.size;
    const move=e=>{ const d=((e.clientX-sx)+(e.clientY-sy))/2/z/paW; el.size=Math.max(0.03,o+d); syncNode(el); renderInspector(); };
    const up=()=>{ detach(move,up); snapshot(); }; attach(move,up);
  } else {
    const ow=el.w, ratio=el.h/el.w;
    const move=e=>{ const d=(e.clientX-sx)/z/paW; el.w=Math.max(0.05,ow+d); el.h=el.w*ratio; syncNode(el); };
    const up=()=>{ detach(move,up); snapshot(); }; attach(move,up);
  }
}
function startRotate(ev, el){
  const r=els.printArea.getBoundingClientRect();
  const cx=r.left+el.x*r.width, cy=r.top+el.y*r.height;
  const move=e=>{ el.rot=Math.round(Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI+90); syncNode(el); };
  const up=()=>{ detach(move,up); snapshot(); }; attach(move,up);
}
function syncNode(el){
  const n=els.printArea.querySelector(`[data-id="${el.id}"]`); if(!n) return;
  const [paW,paH]=paDims();
  n.style.left=(el.x*paW)+'px'; n.style.top=(el.y*paH)+'px'; n.style.width=(el.w*paW)+'px';
  if (el.type!=='text') n.style.height=(el.h*paH)+'px';
  n.style.transform=`translate(-50%,-50%) rotate(${el.rot}deg)`;
  if (el.type==='text') n.style.fontSize=(el.size*paW)+'px';
}
function attach(m,u){ window.addEventListener('pointermove',m); window.addEventListener('pointerup',u); }
function detach(m,u){ window.removeEventListener('pointermove',m); window.removeEventListener('pointerup',u); }

/* ------- CRUD ------- */
function nextZ(){ return curList().reduce((m,e)=>Math.max(m,e.z),0)+1; }

function addText(){
  // coords como frações (0..1) da área de estampa; centro = 0.5/0.5
  curList().push({ id:uid(), type:'text', text:'SEU TEXTO', x:0.5, y:0.5, w:0.9, h:0.2, rot:0, z:nextZ(),
    font:'Anton', size:0.22, color:'#1c1c1e', bold:false, italic:false, align:'center', upper:true });
  finishAdd();
}
function addImageFromSrc(src){
  const img=new Image();
  img.onload=()=>{
    const [paW,paH]=paDims();
    const wFrac=0.6, pxw=wFrac*paW, pxh=pxw*((img.height||120)/(img.width||150)), hFrac=pxh/paH;
    curList().push({ id:uid(), type:'image', src, x:0.5, y:0.5, w:wFrac, h:hFrac, rot:0, z:nextZ(), opacity:1 });
    finishAdd();
  };
  img.src=src;
}
function addShape(shape){
  const [paW,paH]=paDims();
  const wFrac=0.5, pxw=wFrac*paW, pxh=(shape==='line'?pxw*0.25:pxw), hFrac=pxh/paH;
  curList().push({ id:uid(), type:'shape', shape, x:0.5, y:0.5, w:wFrac, h:hFrac, rot:0, z:nextZ(), fill:'#ff4d2d', opacity:1 });
  finishAdd();
}
function finishAdd(){
  const el=curList()[curList().length-1]; state.selectedId=el.id;
  els.panel.classList.remove('open');           // no mobile, volta pro palco
  renderElements(); renderInspector(); openInspectorMobile(); snapshot();
}
function deleteElement(id){
  const l=curList(), i=l.findIndex(e=>e.id===id); if(i>=0) l.splice(i,1);
  if (state.selectedId===id) state.selectedId=null;
  renderElements(); renderInspector(); snapshot();
}
function duplicateElement(){
  const el=selected(); if(!el) return;
  const c=JSON.parse(JSON.stringify(el)); c.id=uid(); c.x+=16; c.y+=16; c.z=nextZ();
  curList().push(c); state.selectedId=c.id; renderElements(); renderInspector(); snapshot();
}
function selectElement(id){ state.selectedId=id; renderElements(); renderInspector(); openInspectorMobile(); }
function deselect(){ if(!state.selectedId) return; state.selectedId=null; renderElements(); renderInspector(); }
function bringForward(){ const el=selected(); if(el){ el.z=nextZ(); renderElements(); snapshot(); } }
function sendBackward(){ const el=selected(); if(!el) return; el.z=curList().reduce((m,e)=>Math.min(m,e.z),Infinity)-1; renderElements(); snapshot(); }

/* ------------------------------------------------------------------ */
/* 7. PAINEL CONTEXTUAL                                                */
/* ------------------------------------------------------------------ */

function renderPanel(){
  let h='';
  if (activeTool==='produto'){
    h += `<h3>Modelo da camiseta</h3><div class="product-grid">`;
    PRODUCTS.forEach(p => h += `<button class="product-card ${p.id===state.product?'is-active':''}" data-product="${p.id}">${p.icon}<span>${p.name}</span></button>`);
    h += `</div><p class="hint">Em breve dá pra cadastrar mais tipos de camiseta aqui.</p>`;
  } else if (activeTool==='cor'){
    h += `<h3>Cor do tecido</h3><div class="swatch-grid">`;
    COLORS.forEach((c,i) => h += `<button class="swatch ${c.hex===state.color.hex?'is-active':''}" data-color="${i}" title="${c.name}" style="background:${c.hex}"></button>`);
    h += `</div><div class="color-name">${state.color.name}</div>
      <label class="color-custom">Cor personalizada <input type="color" id="custom-color" value="${toHex(state.color.hex)}"></label>
      <p class="hint">A cor vale para frente e verso.</p>`;
  } else if (activeTool==='texto'){
    h += `<h3>Texto</h3><button class="big-btn" id="add-text"><span class="ico">🅣</span> Adicionar texto</button>
      <p class="hint">Insere um texto na <b>${state.side==='front'?'frente':'verso'}</b>. Selecione no palco para editar fonte, cor e tamanho.</p>`;
  } else if (activeTool==='imagem'){
    h += `<h3>Imagem / Logo</h3><button class="big-btn" id="add-image"><span class="ico">⬆️</span> Enviar imagem (PNG/JPG)</button>
      <p class="hint">Upload da sua arte. Recomendado PNG transparente em alta resolução.</p>
      <div class="group" style="margin-top:18px"><h3>Cliparts</h3><div class="shape-grid">`;
    ['⭐','🔥','💀','⚡','🌵','🎧','🚀','❤️'].forEach(em => h += `<button class="shape-btn clip" data-clip="${em}" style="font-size:24px">${em}</button>`);
    h += `</div></div>`;
  } else if (activeTool==='formas'){
    h += `<h3>Formas</h3><div class="shape-grid">`;
    SHAPES.forEach(s => h += `<button class="shape-btn" data-shape="${s}">${shapeIcon(s)}</button>`);
    h += `</div><p class="hint">Selecione no palco para mudar a cor.</p>`;
  }
  els.panel.innerHTML = `<button class="panel-close" id="panel-close">✕ fechar</button>` + h;
  bindPanelEvents();
}
function shapeIcon(s){
  const m={ rect:'<rect x="6" y="6" width="18" height="18" rx="3" fill="currentColor"/>', circle:'<circle cx="15" cy="15" r="11" fill="currentColor"/>',
    triangle:'<polygon points="15,4 26,26 4,26" fill="currentColor"/>', line:'<rect x="3" y="13" width="24" height="5" rx="2" fill="currentColor"/>',
    star:'<polygon points="15,3 18,12 27,12 20,18 22,27 15,22 8,27 10,18 3,12 12,12" fill="currentColor"/>',
    heart:'<path d="M15 26 L5 16 Q-1 9 6 5 Q11 2 15 9 Q19 2 24 5 Q31 9 25 16 Z" fill="currentColor"/>' };
  return `<svg viewBox="0 0 30 30">${m[s]||m.rect}</svg>`;
}
function bindPanelEvents(){
  const pc=$('#panel-close'); if (pc) pc.onclick=()=>els.panel.classList.remove('open');
  $$('.product-card', els.panel).forEach(b => b.onclick=()=>{ state.product=b.dataset.product; renderShirt(); renderPanel(); saveLocal(); });
  $$('[data-color]', els.panel).forEach(b => b.onclick=()=>{ state.color=COLORS[+b.dataset.color]; renderShirt(); renderPanel(); saveLocal(); });
  const cu=$('#custom-color'); if (cu) cu.oninput=e=>{ state.color={name:'Personalizada', hex:e.target.value}; renderShirt(); saveLocal(); $('.color-name').textContent='Personalizada'; };
  $$('[data-shape]', els.panel).forEach(b => b.onclick=()=>addShape(b.dataset.shape));
  $$('.clip', els.panel).forEach(b => b.onclick=()=>addEmoji(b.dataset.clip));
  const at=$('#add-text'); if (at) at.onclick=addText;
  const ai=$('#add-image'); if (ai) ai.onclick=()=>els.fileInput.click();
}
function addEmoji(emoji){
  const cv=document.createElement('canvas'); cv.width=cv.height=200;
  const ctx=cv.getContext('2d'); ctx.font='160px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emoji,100,110);
  addImageFromSrc(cv.toDataURL());
}

/* ------------------------------------------------------------------ */
/* 8. INSPECTOR                                                        */
/* ------------------------------------------------------------------ */

function renderInspector(){
  const el=selected();
  if (!el){ els.inspector.dataset.mode='empty';
    els.inspector.innerHTML = `<div class="inspector-empty"><span class="big">🎯</span>
      Selecione um elemento no palco para editar.<br><br>Use o painel à esquerda para adicionar texto, imagem ou formas.</div>`;
    return;
  }
  els.inspector.dataset.mode='props';
  let h = `<h3>Editar ${el.type==='text'?'texto':el.type==='image'?'imagem':'forma'} <button class="chip" id="insp-close" style="flex:0;padding:4px 10px;float:right">Fechar</button></h3>`;
  if (el.type==='text'){
    h += `<div class="field"><label>Texto</label><textarea id="p-text">${escapeHtml(el.text)}</textarea></div>`;
    h += `<div class="field"><label>Fonte</label><select id="p-font">`;
    FONTS.forEach(f => h += `<option value="${f}" ${f===el.font?'selected':''} style="font-family:'${f}'">${f}</option>`);
    h += `</select></div>`;
    h += `<div class="field"><label>Tamanho</label><div class="range-row"><input type="range" id="p-size" min="8" max="200" value="${Math.round(el.size*SIZE_REF)}"><output>${Math.round(el.size*SIZE_REF)}</output></div></div>`;
    h += `<div class="field"><label>Estilo</label><div class="btn-row"><button class="chip ${el.bold?'is-active':''}" id="p-bold"><b>B</b></button><button class="chip ${el.italic?'is-active':''}" id="p-italic"><i>I</i></button><button class="chip ${el.upper?'is-active':''}" id="p-upper">AA</button></div></div>`;
    h += `<div class="field"><label>Alinhamento</label><div class="btn-row"><button class="chip ${el.align==='left'?'is-active':''}" data-align="left">⬅</button><button class="chip ${el.align==='center'?'is-active':''}" data-align="center">⬛</button><button class="chip ${el.align==='right'?'is-active':''}" data-align="right">➡</button></div></div>`;
    h += colorField('p-color', el.color);
  } else if (el.type==='image'){
    h += `<div class="field"><label>Opacidade</label><div class="range-row"><input type="range" id="p-opacity" min="10" max="100" value="${Math.round(el.opacity*100)}"><output>${Math.round(el.opacity*100)}%</output></div></div><p class="hint">Use as alças no palco para girar e redimensionar.</p>`;
  } else if (el.type==='shape'){
    h += colorField('p-fill', el.fill);
    h += `<div class="field"><label>Opacidade</label><div class="range-row"><input type="range" id="p-opacity" min="10" max="100" value="${Math.round(el.opacity*100)}"><output>${Math.round(el.opacity*100)}%</output></div></div>`;
  }
  h += `<div class="field"><label>Camada</label><div class="btn-row"><button class="chip" id="p-front">Trazer ↑</button><button class="chip" id="p-back">Enviar ↓</button><button class="chip" id="p-dup">Duplicar</button></div></div>`;
  h += `<button class="btn-del" id="p-del">Excluir elemento</button>`;
  els.inspector.innerHTML = h;
  bindPropsEvents(el);
}
function colorField(id, val){
  const palette=['#1c1c1e','#ffffff','#ff4d2d','#2f6df6','#2f8f4e','#f2c12e','#e86a9c','#7a3fb0','#d9cbb2','#000000'];
  let h=`<div class="field"><label>Cor</label><div class="color-row">`;
  palette.forEach(c => h += `<button class="color-dot ${c===val?'is-active':''}" data-pick="${id}" data-color="${c}" style="background:${c}"></button>`);
  h += `<input type="color" id="${id}" value="${toHex(val)}" style="width:34px;height:26px;border:none;background:none;padding:0"></div></div>`;
  return h;
}
function node(el){ return els.printArea.querySelector(`[data-id="${el.id}"]`); }
function bindPropsEvents(el){
  const close=$('#insp-close'); if (close) close.onclick=()=>{ closeInspectorMobile(); deselect(); };
  const txt=$('#p-text'); if (txt){ txt.oninput=e=>{ el.text=e.target.value; renderElements(); }; txt.onchange=snapshot; }
  const fnt=$('#p-font'); if (fnt) fnt.onchange=e=>{ el.font=e.target.value; node(el).style.fontFamily=`'${el.font}',sans-serif`; snapshot(); };
  const sz=$('#p-size'); if (sz){ sz.oninput=e=>{ el.size=(+e.target.value)/SIZE_REF; sz.nextElementSibling.value=e.target.value; syncNode(el); }; sz.onchange=snapshot; }
  const op=$('#p-opacity'); if (op){ op.oninput=e=>{ el.opacity=+e.target.value/100; op.nextElementSibling.value=e.target.value+'%'; node(el).style.opacity=el.opacity; }; op.onchange=snapshot; }
  const bold=$('#p-bold'); if (bold) bold.onclick=()=>{ el.bold=!el.bold; renderElements(); renderInspector(); snapshot(); };
  const ital=$('#p-italic'); if (ital) ital.onclick=()=>{ el.italic=!el.italic; renderElements(); renderInspector(); snapshot(); };
  const upp=$('#p-upper'); if (upp) upp.onclick=()=>{ el.upper=!el.upper; renderElements(); renderInspector(); snapshot(); };
  $$('[data-align]').forEach(b => b.onclick=()=>{ el.align=b.dataset.align; renderElements(); renderInspector(); snapshot(); });
  $$('[data-pick]').forEach(b => b.onclick=()=>{ const col=b.dataset.color; if(b.dataset.pick==='p-color') el.color=col; else el.fill=col; renderElements(); renderInspector(); snapshot(); });
  const cc=$('#p-color'); if (cc){ cc.oninput=e=>{ el.color=e.target.value; renderElements(); }; cc.onchange=()=>{ renderInspector(); snapshot(); }; }
  const cf=$('#p-fill'); if (cf){ cf.oninput=e=>{ el.fill=e.target.value; renderElements(); }; cf.onchange=()=>{ renderInspector(); snapshot(); }; }
  $('#p-front').onclick=bringForward; $('#p-back').onclick=sendBackward; $('#p-dup').onclick=duplicateElement; $('#p-del').onclick=()=>deleteElement(el.id);
}
function openInspectorMobile(){ if (window.matchMedia('(max-width:1100px)').matches) els.inspector.classList.add('open'); }
function closeInspectorMobile(){ els.inspector.classList.remove('open'); }

/* ------------------------------------------------------------------ */
/* 9. FERRAMENTAS / LADO / ZOOM                                        */
/* ------------------------------------------------------------------ */

function setTool(tool){
  activeTool=tool;
  $$('.rail-btn', els.rail).forEach(b => b.classList.toggle('is-active', b.dataset.tool===tool));
  renderPanel();
  // só abre a gaveta quando o usuário escolhe a ferramenta (não no load)
  if (booted && window.matchMedia('(max-width:760px)').matches) els.panel.classList.add('open');
}
function setSide(side){
  state.side=side; state.selectedId=null;
  $$('.side-btn').forEach(b => b.classList.toggle('is-active', b.dataset.side===side));
  els.mockup.classList.remove('flip'); void els.mockup.offsetWidth; els.mockup.classList.add('flip');
  renderElements(); renderInspector(); renderPanel();
}
function setZoom(z){
  state.zoom=Math.min(2,Math.max(0.5,+z.toFixed(2)));
  els.mockup.style.setProperty('--z', state.zoom);
  els.mockup.style.transform=`scale(${state.zoom})`;
  els.zoomLabel.textContent=Math.round(state.zoom*100)+'%';
}

/* ------------------------------------------------------------------ */
/* 10. EXPORTAR PNG                                                    */
/* ------------------------------------------------------------------ */

function loadImg(src){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; }); }
function svgToImg(svg){ return loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)); }

async function exportPNG(){
  try{
    const SIZE=1200;
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=SIZE;
    const ctx=canvas.getContext('2d');

    // camiseta com a cor embutida
    const shirt = product(state.product).icon
      .replace('<svg ', '<svg width="600" height="600" ')
      .replace(/currentColor/g, state.color.hex);
    ctx.drawImage(await svgToImg(shirt), 0, 0, SIZE, SIZE);

    // área de estampa em px no canvas (coords dos elementos são frações 0..1)
    const paX=PA.x*SIZE, paY=PA.y*SIZE, paW=PA.w*SIZE, paH=PA.h*SIZE;

    if (document.fonts && document.fonts.ready) { try{ await document.fonts.ready; }catch(e){} }

    for (const el of [...curList()].sort((a,b)=>a.z-b.z)){
      const cx=paX+el.x*paW, cy=paY+el.y*paH;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(el.rot*Math.PI/180);
      if (el.type==='text'){
        ctx.globalAlpha=1;
        ctx.font=`${el.italic?'italic ':''}${el.bold?'800':'400'} ${el.size*paW}px '${el.font}', sans-serif`;
        ctx.fillStyle=el.color; ctx.textAlign=el.align==='left'?'left':el.align==='right'?'right':'center'; ctx.textBaseline='middle';
        ctx.fillText(el.upper?(el.text||'').toUpperCase():(el.text||''), 0, 0);
      } else if (el.type==='image'){
        ctx.globalAlpha=el.opacity; const w=el.w*paW, hh=el.h*paH;
        ctx.drawImage(await loadImg(el.src), -w/2, -hh/2, w, hh);
      } else if (el.type==='shape'){
        ctx.globalAlpha=el.opacity; const w=el.w*paW, hh=el.h*paH;
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${w}" height="${hh}" preserveAspectRatio="none">${shapeInner(el.shape,el.fill)}</svg>`;
        ctx.drawImage(await svgToImg(svg), -w/2, -hh/2, w, hh);
      }
      ctx.restore();
    }

    const a=document.createElement('a');
    a.download=`mockup-${state.product}-${state.side==='front'?'frente':'verso'}.png`;
    a.href=canvas.toDataURL('image/png'); a.click();
    toast('PNG exportado!');
  }catch(e){ toast('Não foi possível exportar'); console.error(e); }
}

/* ------------------------------------------------------------------ */
/* 11. INIT                                                            */
/* ------------------------------------------------------------------ */

function init(){
  Object.assign(els, {
    panel:$('#panel'), inspector:$('#inspector'), shirtSvg:$('#shirt-svg'), printArea:$('#print-area'),
    mockup:$('#mockup'), zoomLabel:$('#zoom-label'), fileInput:$('#file-input'), toast:$('#toast'), rail:$('#rail'),
  });
  loadLocal();
  renderShirt(); setTool('produto'); renderElements(); renderInspector(); setZoom(1);

  $$('.rail-btn', els.rail).forEach(b => b.onclick=()=>setTool(b.dataset.tool));
  $$('.side-btn').forEach(b => b.onclick=()=>setSide(b.dataset.side));
  $('#undo').onclick=undo; $('#redo').onclick=redo;
  $('#zoom-in').onclick=()=>setZoom(state.zoom+0.1); $('#zoom-out').onclick=()=>setZoom(state.zoom-0.1);
  $('#toggle-guide').onclick=()=>els.printArea.classList.toggle('hide-guide');
  $('#clear-side').onclick=()=>{ if(curList().length && confirm('Remover todos os elementos deste lado?')){ state.elements[state.side]=[]; state.selectedId=null; renderElements(); renderInspector(); snapshot(); } };
  $('#reset-design').onclick=()=>{ if(confirm('Reiniciar o projeto do zero? Isto apaga a arte salva.')) resetDesign(); };
  $('#export-png').onclick=exportPNG;
  $('#mobile-props-btn').onclick=()=>{ renderInspector(); els.inspector.classList.add('open'); };

  els.printArea.addEventListener('pointerdown', e => { if (e.target===els.printArea) deselect(); });

  // reposiciona a arte quando a tela muda de tamanho (girar celular, etc.)
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT=setTimeout(renderElements, 120); });
  els.fileInput.onchange=e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>addImageFromSrc(ev.target.result); r.readAsDataURL(f); els.fileInput.value=''; };

  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if ((e.key==='Delete'||e.key==='Backspace') && state.selectedId){ e.preventDefault(); deleteElement(state.selectedId); }
    if (e.key==='Escape') deselect();
    if ((e.ctrlKey||e.metaKey) && e.key==='z'){ e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))){ e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey) && e.key==='d' && state.selectedId){ e.preventDefault(); duplicateElement(); }
  });

  snapshot();
  booted = true;
}
document.addEventListener('DOMContentLoaded', init);
