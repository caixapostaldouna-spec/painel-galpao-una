/* ====================================================================
   ESTÚDIO DE PERSONALIZAÇÃO — protótipo
   Editor de camisetas inspirado no fluxo da Camisa Dimona:
   produto -> cor/malha -> arte (texto/imagem/formas) -> estampa -> resumo.
   Tudo em JS puro, sem dependências.
   ==================================================================== */

'use strict';

/* ------------------------------------------------------------------ */
/* 1. CATÁLOGO                                                          */
/* ------------------------------------------------------------------ */

// SVGs das camisetas (viewBox 0 0 600 600). `currentColor` = cor do tecido.
const SHIRTS = {
  camiseta: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M210 80 L120 120 L70 230 L140 270 L175 235 L175 540
             Q175 552 187 552 L413 552 Q425 552 425 540 L425 235
             L460 270 L530 230 L480 120 L390 80
             Q360 150 300 150 Q240 150 210 80 Z"
          fill="currentColor" stroke="#00000022" stroke-width="2"/>
    <path d="M210 80 Q240 150 300 150 Q360 150 390 80"
          fill="none" stroke="#00000022" stroke-width="3"/>
  </svg>`,

  regata: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M240 90 Q235 150 195 185 Q230 205 230 250 L230 540
             Q230 552 242 552 L358 552 Q370 552 370 540 L370 250
             Q370 205 405 185 Q365 150 360 90
             Q345 145 300 145 Q255 145 240 90 Z"
          fill="currentColor" stroke="#00000022" stroke-width="2"/>
    <path d="M240 90 Q300 175 360 90" fill="none" stroke="#00000022" stroke-width="3"/>
  </svg>`,

  mangalonga: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M210 80 L120 120 L60 360 L135 388 L175 270 L175 540
             Q175 552 187 552 L413 552 Q425 552 425 540 L425 270
             L465 388 L540 360 L480 120 L390 80
             Q360 150 300 150 Q240 150 210 80 Z"
          fill="currentColor" stroke="#00000022" stroke-width="2"/>
    <path d="M210 80 Q240 150 300 150 Q360 150 390 80"
          fill="none" stroke="#00000022" stroke-width="3"/>
  </svg>`,

  moletom: `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
    <path d="M205 90 L115 130 L62 350 L138 380 L175 280 L175 528
             L165 555 L175 565 L425 565 L435 555 L425 528 L425 280
             L462 380 L538 350 L485 130 L395 90
             Q360 165 300 165 Q240 165 205 90 Z"
          fill="currentColor" stroke="#00000022" stroke-width="2"/>
    <path d="M205 90 Q230 160 300 162 Q370 160 395 90" fill="none"
          stroke="#00000022" stroke-width="10" stroke-linecap="round"/>
    <rect x="235" y="430" width="130" height="80" rx="8"
          fill="none" stroke="#00000022" stroke-width="3"/>
  </svg>`,
};

const PRODUCTS = [
  { id:'camiseta',   name:'Camiseta',    base:39.90, icon:SHIRTS.camiseta },
  { id:'regata',     name:'Regata',      base:34.90, icon:SHIRTS.regata },
  { id:'mangalonga', name:'Manga Longa', base:54.90, icon:SHIRTS.mangalonga },
  { id:'moletom',    name:'Moletom',     base:99.90, icon:SHIRTS.moletom },
];

const FABRICS = [
  { id:'algodao',  name:'Algodão Fio 30.1', desc:'leve e macia',    add:0 },
  { id:'premium',  name:'Premium Penteada', desc:'toque premium',   add:9.00 },
  { id:'dryfit',   name:'Dry Fit',          desc:'esportiva',       add:12.00 },
  { id:'organica', name:'Algodão Orgânico', desc:'sustentável',     add:15.00 },
];

const COLORS = [
  { name:'Branco',     hex:'#ffffff' },
  { name:'Preto',      hex:'#1c1c1e' },
  { name:'Cinza',      hex:'#9aa0a8' },
  { name:'Marinho',    hex:'#1f2d52' },
  { name:'Azul Royal', hex:'#2f54c9' },
  { name:'Vermelho',   hex:'#cf2f33' },
  { name:'Verde',      hex:'#2f8f4e' },
  { name:'Amarelo',    hex:'#f2c12e' },
  { name:'Rosa',       hex:'#e86a9c' },
  { name:'Roxo',       hex:'#7a3fb0' },
  { name:'Bege',       hex:'#d9cbb2' },
  { name:'Vinho',      hex:'#6e1f33' },
];

const SIZES = ['PP','P','M','G','GG','XG'];

const TECHNIQUES = [
  { id:'silk',       name:'Silk Screen',  desc:'ideal p/ grandes lotes',   add:0 },
  { id:'silkdig',    name:'Silk Digital', desc:'cores ilimitadas',         add:8.00 },
  { id:'dtf',        name:'Transfer DTF', desc:'detalhes e fotos',         add:12.00 },
  { id:'bordado',    name:'Bordado',      desc:'acabamento premium',       add:25.00 },
  { id:'sublimacao', name:'Sublimação',   desc:'estampa total',            add:18.00 },
];

const FONTS = [
  'Inter','Anton','Bebas Neue','Oswald','Montserrat',
  'Caveat','Pacifico','Lobster','Permanent Marker',
];

const SHAPES = ['rect','circle','triangle','line','star','heart'];

/* ------------------------------------------------------------------ */
/* 2. ESTADO                                                           */
/* ------------------------------------------------------------------ */

const state = {
  product:  'camiseta',
  fabric:   'algodao',
  color:    COLORS[0],
  size:     'M',
  technique:'silk',
  side:     'front',
  zoom:     1,
  elements: { front:[], back:[] },   // elementos por lado
  selectedId: null,
  seq: 1,
};

const history = [];
let historyIndex = -1;

/* ------------------------------------------------------------------ */
/* 3. ATALHOS DE DOM                                                   */
/* ------------------------------------------------------------------ */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const els = {
  rail:      $('#rail'),
  panel:     $('#panel'),
  inspector: $('#inspector'),
  shirtSvg:  $('#shirt-svg'),
  printArea: $('#print-area'),
  mockup:    $('#mockup'),
  priceTotal:$('#price-total'),
  zoomLabel: $('#zoom-label'),
  fileInput: $('#file-input'),
  toast:     $('#toast'),
  steps:     $('#steps'),
};

let activeTool = 'produto';

/* ------------------------------------------------------------------ */
/* 4. UTIL                                                             */
/* ------------------------------------------------------------------ */

const money = v => 'R$ ' + v.toFixed(2).replace('.', ',');
const uid   = () => 'e' + (state.seq++);

function toast(msg){
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function curList(){ return state.elements[state.side]; }
function selected(){ return curList().find(e => e.id === state.selectedId) || null; }

/* ------------------------------------------------------------------ */
/* 5. HISTÓRICO (undo/redo)                                            */
/* ------------------------------------------------------------------ */

function snapshot(){
  // corta o "futuro" se estávamos no meio do histórico
  history.splice(historyIndex + 1);
  history.push(JSON.stringify(state.elements));
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedo();
}
function restore(json){
  state.elements = JSON.parse(json);
  state.selectedId = null;
  renderElements();
  renderInspector();
  updatePrice();
}
function undo(){ if (historyIndex > 0){ historyIndex--; restore(history[historyIndex]); updateUndoRedo(); } }
function redo(){ if (historyIndex < history.length-1){ historyIndex++; restore(history[historyIndex]); updateUndoRedo(); } }
function updateUndoRedo(){
  $('#undo').disabled = historyIndex <= 0;
  $('#redo').disabled = historyIndex >= history.length-1;
}

/* ------------------------------------------------------------------ */
/* 6. PREÇO                                                            */
/* ------------------------------------------------------------------ */

function computePrice(){
  const p = PRODUCTS.find(x => x.id === state.product);
  const f = FABRICS.find(x => x.id === state.fabric);
  const t = TECHNIQUES.find(x => x.id === state.technique);
  const elCount = state.elements.front.length + state.elements.back.length;
  const artFee  = elCount > 0 ? 6.00 : 0;           // taxa de personalização
  const backFee = state.elements.back.length > 0 ? 8.00 : 0; // estampa nas costas
  return {
    base:p.base, fabric:f.add, tech:t.add, art:artFee, back:backFee,
    total: p.base + f.add + t.add + artFee + backFee,
  };
}
function updatePrice(){
  els.priceTotal.textContent = money(computePrice().total);
  if (activeTool === 'estampa' || els.inspector.dataset.mode === 'summary') renderInspector();
}

/* ------------------------------------------------------------------ */
/* 7. RENDER DA CAMISETA                                               */
/* ------------------------------------------------------------------ */

function renderShirt(){
  const p = PRODUCTS.find(x => x.id === state.product);
  els.shirtSvg.innerHTML = p.icon;
  els.shirtSvg.firstElementChild.style.color = state.color.hex;
}

/* ------------------------------------------------------------------ */
/* 8. RENDER DOS ELEMENTOS NO PALCO                                    */
/* ------------------------------------------------------------------ */

function renderElements(){
  els.printArea.innerHTML = '';
  curList().sort((a,b) => a.z - b.z).forEach(el => {
    const node = document.createElement('div');
    node.className = 'el is-' + (el.type === 'text' ? 'text' : el.type);
    node.dataset.id = el.id;
    node.style.left = el.x + 'px';
    node.style.top  = el.y + 'px';
    node.style.width  = el.w + 'px';
    node.style.height = el.type === 'text' ? 'auto' : el.h + 'px';
    node.style.transform = `translate(-50%,-50%) rotate(${el.rot}deg)`;
    node.style.zIndex = el.z;

    if (el.type === 'text'){
      node.textContent = el.text || ' ';
      node.style.fontFamily = `'${el.font}', sans-serif`;
      node.style.fontSize = el.size + 'px';
      node.style.color = el.color;
      node.style.fontWeight = el.bold ? '800' : '400';
      node.style.fontStyle = el.italic ? 'italic' : 'normal';
      node.style.textAlign = el.align;
      node.style.textTransform = el.upper ? 'uppercase' : 'none';
    } else if (el.type === 'image'){
      const img = document.createElement('img');
      img.src = el.src; node.appendChild(img);
      node.style.opacity = el.opacity;
    } else if (el.type === 'shape'){
      node.appendChild(shapeSVG(el.shape, el.fill));
      node.style.opacity = el.opacity;
    }

    if (el.id === state.selectedId){
      node.classList.add('is-selected');
      node.appendChild(makeHandle('h-rotate','↻'));
      node.appendChild(makeHandle('h-resize',''));
      node.appendChild(makeHandle('h-del','×'));
    }

    bindElementEvents(node, el);
    els.printArea.appendChild(node);
  });
}

function makeHandle(cls, label){
  const h = document.createElement('div');
  h.className = 'handle ' + cls;
  h.textContent = label;
  return h;
}

function shapeSVG(shape, fill){
  const w = document.createElement('div');
  w.className = 'shape-fill';
  const svgs = {
    rect:     `<rect x="2" y="2" width="96" height="96" rx="6" fill="${fill}"/>`,
    circle:   `<circle cx="50" cy="50" r="48" fill="${fill}"/>`,
    triangle: `<polygon points="50,4 96,96 4,96" fill="${fill}"/>`,
    line:     `<rect x="2" y="44" width="96" height="12" rx="6" fill="${fill}"/>`,
    star:     `<polygon points="50,3 61,38 98,38 68,60 79,96 50,73 21,96 32,60 2,38 39,38" fill="${fill}"/>`,
    heart:    `<path d="M50 88 L18 54 Q2 36 18 22 Q34 8 50 30 Q66 8 82 22 Q98 36 82 54 Z" fill="${fill}"/>`,
  };
  w.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">${svgs[shape]||svgs.rect}</svg>`;
  return w;
}

/* ------------------------------------------------------------------ */
/* 9. INTERAÇÃO: arrastar / redimensionar / rotacionar / deletar       */
/* ------------------------------------------------------------------ */

function bindElementEvents(node, el){
  // selecionar + arrastar corpo
  node.addEventListener('pointerdown', ev => {
    if (ev.target.classList.contains('handle')) return;
    ev.stopPropagation();
    selectElement(el.id);
    startDrag(ev, el);
  });

  const rotate = node.querySelector('.h-rotate');
  const resize = node.querySelector('.h-resize');
  const del    = node.querySelector('.h-del');
  if (rotate) rotate.addEventListener('pointerdown', ev => { ev.stopPropagation(); startRotate(ev, el); });
  if (resize) resize.addEventListener('pointerdown', ev => { ev.stopPropagation(); startResize(ev, el, node); });
  if (del)    del.addEventListener('pointerdown', ev => { ev.stopPropagation(); deleteElement(el.id); });
}

function startDrag(ev, el){
  const startX = ev.clientX, startY = ev.clientY;
  const ox = el.x, oy = el.y;
  const z = state.zoom;
  const move = e => {
    el.x = ox + (e.clientX - startX) / z;
    el.y = oy + (e.clientY - startY) / z;
    syncNode(el);
  };
  const up = () => { detach(move, up); snapshot(); };
  attach(move, up);
}

function startResize(ev, el, node){
  const startX = ev.clientX, startY = ev.clientY;
  const z = state.zoom;
  if (el.type === 'text'){
    const oSize = el.size;
    const move = e => {
      const d = ((e.clientX - startX) + (e.clientY - startY)) / 2 / z;
      el.size = Math.max(8, Math.round(oSize + d));
      syncNode(el); renderInspector();
    };
    const up = () => { detach(move, up); snapshot(); };
    attach(move, up);
  } else {
    const ow = el.w, oh = el.h, ratio = oh/ow;
    const move = e => {
      const d = (e.clientX - startX) / z;
      el.w = Math.max(20, Math.round(ow + d));
      el.h = Math.max(20, Math.round(el.w * ratio));
      syncNode(el);
    };
    const up = () => { detach(move, up); snapshot(); };
    attach(move, up);
  }
}

function startRotate(ev, el){
  const rect = els.printArea.getBoundingClientRect();
  const z = state.zoom;
  const cx = rect.left + (el.x * z);
  const cy = rect.top  + (el.y * z);
  const move = e => {
    const ang = Math.atan2(e.clientY - cy, e.clientX - cx) * 180/Math.PI + 90;
    el.rot = Math.round(ang);
    syncNode(el);
  };
  const up = () => { detach(move, up); snapshot(); };
  attach(move, up);
}

// atualiza só o nó (sem re-render completo, mais fluido no drag)
function syncNode(el){
  const node = els.printArea.querySelector(`[data-id="${el.id}"]`);
  if (!node) return;
  node.style.left = el.x + 'px';
  node.style.top  = el.y + 'px';
  node.style.width = el.w + 'px';
  if (el.type !== 'text') node.style.height = el.h + 'px';
  node.style.transform = `translate(-50%,-50%) rotate(${el.rot}deg)`;
  if (el.type === 'text') node.style.fontSize = el.size + 'px';
}

function attach(move, up){
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function detach(move, up){
  window.removeEventListener('pointermove', move);
  window.removeEventListener('pointerup', up);
}

/* ------------------------------------------------------------------ */
/* 10. CRUD de elementos                                               */
/* ------------------------------------------------------------------ */

function nextZ(){ return (curList().reduce((m,e)=>Math.max(m,e.z),0)) + 1; }
const PA_W = 200, PA_H = 255; // referência da print-area (px no DOM); centro = metade

function center(){
  // offsetWidth/Height = dimensões de layout (ignora o transform de zoom),
  // que é o mesmo sistema de coordenadas usado em el.x / el.y.
  return { x: els.printArea.offsetWidth/2, y: els.printArea.offsetHeight/2 };
}

function addText(){
  const c = center();
  curList().push({
    id:uid(), type:'text', text:'SEU TEXTO',
    x:c.x, y:c.y, w:160, h:40, rot:0, z:nextZ(),
    font:'Anton', size:34, color:'#1c1c1e',
    bold:false, italic:false, align:'center', upper:true,
  });
  finishAdd();
}

function addImageFromSrc(src){
  const img = new Image();
  img.onload = () => {
    const c = center();
    const maxW = 150;
    const ratio = img.height / img.width;
    const w = Math.min(maxW, img.width);
    curList().push({
      id:uid(), type:'image', src,
      x:c.x, y:c.y, w, h:Math.round(w*ratio), rot:0, z:nextZ(), opacity:1,
    });
    finishAdd();
  };
  img.src = src;
}

function addShape(shape){
  const c = center();
  curList().push({
    id:uid(), type:'shape', shape,
    x:c.x, y:c.y, w:90, h: shape==='line'?40:90, rot:0, z:nextZ(),
    fill:'#2f6df6', opacity:1,
  });
  finishAdd();
}

function finishAdd(){
  const el = curList()[curList().length-1];
  state.selectedId = el.id;
  renderElements(); renderInspector(); updatePrice(); snapshot();
  setStep('arte');
}

function deleteElement(id){
  const list = curList();
  const i = list.findIndex(e => e.id === id);
  if (i >= 0) list.splice(i,1);
  if (state.selectedId === id) state.selectedId = null;
  renderElements(); renderInspector(); updatePrice(); snapshot();
}

function duplicateElement(){
  const el = selected(); if (!el) return;
  const copy = JSON.parse(JSON.stringify(el));
  copy.id = uid(); copy.x += 16; copy.y += 16; copy.z = nextZ();
  curList().push(copy);
  state.selectedId = copy.id;
  renderElements(); renderInspector(); updatePrice(); snapshot();
}

function selectElement(id){
  state.selectedId = id;
  renderElements();
  renderInspector();
}
function deselect(){
  if (!state.selectedId) return;
  state.selectedId = null;
  renderElements();
  renderInspector();
}

function bringForward(){ const el=selected(); if(el){ el.z=nextZ(); renderElements(); snapshot(); } }
function sendBackward(){
  const el=selected(); if(!el) return;
  const minZ = curList().reduce((m,e)=>Math.min(m,e.z), Infinity);
  el.z = minZ - 1; renderElements(); snapshot();
}

/* ------------------------------------------------------------------ */
/* 11. PAINEL CONTEXTUAL (esquerda)                                    */
/* ------------------------------------------------------------------ */

function renderPanel(){
  const tool = activeTool;
  let html = '';

  if (tool === 'produto'){
    html += `<h3>Modelo</h3><div class="product-grid">`;
    PRODUCTS.forEach(p => {
      html += `<button class="product-card ${p.id===state.product?'is-active':''}" data-product="${p.id}">
        ${p.icon}<span>${p.name}</span><small style="display:block">${money(p.base)}</small></button>`;
    });
    html += `</div>`;

    html += `<div class="group" style="margin-top:24px"><h3>Malha / Tecido</h3><div class="opt-list">`;
    FABRICS.forEach(f => {
      html += `<button class="opt ${f.id===state.fabric?'is-active':''}" data-fabric="${f.id}">
        <span>${f.name}<small>${f.desc}</small></span>
        <span class="opt-price">${f.add?'+'+money(f.add):'incluso'}</span></button>`;
    });
    html += `</div></div>`;

    html += `<div class="group"><h3>Tamanho</h3><div class="size-grid">`;
    SIZES.forEach(s => html += `<button class="size-btn ${s===state.size?'is-active':''}" data-size="${s}">${s}</button>`);
    html += `</div></div>`;
  }

  else if (tool === 'cor'){
    html += `<h3>Cor do produto</h3><div class="swatch-grid">`;
    COLORS.forEach((c,i) => {
      const act = c.hex === state.color.hex ? 'is-active' : '';
      html += `<button class="swatch ${act}" data-color="${i}" title="${c.name}"
        style="background:${c.hex}"></button>`;
    });
    html += `</div><div class="color-name">${state.color.name}</div>
      <p class="hint">A cor escolhida vale para frente e costas. Os elementos da arte mantêm suas próprias cores.</p>`;
  }

  else if (tool === 'texto'){
    html += `<h3>Texto</h3>
      <button class="big-btn" id="add-text"><span class="ico">🅣</span> Adicionar texto</button>
      <p class="hint">Clique para inserir um texto na <b>${state.side==='front'?'frente':'costas'}</b>.
      Depois selecione-o no palco para editar fonte, cor e tamanho no painel da direita.</p>`;
    html += quickTextPresets();
  }

  else if (tool === 'imagem'){
    html += `<h3>Imagem / Logo</h3>
      <button class="big-btn" id="add-image"><span class="ico">⬆️</span> Enviar imagem (PNG/JPG)</button>
      <p class="hint">Faça upload da sua arte ou logo. Recomendado PNG com fundo transparente,
      em alta resolução. Você pode mover, girar e redimensionar no palco.</p>`;
    html += `<div class="group" style="margin-top:18px"><h3>Cliparts</h3><div class="shape-grid">`;
    ['⭐','🔥','💀','⚡','🌵','🎧','🚀','❤️'].forEach(em =>
      html += `<button class="shape-btn clip" data-clip="${em}" style="font-size:24px">${em}</button>`);
    html += `</div><p class="hint">Cliparts de exemplo (emoji) — no produto real entram artes vetoriais.</p></div>`;
  }

  else if (tool === 'formas'){
    html += `<h3>Formas</h3><div class="shape-grid">`;
    SHAPES.forEach(s => html += `<button class="shape-btn" data-shape="${s}">${shapeIcon(s)}</button>`);
    html += `</div><p class="hint">Adicione formas geométricas. Selecione no palco para mudar a cor.</p>`;
  }

  else if (tool === 'estampa'){
    html += `<h3>Técnica de estampa</h3><div class="opt-list">`;
    TECHNIQUES.forEach(t => {
      html += `<button class="opt ${t.id===state.technique?'is-active':''}" data-tech="${t.id}">
        <span>${t.name}<small>${t.desc}</small></span>
        <span class="opt-price">${t.add?'+'+money(t.add):'base'}</span></button>`;
    });
    html += `</div><p class="hint">A técnica influencia o acabamento e o preço final.
      Silk para grandes quantidades; DTF/Sublimação para imagens com muitas cores.</p>`;
  }

  els.panel.innerHTML = html;
  bindPanelEvents();
}

function quickTextPresets(){
  return `<div class="group" style="margin-top:18px"><h3>Sugestões</h3><div class="opt-list">
    <button class="opt preset" data-preset="TIME DOS SONHOS"><span>TIME DOS SONHOS</span></button>
    <button class="opt preset" data-preset="STAFF"><span>STAFF</span></button>
    <button class="opt preset" data-preset="Nome + Número"><span>Nome + Número</span></button>
  </div></div>`;
}

function shapeIcon(s){
  const m = {
    rect:'<rect x="6" y="6" width="18" height="18" rx="3" fill="currentColor"/>',
    circle:'<circle cx="15" cy="15" r="11" fill="currentColor"/>',
    triangle:'<polygon points="15,4 26,26 4,26" fill="currentColor"/>',
    line:'<rect x="3" y="13" width="24" height="5" rx="2" fill="currentColor"/>',
    star:'<polygon points="15,3 18,12 27,12 20,18 22,27 15,22 8,27 10,18 3,12 12,12" fill="currentColor"/>',
    heart:'<path d="M15 26 L5 16 Q-1 9 6 5 Q11 2 15 9 Q19 2 24 5 Q31 9 25 16 Z" fill="currentColor"/>',
  };
  return `<svg viewBox="0 0 30 30">${m[s]||m.rect}</svg>`;
}

function bindPanelEvents(){
  $$('.product-card', els.panel).forEach(b => b.onclick = () => {
    state.product = b.dataset.product; renderShirt(); renderPanel(); updatePrice();
  });
  $$('[data-fabric]', els.panel).forEach(b => b.onclick = () => {
    state.fabric = b.dataset.fabric; renderPanel(); updatePrice();
  });
  $$('[data-size]', els.panel).forEach(b => b.onclick = () => {
    state.size = b.dataset.size; renderPanel();
  });
  $$('[data-color]', els.panel).forEach(b => b.onclick = () => {
    state.color = COLORS[+b.dataset.color]; renderShirt(); renderPanel();
  });
  $$('[data-tech]', els.panel).forEach(b => b.onclick = () => {
    state.technique = b.dataset.tech; renderPanel(); updatePrice(); setStep('estampa');
  });
  $$('[data-shape]', els.panel).forEach(b => b.onclick = () => addShape(b.dataset.shape));
  $$('.clip', els.panel).forEach(b => b.onclick = () => addEmoji(b.dataset.clip));
  const at = $('#add-text');   if (at) at.onclick = addText;
  const ai = $('#add-image');  if (ai) ai.onclick = () => els.fileInput.click();
  $$('.preset', els.panel).forEach(b => b.onclick = () => { addText(); const el=selected(); el.text=b.dataset.preset; el.upper=false; renderElements(); renderInspector(); });
}

// emoji vira imagem desenhada num canvas (para poder mover/escalar como imagem)
function addEmoji(emoji){
  const cv = document.createElement('canvas');
  cv.width = cv.height = 200;
  const ctx = cv.getContext('2d');
  ctx.font = '160px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(emoji, 100, 110);
  addImageFromSrc(cv.toDataURL());
}

/* ------------------------------------------------------------------ */
/* 12. INSPECTOR (direita): propriedades OU resumo                     */
/* ------------------------------------------------------------------ */

function renderInspector(){
  const el = selected();
  if (el){ els.inspector.dataset.mode = 'props'; renderProps(el); }
  else   { els.inspector.dataset.mode = 'summary'; renderSummary(); }
}

function renderProps(el){
  let h = `<h3>Editar ${el.type==='text'?'texto':el.type==='image'?'imagem':'forma'}</h3>`;

  if (el.type === 'text'){
    h += `<div class="field"><label>Texto</label>
      <textarea id="p-text">${escapeHtml(el.text)}</textarea></div>`;
    h += `<div class="field"><label>Fonte</label><select id="p-font">`;
    FONTS.forEach(f => h += `<option value="${f}" ${f===el.font?'selected':''} style="font-family:'${f}'">${f}</option>`);
    h += `</select></div>`;
    h += `<div class="field"><label>Tamanho</label><div class="range-row">
      <input type="range" id="p-size" min="8" max="120" value="${el.size}">
      <output>${el.size}px</output></div></div>`;
    h += `<div class="field"><label>Estilo</label><div class="btn-row">
      <button class="chip ${el.bold?'is-active':''}" id="p-bold"><b>B</b></button>
      <button class="chip ${el.italic?'is-active':''}" id="p-italic"><i>I</i></button>
      <button class="chip ${el.upper?'is-active':''}" id="p-upper">AA</button></div></div>`;
    h += `<div class="field"><label>Alinhamento</label><div class="btn-row">
      <button class="chip ${el.align==='left'?'is-active':''}" data-align="left">⬅</button>
      <button class="chip ${el.align==='center'?'is-active':''}" data-align="center">⬛</button>
      <button class="chip ${el.align==='right'?'is-active':''}" data-align="right">➡</button></div></div>`;
    h += colorField('p-color', el.color);
  }

  else if (el.type === 'image'){
    h += `<div class="field"><label>Opacidade</label><div class="range-row">
      <input type="range" id="p-opacity" min="10" max="100" value="${Math.round(el.opacity*100)}">
      <output>${Math.round(el.opacity*100)}%</output></div></div>
      <p class="hint">Arraste as alças no palco para girar e redimensionar.</p>`;
  }

  else if (el.type === 'shape'){
    h += colorField('p-fill', el.fill);
    h += `<div class="field"><label>Opacidade</label><div class="range-row">
      <input type="range" id="p-opacity" min="10" max="100" value="${Math.round(el.opacity*100)}">
      <output>${Math.round(el.opacity*100)}%</output></div></div>`;
  }

  // ações comuns
  h += `<div class="field"><label>Camada</label><div class="btn-row">
    <button class="chip" id="p-front">Trazer ↑</button>
    <button class="chip" id="p-back">Enviar ↓</button>
    <button class="chip" id="p-dup">Duplicar</button></div></div>`;
  h += `<button class="btn-del" id="p-del">Excluir elemento</button>`;

  els.inspector.innerHTML = h;
  bindPropsEvents(el);
}

function colorField(id, val){
  const palette = ['#1c1c1e','#ffffff','#cf2f33','#2f6df6','#2f8f4e','#f2c12e','#e86a9c','#7a3fb0','#d9cbb2','#000000'];
  let h = `<div class="field"><label>Cor</label><div class="color-row">`;
  palette.forEach(c => h += `<button class="color-dot ${c===val?'is-active':''}" data-pick="${id}" data-color="${c}" style="background:${c}"></button>`);
  h += `<input type="color" id="${id}" value="${toHex(val)}" style="width:34px;height:26px;border:none;background:none;padding:0"></div></div>`;
  return h;
}

function bindPropsEvents(el){
  const re = () => { syncNode(el); };
  const txt = $('#p-text');  if (txt){ txt.oninput = e => { el.text = e.target.value; renderElements(); }; txt.onchange = snapshot; }
  const fnt = $('#p-font');  if (fnt) fnt.onchange = e => { el.font = e.target.value; node(el).style.fontFamily=`'${el.font}',sans-serif`; snapshot(); };
  const sz  = $('#p-size');  if (sz)  sz.oninput = e => { el.size=+e.target.value; sz.nextElementSibling.value=el.size+'px'; syncNode(el); };
  if (sz) sz.onchange = snapshot;
  const op  = $('#p-opacity'); if (op){ op.oninput = e => { el.opacity=+e.target.value/100; op.nextElementSibling.value=e.target.value+'%'; node(el).style.opacity=el.opacity; }; op.onchange=snapshot; }

  const bold=$('#p-bold'); if (bold) bold.onclick=()=>{ el.bold=!el.bold; renderElements(); renderInspector(); snapshot(); };
  const ital=$('#p-italic'); if (ital) ital.onclick=()=>{ el.italic=!el.italic; renderElements(); renderInspector(); snapshot(); };
  const upp=$('#p-upper'); if (upp) upp.onclick=()=>{ el.upper=!el.upper; renderElements(); renderInspector(); snapshot(); };
  $$('[data-align]').forEach(b => b.onclick=()=>{ el.align=b.dataset.align; renderElements(); renderInspector(); snapshot(); });

  $$('[data-pick]').forEach(b => b.onclick=()=>{
    const key=b.dataset.pick, col=b.dataset.color;
    if (key==='p-color') el.color=col; else el.fill=col;
    renderElements(); renderInspector(); snapshot();
  });
  const cc=$('#p-color'); if (cc) cc.oninput=e=>{ el.color=e.target.value; renderElements(); };
  if (cc) cc.onchange=()=>{ renderInspector(); snapshot(); };
  const cf=$('#p-fill'); if (cf) cf.oninput=e=>{ el.fill=e.target.value; renderElements(); };
  if (cf) cf.onchange=()=>{ renderInspector(); snapshot(); };

  $('#p-front').onclick = bringForward;
  $('#p-back').onclick  = sendBackward;
  $('#p-dup').onclick   = duplicateElement;
  $('#p-del').onclick   = () => deleteElement(el.id);
}

function node(el){ return els.printArea.querySelector(`[data-id="${el.id}"]`); }

function renderSummary(){
  const p = PRODUCTS.find(x=>x.id===state.product);
  const f = FABRICS.find(x=>x.id===state.fabric);
  const t = TECHNIQUES.find(x=>x.id===state.technique);
  const pr = computePrice();
  const nFront = state.elements.front.length, nBack = state.elements.back.length;

  if (nFront + nBack === 0 && !state.selectedId){
    // ainda mostra resumo, mas com dica
  }

  let h = `<h3>Resumo do pedido</h3>
    <div class="summary-line"><span>Modelo</span><span>${p.name}</span></div>
    <div class="summary-line"><span>Malha</span><span>${f.name}</span></div>
    <div class="summary-line"><span>Cor</span><span>${state.color.name}</span></div>
    <div class="summary-line"><span>Tamanho</span><span>${state.size}</span></div>
    <div class="summary-line"><span>Estampa</span><span>${t.name}</span></div>
    <div class="summary-line"><span>Elementos</span><span>${nFront} frente · ${nBack} costas</span></div>
    <div style="height:14px"></div>
    <div class="summary-line"><span>Produto base</span><span>${money(pr.base)}</span></div>
    ${pr.fabric?`<div class="summary-line"><span>Malha</span><span>+${money(pr.fabric)}</span></div>`:''}
    ${pr.tech?`<div class="summary-line"><span>Técnica</span><span>+${money(pr.tech)}</span></div>`:''}
    ${pr.art?`<div class="summary-line"><span>Personalização</span><span>+${money(pr.art)}</span></div>`:''}
    ${pr.back?`<div class="summary-line"><span>Estampa costas</span><span>+${money(pr.back)}</span></div>`:''}
    <div class="summary-total"><span>Total</span><span>${money(pr.total)}</span></div>
    <p class="hint">Selecione um elemento no palco para editá-lo aqui.</p>`;
  els.inspector.innerHTML = h;
}

/* ------------------------------------------------------------------ */
/* 13. FERRAMENTAS / NAVEGAÇÃO                                          */
/* ------------------------------------------------------------------ */

function setTool(tool){
  activeTool = tool;
  $$('.rail-btn', els.rail).forEach(b => b.classList.toggle('is-active', b.dataset.tool===tool));
  renderPanel();
  const map = { produto:'produto', cor:'produto', texto:'arte', imagem:'arte', formas:'arte', estampa:'estampa' };
  setStep(map[tool] || 'produto');
}

function setStep(step){
  $$('.step', els.steps).forEach(s => s.classList.toggle('is-active', s.dataset.step===step));
}

function setSide(side){
  state.side = side;
  state.selectedId = null;
  $$('.side-btn').forEach(b => b.classList.toggle('is-active', b.dataset.side===side));
  renderElements(); renderInspector();
  renderPanel(); // atualiza dicas que mencionam o lado
}

function setZoom(z){
  state.zoom = Math.min(2, Math.max(0.5, +z.toFixed(2)));
  els.mockup.style.transform = `scale(${state.zoom})`;
  els.zoomLabel.textContent = Math.round(state.zoom*100) + '%';
}

/* ------------------------------------------------------------------ */
/* 14. CARRINHO                                                        */
/* ------------------------------------------------------------------ */

function openCart(){
  const p = PRODUCTS.find(x=>x.id===state.product);
  const f = FABRICS.find(x=>x.id===state.fabric);
  const t = TECHNIQUES.find(x=>x.id===state.technique);
  const pr = computePrice();
  $('#cart-body').innerHTML = `
    <div class="summary-line"><span>${p.name} — ${state.color.name} — ${state.size}</span><span>${money(pr.base)}</span></div>
    <div class="summary-line"><span>Malha ${f.name}</span><span>${pr.fabric?'+'+money(pr.fabric):'incluso'}</span></div>
    <div class="summary-line"><span>Estampa ${t.name}</span><span>${pr.tech?'+'+money(pr.tech):'base'}</span></div>
    ${pr.art?`<div class="summary-line"><span>Personalização</span><span>+${money(pr.art)}</span></div>`:''}
    ${pr.back?`<div class="summary-line"><span>Estampa nas costas</span><span>+${money(pr.back)}</span></div>`:''}
    <div class="summary-total"><span>Total</span><span>${money(pr.total)}</span></div>`;
  $('#cart-modal').hidden = false;
}

/* ------------------------------------------------------------------ */
/* 15. HELPERS                                                         */
/* ------------------------------------------------------------------ */

function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toHex(c){
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  if (/^#([0-9a-f]{3})$/i.test(c)) return '#'+c.slice(1).split('').map(x=>x+x).join('');
  return '#000000';
}

/* ------------------------------------------------------------------ */
/* 16. EVENTOS GLOBAIS                                                 */
/* ------------------------------------------------------------------ */

function bindGlobal(){
  $$('.rail-btn', els.rail).forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $$('.side-btn').forEach(b => b.onclick = () => setSide(b.dataset.side));

  els.fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => addImageFromSrc(ev.target.result);
    reader.readAsDataURL(file);
    els.fileInput.value = '';
  };

  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#zoom-in').onclick  = () => setZoom(state.zoom + 0.1);
  $('#zoom-out').onclick = () => setZoom(state.zoom - 0.1);
  $('#clear-side').onclick = () => {
    if (!curList().length) return;
    if (confirm('Remover todos os elementos deste lado?')){
      state.elements[state.side] = [];
      state.selectedId = null;
      renderElements(); renderInspector(); updatePrice(); snapshot();
    }
  };

  $('#btn-cart').onclick = openCart;
  $('#cart-close').onclick = () => $('#cart-modal').hidden = true;
  $('#cart-confirm').onclick = () => { $('#cart-modal').hidden = true; toast('Pedido enviado! (protótipo)'); };
  $('#cart-modal').onclick = e => { if (e.target.id==='cart-modal') $('#cart-modal').hidden = true; };

  // clicar fora dos elementos deseleciona
  els.printArea.addEventListener('pointerdown', e => { if (e.target === els.printArea) deselect(); });

  // teclado
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if ((e.key==='Delete'||e.key==='Backspace') && state.selectedId){ e.preventDefault(); deleteElement(state.selectedId); }
    if (e.key==='Escape') deselect();
    if ((e.ctrlKey||e.metaKey) && e.key==='z'){ e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey) && (e.key==='y' || (e.shiftKey && e.key==='z'))){ e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey) && e.key==='d' && state.selectedId){ e.preventDefault(); duplicateElement(); }
  });
}

/* ------------------------------------------------------------------ */
/* 17. INIT                                                            */
/* ------------------------------------------------------------------ */

function init(){
  renderShirt();
  setTool('produto');
  renderElements();
  renderInspector();
  updatePrice();
  bindGlobal();
  snapshot();
  setZoom(1);
}

document.addEventListener('DOMContentLoaded', init);
