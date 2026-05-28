/* =========================================================================
   PAINEL DE PRODUÇÃO — GALPÃO UNA
   javascript puro: lê CSV, filtra a partir de TORUN, renderiza cards,
   suporta drag-and-drop entre BOARD <→ SIDEBAR (move, não duplica).
   Auto-refresh do CSV. Persistência da posição (board/sidebar) no localStorage.
   ========================================================================= */

/* ---------- 1. CONFIG --------------------------------------------------- */

// =========================================================================
//  FONTES DE DADOS — uma URL por aba publicada do Google Sheets.
//
//  Pra publicar uma aba nova:
//   Google Sheets > Arquivo > Compartilhar > Publicar na web
//   Aba: escolher a aba desejada (NÃO "documento inteiro")
//   Formato: Valores separados por vírgula (.csv) > Publicar > copiar URL
//   Adicionar a URL no array abaixo.
//
//  Se o array ficar vazio, o painel usa dados.csv local automaticamente.
// =========================================================================
// Apps Script Web App vinculado à planilha Sheets nativa
// "STATUS - Projetos" (15Zqvldf2gIy8nqtNInOTHnQlzsIFLEFuxbkhLTkppVs).
// Consolida automaticamente todas as abas com nome de mês
// (MAIO 2026, JUN 2026, JUL 2026, etc.) com varredura completa.
const SHEET_CSV_URLS = [
  "https://script.google.com/macros/s/AKfycbyNLmiFQkfCmUqWAdc5dZ48JNgAQn58nth0myjAGcW5ASy5yLwFRENueFkvxvmqlf-ZRw/exec",
];

const FALLBACK_CSV = "dados.csv";

// Auto-refresh do CSV (ms). 0 desliga. 30s = bom equilíbrio.
const REFRESH_MS = 30000;

/* ---------- 2. CONSTANTES ----------------------------------------------- */

const MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

const COL = { PROJETO: 1, CONTATO: 3, PRAZO: 4, FORNECEDOR: 6, PROCESSO: 7 };

const FORNECEDORES_CONHECIDOS = ["MK","TG","IZ","XBZ","CRI"];

// Dias úteis de antecedência operacional. Prazo do cliente recua N dias úteis
// no painel pra dar margem de produção (entrega 2 dias antes do prazo final).
const BUSINESS_DAYS_BACK = 2;

// aliases -> sigla canônica. Aceita o que vier escrito na coluna G.
const SUPPLIER_ALIASES = {
  MK:  ['MK', 'MIK', 'MIKE', 'MICKEY'],
  TG:  ['TG', 'TEG', 'TAG'],
  IZ:  ['IZ', 'IZZY', 'IZZ'],
  XBZ: ['XBZ', 'XB', 'XBIZ'],
  CRI: ['CRI', 'CRIS', 'CLIENTE']  // "cliente ok" significa fornecedor CRI
};

// palavras que aparecem na coluna G mas NÃO são fornecedores
const SUPPLIER_IGNORE = new Set([
  'OK','PEDIDO','PEDIDA','PEDIR','E','DE','PRA','OS','AS','DO','DA',
  'ENTREGUE','PAGO','PAGA','NF','NFE','ENVIADO','RECEBIDO',
  'DTF','SILK','SUB','IMPRESSAO','IMPRESSO','EM','PRODUCAO'
]);

const LS_KEY          = 'painel-galpao-locs-v1';
const LS_FINISHED_KEY = 'painel-galpao-finished-v1';
const LS_NOTES_KEY    = 'painel-galpao-notes-v1';
const LS_THEME_KEY    = 'painel-galpao-theme-v1';

// SVG silhueta camiseta usada no quadrado do fornecedor
const TSHIRT_SVG = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8.4 2.5 L4 4.6 L3 8.4 L6 9.4 L6 20.5 L18 20.5 L18 9.4 L21 8.4 L20 4.6 L15.6 2.5 L14.4 3.6 C13.4 4.6 10.6 4.6 9.6 3.6 Z"/>
</svg>`;

/* ---------- 3. STATE ---------------------------------------------------- */

// Map<id, recordObj>  — verdade única dos dados de cada card
const RECORDS = new Map();

// Map<id, "board" | "sidebar"> — onde cada card está agora
const LOCATIONS = new Map();

let activeDetailId = null;
let refreshTimer  = null;
let lastSignature = '';  // hash do CSV pra detectar mudança

/* ---------- 4. CSV ------------------------------------------------------ */

// hash djb2 — detecta qualquer mudança no conteúdo, mesmo no meio
function quickHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i+1] === '\n') i++;
        row.push(field); rows.push(row);
        row = []; field = '';
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- 5. DATA TRANSFORM ------------------------------------------- */

function parseDate(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  let m = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (m) {
    let day = parseInt(m[1], 10);
    let month = parseInt(m[2], 10) - 1;
    let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    return { day, month, year };
  }
  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return {
      day:   parseInt(m[3], 10),
      month: parseInt(m[2], 10) - 1,
      year:  parseInt(m[1], 10)
    };
  }
  return null;
}

function formatDate(d) {
  if (!d) return null;
  return { day: String(d.day).padStart(2, '0'), month: MESES[d.month] || '' };
}

// Recua N dias úteis (pula sábado e domingo)
function shiftBusinessDays(date, days) {
  if (!date) return null;
  const d = new Date(date.year, date.month, date.day);
  const sign = days < 0 ? -1 : 1;
  let n = Math.abs(days);
  while (n > 0) {
    d.setDate(d.getDate() + sign);
    const dow = d.getDay();           // 0=dom 6=sab
    if (dow !== 0 && dow !== 6) n--;
  }
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function parseFornecedores(s) {
  if (!s) return [];
  const tokens = String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .split(/[,;\s\/|\\.()]+/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    if (SUPPLIER_IGNORE.has(t)) continue;
    let canon = null;
    for (const [sig, aliases] of Object.entries(SUPPLIER_ALIASES)) {
      if (aliases.includes(t)) { canon = sig; break; }
    }
    if (!canon) {
      // sigla 2-6 letras (puro alfabeto) e fora da lista ignore = fornecedor novo
      if (t.length >= 2 && t.length <= 6 && /^[A-Z]+$/.test(t)) canon = t;
    }
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
      if (out.length >= 4) break;
    }
  }
  return out;
}

function parseProcesso(s) {
  if (!s) return [];
  const tokens = String(s).toUpperCase().split(/[\s,;\/]+/).filter(Boolean);
  const out = [];
  if (tokens.includes('D')) out.push('DTF');
  if (tokens.includes('S')) out.push('SILK');
  return out;
}

function supplierClass(sig) {
  const key = (sig || '').toUpperCase();
  if (FORNECEDORES_CONHECIDOS.includes(key)) return 'sup-' + key.toLowerCase();
  return 'sup-x';
}

/**
 * Urgência calculada a partir da data:
 *  overdue → hoje ou atrasado (vermelho)
 *  urgent  → 1 a 3 dias (laranja)
 *  soon    → 4 a 14 dias (dourado)
 *  far     → 15+ dias (teal)
 *  none    → sem data (cinza)
 */
function urgencyFor(date) {
  if (!date) return 'none';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.year, date.month, date.day);
  const diff = Math.round((target - today) / 86400000);
  if (diff <= 0) return 'overdue';
  if (diff <= 3)  return 'urgent';
  if (diff <= 14) return 'soon';
  return 'far';
}

// limita nome do projeto a `max` chars, cortando em palavra completa se possível
function shortName(s, max = 15) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > Math.floor(max * 0.5)) return cut.slice(0, lastSpace);
  return cut;
}

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'X';
}

/* ---------- 6. LOAD DATA ------------------------------------------------ */

async function loadData(silent = false) {
  const urls = (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS : [])
    .map(u => (u || '').trim())
    .filter(Boolean);
  const usingSheets = urls.length > 0;
  if (!silent) showToast(`CARREGANDO ${usingSheets ? `${urls.length} ABA(S) DO SHEETS` : "DADOS.CSV"}...`);

  let texts = [];
  try {
    if (usingSheets) {
      const results = await Promise.all(urls.map(async (url) => {
        const cb = `${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
        const res = await fetch(url + cb, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
        return res.text();
      }));
      texts = results;
    } else {
      const res = await fetch(`${FALLBACK_CSV}?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      texts = [await res.text()];
    }
  } catch (err) {
    console.error('[Painel] Falha ao buscar CSV:', err);
    if (!silent) showToast('FALHA AO CARREGAR DADOS — VEJA O CONSOLE', 5000);
    return;
  }

  // detecta mudança usando hash robusto (djb2) — pega edição no meio do CSV
  const sig = texts.map(t => quickHash(t)).join('|');
  if (silent && sig === lastSignature) {
    updateStamp();
    return;
  }
  lastSignature = sig;

  // parseia cada CSV e aplica filtro TORUN dentro de cada (uma vez por aba)
  let rows = [];
  for (const text of texts) {
    const parsed = parseCSV(text);
    // procura o TORUN nesse CSV e fatia a partir dele
    const torunIdx = parsed.findIndex(r => /TORU[NM]/i.test((r[COL.PROJETO] || '').trim()));
    rows = rows.concat(torunIdx >= 0 ? parsed.slice(torunIdx) : parsed);
  }
  const records = filterAndBuildRecords(rows);

  // preserva o LOCATIONS dos cards que ainda existem
  const prevLocs = restoreLocations(); // ou usa LOCATIONS atual
  RECORDS.clear();
  LOCATIONS.clear();
  for (const r of records) {
    RECORDS.set(r.id, r);
    const loc = prevLocs.get(r.id);
    LOCATIONS.set(r.id, loc === 'sidebar' ? 'sidebar' : 'board');
  }
  persistLocations();
  renderAll();
  updateStamp();
  if (!silent) showToast(`${records.length} CARDS CARREGADOS`, 2000);
}

function filterAndBuildRecords(rows) {
  // 1) começa a listar a partir da primeira linha com "TORUN"/"TORUM" em B
  //    (linhas anteriores são trabalhos já concluídos/arquivados que ele deixa
  //    no histórico).  Se a linha TORUN não existir, considera tudo.
  const torunIdx = rows.findIndex(r =>
    /TORU[NM]/i.test((r[COL.PROJETO] || '').trim())
  );
  const slice = torunIdx >= 0 ? rows.slice(torunIdx) : rows;

  // 2) filtro por MÊS CORRENTE: data >= primeiro dia do mês atual.
  //    Cards sem data passam (são novos rascunhos).
  const now = new Date();
  const minYear  = now.getFullYear();
  const minMonth = now.getMonth();

  const finished = loadFinishedSet();
  const out = [];
  const used = new Map();
  for (const r of slice) {
    const projeto = (r[COL.PROJETO] || '').trim();
    if (!projeto) continue;

    const prazoRaw = (r[COL.PRAZO] || '').trim();
    const dateCliente = prazoRaw ? parseDate(prazoRaw) : null;
    // recua 2 dias úteis pra dar margem de produção
    const date = dateCliente ? shiftBusinessDays(dateCliente, -BUSINESS_DAYS_BACK) : null;
    // se TEM data ajustada: precisa ser do mês corrente em diante. Sem data passa.
    if (date) {
      const dateMonths = date.year * 12 + date.month;
      const minMonths  = minYear * 12 + minMonth;
      if (dateMonths < minMonths) continue;
    }

    const slug = slugify(projeto);
    const count = used.get(slug) || 0;
    used.set(slug, count + 1);
    const id = count > 0 ? `${slug}__${count}` : slug;

    if (finished.has(id)) continue;  // trabalho finalizado: nunca mais aparece

    out.push({
      id,
      projeto: shortName(projeto.toUpperCase(), 15),
      projetoFull: projeto.toUpperCase(),       // nome inteiro pro painel de detalhe
      contato: (r[COL.CONTATO] || '').trim(),
      date,                  // data já ajustada (-2 dias úteis)
      dateCliente,           // data original do cliente (pra mostrar no detalhe)
      fornecedores: parseFornecedores(r[COL.FORNECEDOR]),
      processos:    parseProcesso(r[COL.PROCESSO])
    });
  }
  // ordena por data crescente (próxima primeiro). Sem data vai pro fim.
  out.sort((a, b) => {
    const aT = a.date ? a.date.year * 10000 + a.date.month * 100 + a.date.day : Infinity;
    const bT = b.date ? b.date.year * 10000 + b.date.month * 100 + b.date.day : Infinity;
    return aT - bT;
  });
  return out;
}

/* ---------- 7. PERSISTÊNCIA (board/sidebar entre reloads) --------------- */

function restoreLocations() {
  // se já temos LOCATIONS na memória, usar
  if (LOCATIONS.size > 0) return new Map(LOCATIONS);
  // senão, ler do localStorage
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr);
  } catch (_) {
    return new Map();
  }
}
function persistLocations() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...LOCATIONS]));
  } catch (_) { /* localStorage cheio ou bloqueado */ }
}

/* -- finalizados (despachados) -----------------------------------------
 * Agora guarda snapshot completo (não só id) — permite restaurar com
 * todos os dados e listar os últimos despachados na sidebar. */
function loadFinishedList() {
  try {
    const raw = localStorage.getItem(LS_FINISHED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // back-compat: versão antiga guardava só array de strings
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map(id => ({ id, finishedAt: 0 }));
    }
    return parsed;
  } catch (_) { return []; }
}
function loadFinishedSet() {
  return new Set(loadFinishedList().map(f => f.id));
}
function markFinished(rec) {
  const list = loadFinishedList();
  const filtered = list.filter(f => f.id !== rec.id);
  filtered.unshift({
    id: rec.id,
    projeto: rec.projeto,
    projetoFull: rec.projetoFull,
    contato: rec.contato,
    date: rec.date,
    dateCliente: rec.dateCliente,
    fornecedores: rec.fornecedores,
    processos: rec.processos,
    finishedAt: Date.now()
  });
  if (filtered.length > 50) filtered.length = 50;
  try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify(filtered)); } catch (_) {}
  schedulePushRemote();
}
function unmarkFinished(id) {
  const list = loadFinishedList().filter(f => f.id !== id);
  try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify(list)); } catch (_) {}
  schedulePushRemote();
}

/* -- notas por card ---------------------------------------------------- */
function loadNotesMap() {
  try {
    const raw = localStorage.getItem(LS_NOTES_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj || {}));
  } catch (_) { return new Map(); }
}
function saveNoteFor(id, text) {
  const m = loadNotesMap();
  if (!text || !text.trim()) m.delete(id);
  else m.set(id, text);
  try { localStorage.setItem(LS_NOTES_KEY, JSON.stringify(Object.fromEntries(m))); } catch(_){}
  schedulePushRemote();
}
function getNoteFor(id) {
  return loadNotesMap().get(id) || '';
}
function clearNoteFor(id) {
  const m = loadNotesMap();
  m.delete(id);
  try { localStorage.setItem(LS_NOTES_KEY, JSON.stringify(Object.fromEntries(m))); } catch(_){}
}

/* ---------- 8. RENDER --------------------------------------------------- */

const $board   = document.getElementById('board');
const $sidebar = document.getElementById('sidebar');
const $sidebarInner = document.getElementById('sidebar-inner');
const $detail  = document.getElementById('detail');
const $detailContent = document.getElementById('detail-content');
const $stamp   = document.getElementById('refresh-stamp');

function renderAll() {
  [...$board.querySelectorAll('.card')].forEach(n => n.remove());
  [...$sidebarInner.querySelectorAll('.card-mini')].forEach(n => n.remove());

  for (const [id, rec] of RECORDS) {
    const loc = LOCATIONS.get(id);
    if (loc === 'sidebar') $sidebarInner.appendChild(buildCardMini(rec));
    else                   $board.appendChild(buildCardFull(rec));
  }

  recalcLayout();

  // se o detail está aberto e o card sumiu, fechar
  if (activeDetailId && !RECORDS.has(activeDetailId)) closeDetail();
  // se mudou, atualiza miniatura
  if (activeDetailId) openDetail(activeDetailId);
}

/* ----- Layout dinâmico ----------------------------------------------
 * Calcula colunas e linhas baseado no espaço disponível e número de cards.
 * Usa grid-auto-flow: column → preenche coluna a coluna (top-to-bottom).
 * Quando o user faz zoom in/out, recalcula pra manter cards visíveis. */
function recalcLayout() {
  if (!$board) return;
  const cards = $board.querySelectorAll('.card');
  const total = cards.length;
  if (total === 0) {
    $board.style.removeProperty('grid-template-columns');
    $board.style.removeProperty('grid-template-rows');
    $board.style.removeProperty('grid-auto-columns');
    return;
  }
  const gap = 6;
  const padding = 12;
  const availW = $board.clientWidth  - padding;
  const availH = $board.clientHeight - padding;
  if (availW < 50 || availH < 50) return;

  const targetCardW = 290;
  const minCardW    = 180;
  const minCardH    = 100;
  const maxCardH    = 270;

  // 1) determinar linhas FIXAS que cabem na altura disponível
  //    cards menores → mais linhas; sempre dentro de min/max
  const targetRowH = 200;
  let rows = Math.max(1, Math.floor((availH + gap) / (targetRowH + gap)));
  // tenta acomodar todos sem scroll horizontal se possível
  const colsIdeal = Math.floor((availW + gap) / (targetCardW + gap));
  if (colsIdeal > 0 && rows * colsIdeal < total) {
    rows = Math.min(Math.ceil(total / Math.max(1, colsIdeal)),
                    Math.max(1, Math.floor((availH + gap) / (minCardH + gap))));
  }

  // 2) altura por linha agora
  let rowH = Math.floor((availH - gap * (rows - 1)) / rows);
  rowH = Math.max(minCardH, Math.min(maxCardH, rowH));

  // 3) largura por coluna (cards crescem em COLUNAS — quando passar, vira scroll horizontal)
  let colW = Math.max(minCardW, Math.min(targetCardW, Math.floor((availW - gap * (Math.max(1, Math.ceil(total / rows)) - 1)) / Math.max(1, Math.ceil(total / rows)))));
  // se acabar muito grande, segura no target
  if (colW > targetCardW) colW = targetCardW;

  $board.style.gridAutoFlow      = 'column';
  $board.style.gridTemplateRows  = `repeat(${rows}, ${rowH}px)`;
  $board.style.gridAutoColumns   = `${colW}px`;
  $board.style.removeProperty('grid-template-columns');
}

// recalcula ao redimensionar (zoom in/out também dispara)
window.addEventListener('resize', () => {
  clearTimeout(window.__recalcTimer);
  window.__recalcTimer = setTimeout(recalcLayout, 80);
});

function buildDateHTML(date) {
  const d = formatDate(date);
  if (!d) return `— SEM DATA`;
  return `${d.day}<span class="sep">|</span><span class="month">${d.month}</span>`;
}

function buildCardFull(rec) {
  const card = document.createElement('div');
  const urg = urgencyFor(rec.date);
  card.className = `card urg-${urg}`;
  card.dataset.id = rec.id;
  card.draggable = true;

  // barra colorida lateral esquerda
  const bar = document.createElement('div');
  bar.className = 'card-bar';

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = rec.projeto;

  const divider = document.createElement('div');
  divider.className = 'card-divider';

  // linha inferior: data à esquerda, fornecedor + processo à direita
  const bottom = document.createElement('div');
  bottom.className = 'card-bottom';

  const date = document.createElement('div');
  date.className = 'card-date' + (rec.date ? '' : ' is-empty');
  date.innerHTML = buildDateHTML(rec.date);

  const tags = document.createElement('div');
  tags.className = 'card-tags';
  for (const f of rec.fornecedores) {
    const pill = document.createElement('span');
    pill.className = `sup-pill ${supplierClass(f)}`;
    pill.textContent = f;
    tags.appendChild(pill);
  }
  for (const p of rec.processos) {
    const btn = document.createElement('span');
    btn.className = 'proc-btn';
    btn.textContent = p;
    tags.appendChild(btn);
  }

  bottom.append(date, tags);
  body.append(name, divider, bottom);
  card.append(bar, body);
  attachCardHandlers(card);
  return card;
}

function buildCardMini(rec) {
  // wrapper que segura o card-mini + a nota colada abaixo (uma "etiqueta")
  const wrap = document.createElement('div');
  wrap.className = 'mini-wrap';
  wrap.dataset.id = rec.id;

  const card = document.createElement('div');
  const urg = urgencyFor(rec.date);
  card.className = `card-mini urg-${urg}`;
  card.dataset.id = rec.id;
  card.draggable = true;

  const bar = document.createElement('div');
  bar.className = 'mini-bar';

  const body = document.createElement('div');
  body.className = 'mini-body';

  const name = document.createElement('div');
  name.className = 'mini-name';
  name.textContent = rec.projeto;

  const div = document.createElement('div');
  div.className = 'mini-divider';

  const date = document.createElement('div');
  date.className = 'mini-date' + (rec.date ? '' : ' is-empty');
  date.innerHTML = buildDateHTML(rec.date);

  body.append(name, div, date);
  card.append(bar, body);
  attachCardHandlers(card);
  wrap.appendChild(card);

  // nota colada permanente — só aparece se houver conteúdo
  const note = getNoteFor(rec.id);
  if (note) wrap.appendChild(buildMiniNoteTag(note, rec.id));

  return wrap;
}

function buildMiniNoteTag(noteHTML, id) {
  const tag = document.createElement('div');
  tag.className = 'mini-note';
  tag.dataset.id = id || '';
  tag.innerHTML = `
    <div class="mini-note-label">
      <span>NOTAS PARA O MOTORISTA</span>
      <button class="mini-note-close" title="Apagar nota">×</button>
    </div>
    <div class="mini-note-body">${noteHTML}</div>
  `;
  const closeBtn = tag.querySelector('.mini-note-close');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const cardId = tag.dataset.id || tag.closest('.mini-wrap')?.dataset.id;
    if (!cardId) return;
    clearNoteFor(cardId);
    refreshMiniNoteTag(cardId, '');
    if (activeMotoristaId === cardId) {
      const content = document.getElementById('motorista-content');
      if (content) content.innerHTML = '';
    }
  });
  return tag;
}

/* ---------- 9. DRAG & DROP --------------------------------------------- */

let draggedId = null;

function attachCardHandlers(card) {
  card.addEventListener('dragstart', (e) => {
    draggedId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggedId); } catch (_) {}
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    $board.classList.remove('drop-active');
    $sidebar.classList.remove('drop-active');
    draggedId = null;
  });
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.classList.contains('card-mini')) {
      // card da sidebar → abre NOTAS DO MOTORISTA (com paste de imagem/texto)
      openMotorista(card.dataset.id);
    } else {
      openDetail(card.dataset.id);
    }
  });
  // duplo-clique no card-mini finaliza o trabalho (some pra sempre)
  card.addEventListener('dblclick', (e) => {
    if (!card.classList.contains('card-mini')) return;
    e.stopPropagation();
    finishCard(card.dataset.id);
  });
}

function finishCard(id) {
  if (!RECORDS.has(id)) return;
  const rec = RECORDS.get(id);
  if (!confirm(`Despachar o trabalho "${rec.projeto}"?\n\nO card vai sair do painel (fica no histórico de despachados pra restaurar se precisar).`)) return;
  markFinished(rec);    // salva snapshot completo
  clearNoteFor(id);
  RECORDS.delete(id);
  LOCATIONS.delete(id);
  persistLocations();
  document.querySelectorAll(`.mini-wrap[data-id="${cssEscape(id)}"], .card-mini[data-id="${cssEscape(id)}"], .card[data-id="${cssEscape(id)}"]`).forEach(n => n.remove());
  if (activeDetailId === id) closeDetail();
  showToast(`"${rec.projeto}" DESPACHADO`, 2200);
  updateStamp();
}

function restoreCard(id) {
  unmarkFinished(id);
  lastSignature = '';   // força re-fetch
  loadData(false);
  showToast('RESTAURADO', 1800);
}

function setupDropZone(zoneEl, target) {
  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zoneEl.classList.add('drop-active');
  });
  zoneEl.addEventListener('dragenter', (e) => {
    e.preventDefault();
    zoneEl.classList.add('drop-active');
  });
  zoneEl.addEventListener('dragleave', (e) => {
    if (e.target === zoneEl) zoneEl.classList.remove('drop-active');
  });
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('drop-active');
    const id = (e.dataTransfer.getData('text/plain') || draggedId);
    if (!id) return;
    moveCard(id, target);
  });
}

function moveCard(id, target) {
  if (!RECORDS.has(id)) return;
  const current = LOCATIONS.get(id);
  if (current === target) return;
  LOCATIONS.set(id, target);
  persistLocations();
  schedulePushRemote();

  // sidebar: empilha no fim (ordem de quem chegou)
  // board: re-renderiza tudo pra reordenar por data
  if (target === 'sidebar') {
    document
      .querySelectorAll(`[data-id="${cssEscape(id)}"]`)
      .forEach(n => n.remove());
    const rec = RECORDS.get(id);
    $sidebarInner.appendChild(buildCardMini(rec));
  } else {
    renderAll();
  }

  if (activeDetailId === id) openDetail(id);
}

function cssEscape(s) {
  return String(s).replace(/(["\\\[\]])/g, '\\$1');
}

/* ---------- 10. DETAIL PANEL ------------------------------------------- */

function openDetail(id) {
  const rec = RECORDS.get(id);
  if (!rec) return;
  activeDetailId = id;

  const contato = rec.contato || '';
  let line1 = contato, line2 = '';
  const parts = contato.split(/\s+/).filter(Boolean);
  if (parts.length > 1) { line1 = parts[0]; line2 = parts.slice(1).join(' '); }
  if (!contato) { line1 = rec.projeto; line2 = ''; }

  const dateHTML = buildDateHTML(rec.date);

  // bloco de datas no detalhe: painel (-2 d.u.) e cliente original (se diferente)
  let dateBlock = '';
  if (rec.date) {
    const dPainel = formatDate(rec.date);
    let html = `<div class="detail-date-label">PAINEL</div>
                <div class="detail-date-val">${dPainel.day} ${dPainel.month}</div>`;
    if (rec.dateCliente) {
      const dCli = formatDate(rec.dateCliente);
      const igual = dCli.day === dPainel.day && dCli.month === dPainel.month;
      if (!igual) {
        html += `<div class="detail-date-label" style="margin-top:6px">CLIENTE</div>
                 <div class="detail-date-val detail-date-cliente">${dCli.day} ${dCli.month}</div>`;
      }
    }
    dateBlock = html;
  }

  $detailContent.innerHTML = `
    <div class="detail-text">
      <div class="detail-name">${escapeHTML(line1)}</div>
      ${line2 ? `<div class="detail-name">${escapeHTML(line2)}</div>` : ''}
      <div class="detail-contact-label">CONTATO</div>
      <div class="detail-contact">${escapeHTML(contato || '—')}</div>
    </div>
    <div class="detail-mini">
      <div class="detail-mini-inner">
        <div class="detail-mini-name">${escapeHTML(rec.projetoFull || rec.projeto)}</div>
        <div class="detail-mini-divider"></div>
        <div class="detail-mini-date${rec.date ? '' : ' is-empty'}">${dateHTML}</div>
      </div>
      ${dateBlock ? `<div class="detail-dates">${dateBlock}</div>` : ''}
    </div>
  `;
  $detail.classList.add('active');
}

function closeDetail() {
  activeDetailId = null;
  $detail.classList.remove('active');
}

/* ---------- MODAL NOTAS DO MOTORISTA ---------------------------------
 * Aberto ao clicar num card da sidebar.
 * Aceita CTRL+V de imagem OU texto (texto vira CAIXA ALTA).
 * Conteúdo salvo em LS_NOTES_KEY por id do card (compartilha com o detail).
 */
let activeMotoristaId = null;

function openMotorista(id) {
  const rec = RECORDS.get(id);
  if (!rec) return;
  activeMotoristaId = id;
  const modal   = document.getElementById('motorista-modal');
  const content = document.getElementById('motorista-content');
  const title   = document.getElementById('motorista-title');
  title.textContent = (rec.projetoFull || rec.projeto) + ' — NOTAS PARA O MOTORISTA';
  content.innerHTML = getNoteFor(id) || '';
  modal.removeAttribute('hidden');
  positionMotorista(id);
  setTimeout(() => content.focus(), 30);
}

function positionMotorista(id) {
  const modal = document.getElementById('motorista-modal');
  const card  = document.querySelector(`[data-id="${cssEscape(id)}"]`);
  if (!card || !modal) return;
  const r = card.getBoundingClientRect();
  const margin = 8;
  // o card mini fica na sidebar (direita). O popover vai ABAIXO do card,
  // alinhado pela direita do card (espalha pra esquerda da sidebar).
  modal.style.top  = `${Math.round(r.bottom + margin)}px`;
  modal.style.left = 'auto';
  modal.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  // se passar pela borda inferior, ancora ACIMA do card
  setTimeout(() => {
    const mr = modal.getBoundingClientRect();
    if (mr.bottom > window.innerHeight - 8) {
      modal.style.top = `${Math.round(r.top - mr.height - margin)}px`;
    }
  }, 0);
}

function closeMotorista() {
  activeMotoristaId = null;
  const modal = document.getElementById('motorista-modal');
  modal.setAttribute('hidden', '');
}

/* ---------- POPOVER DESPACHADOS ------------------------------------- */

function openDispatched() {
  const modal = document.getElementById('dispatched-modal');
  const list  = document.getElementById('dispatched-list');
  const empty = document.getElementById('dispatched-empty');
  if (!modal || !list) return;

  const items = loadFinishedList()
    .slice()
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, 10);

  list.innerHTML = '';
  if (items.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const it of items) {
      const dateStr = it.date ? `${String(it.date.day).padStart(2,'0')}/${String(it.date.month+1).padStart(2,'0')}` : '— SEM DATA';
      const when = it.finishedAt ? formatRelativeTime(it.finishedAt) : '';
      const el = document.createElement('div');
      el.className = 'dispatched-item';
      el.innerHTML = `
        <div class="dispatched-item-info">
          <div class="dispatched-item-name">${escapeHTML(it.projetoFull || it.projeto || '?')}</div>
          <div class="dispatched-item-meta">${dateStr}${when ? ' · ' + when : ''}</div>
        </div>
        <button class="dispatched-restore" data-id="${escapeHTML(it.id)}">↻ RESTAURAR</button>
      `;
      list.appendChild(el);
    }
    list.querySelectorAll('.dispatched-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        restoreCard(id);
        closeDispatched();
      });
    });
  }

  modal.removeAttribute('hidden');
  positionDispatched();
}

function closeDispatched() {
  const modal = document.getElementById('dispatched-modal');
  if (modal) modal.setAttribute('hidden', '');
}

function positionDispatched() {
  const modal = document.getElementById('dispatched-modal');
  const sidebar = document.getElementById('sidebar');
  if (!modal || !sidebar) return;
  const r = sidebar.getBoundingClientRect();
  modal.style.top  = `${Math.round(r.top + 20)}px`;
  modal.style.right = `${Math.round(window.innerWidth - r.left + 8)}px`;
  modal.style.left = 'auto';
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function setupMotoristaModal() {
  const modal   = document.getElementById('motorista-modal');
  const content = document.getElementById('motorista-content');
  if (!modal || !content) return;

  document.getElementById('motorista-close')
    .addEventListener('click', closeMotorista);

  // click fora do popover fecha (mas não fecha se clicar num card-mini)
  document.addEventListener('click', (e) => {
    if (!activeMotoristaId) return;
    if (modal.contains(e.target)) return;
    if (e.target.closest('.card-mini')) return;   // permite trocar entre cards
    closeMotorista();
  });
  // reposicionar se a janela mudar de tamanho ou rolar
  window.addEventListener('resize', () => activeMotoristaId && positionMotorista(activeMotoristaId));
  window.addEventListener('scroll', () => activeMotoristaId && positionMotorista(activeMotoristaId));

  // CTRL+V — captura imagem ou texto, salva como HTML em LS_NOTES_KEY
  content.addEventListener('paste', async (e) => {
    e.preventDefault();
    if (!activeMotoristaId) return;
    const clip = e.clipboardData;
    // imagem?
    for (const item of clip.items || []) {
      if (item.type && item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const dataUrl = await blobToDataURL(blob);
        const compact = await resizeImageDataUrl(dataUrl, 1280, 1280, 0.78);
        content.innerHTML = `<img src="${compact}" alt="anexo">`;
        saveNoteFor(activeMotoristaId, content.innerHTML);
        refreshMiniNoteTag(activeMotoristaId, content.innerHTML);
        return;
      }
    }
    // texto puro → mantém capitalização original, só converte quebras
    const text = (clip.getData('text/plain') || '').trim();
    if (!text) return;
    content.innerHTML = textToHTML(text);
    saveNoteFor(activeMotoristaId, content.innerHTML);
    refreshMiniNoteTag(activeMotoristaId, content.innerHTML);
  });

  // editar manualmente também salva (debounced)
  let saveTimer = null;
  content.addEventListener('input', () => {
    if (!activeMotoristaId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNoteFor(activeMotoristaId, content.innerHTML);
      refreshMiniNoteTag(activeMotoristaId, content.innerHTML);
    }, 350);
  });
}

// atualiza/cria/remove a etiqueta-nota abaixo do card-mini correspondente
function refreshMiniNoteTag(id, html) {
  const wrap = document.querySelector(`.mini-wrap[data-id="${cssEscape(id)}"]`);
  if (!wrap) return;
  const existing = wrap.querySelector('.mini-note');
  if (existing) existing.remove();
  if (html && html.trim()) wrap.appendChild(buildMiniNoteTag(html, id));
  if (activeMotoristaId === id) positionMotorista(id);
}

function textToUppercaseHTML(txt) {
  return escapeHTML(String(txt).toUpperCase())
    .replace(/\r\n|\r|\n/g, '<br>');
}

function textToHTML(txt) {
  return escapeHTML(String(txt))
    .replace(/\r\n|\r|\n/g, '<br>');
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function resizeImageDataUrl(dataUrl, maxW, maxH, quality) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        const s = Math.min(maxW / w, maxH / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { res(c.toDataURL('image/jpeg', quality)); }
      catch (_) { res(dataUrl); }   // fallback (CORS)
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ---------- 11. TOAST + STAMP ----------------------------------------- */

const $toast = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, ms = 1800) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), ms);
}

/* ----- BORA ALMOÇAR — dias úteis, 13:30 às 14:30 --------------------- */
function isLunchTime() {
  const now = new Date();
  const day = now.getDay();                    // 0=dom, 1-5=úteis, 6=sab
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = 13 * 60 + 30;                  // 13:30 = 810
  const end   = 14 * 60 + 30;                  // 14:30 = 870
  return minutes >= start && minutes <= end;
}

function checkLunchOverlay() {
  const overlay = document.getElementById('lunch-overlay');
  if (!overlay) return;
  const shouldShow = isLunchTime();
  const isVisible  = !overlay.hasAttribute('hidden');
  if (shouldShow && !isVisible)  overlay.removeAttribute('hidden');
  if (!shouldShow && isVisible)  overlay.setAttribute('hidden', '');
}

// inicia o ciclo de verificação (a cada 30s + um check imediato)
setInterval(checkLunchOverlay, 30000);

function updateStamp() {
  if (!$stamp) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  $stamp.textContent = `${hh}:${mm}`;
}

// relógio ticando a cada minuto
setInterval(updateStamp, 60000);

/* ---------- 12. AUTO-REFRESH ------------------------------------------- */

/* ----- AUTO-REFRESH em 3 camadas (resiliente) -----------------------
 *  10s: state sync entre dispositivos
 *  30s: check rápido do CSV (só re-renderiza se hash mudou)
 *   5m: hard refresh — limpa cache e força fetch novo
 *  +  : Page Visibility API — refresh imediato quando volta da background
 */
const FULL_REFRESH_MS  = 5 * 60 * 1000;   // 5 min
const QUICK_REFRESH_MS = 30 * 1000;       // 30 s
const STATE_PULL_MS    = 10 * 1000;       // 10 s

/* ----- Auto-reload quando há build nova no servidor ----------------- */
const MY_BUILD = document.querySelector('meta[name="build-version"]')?.content || '';
async function checkForNewBuild() {
  if (!MY_BUILD) return;
  try {
    const res = await fetch(window.location.pathname + '?_v=' + Date.now(), { cache: 'no-store' });
    const html = await res.text();
    const m = html.match(/name="build-version"\s+content="([^"]+)"/);
    if (m && m[1] && m[1] !== MY_BUILD) {
      console.log('[painel] nova versão detectada', m[1], '→ reload em 2s');
      setTimeout(() => location.reload(), 2000);
    }
  } catch (_) {}
}

function startAllRefreshers() {
  // 30s: check rápido
  setInterval(async () => { await loadData(true); }, QUICK_REFRESH_MS);
  // 5min: hard refresh (força ignorar cache)
  setInterval(async () => {
    lastSignature = '';
    await loadData(true);
  }, FULL_REFRESH_MS);
  // 10s: pull do state compartilhado
  setInterval(pullRemoteState, STATE_PULL_MS);
  // verifica overlay BORA ALMOÇAR a cada 30s
  setInterval(checkLunchOverlay, 30000);
  // 60s: verifica se há nova build (auto-reload)
  setInterval(checkForNewBuild, 60000);
}

// quando a aba volta a ficar visível, força refresh imediato
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    lastSignature = '';
    loadData(true);
    pullRemoteState();
    checkLunchOverlay();
  }
});

// stubs antigos pra não quebrar — agora delegam pro setInterval acima
function scheduleRefresh() { /* substituído por startAllRefreshers */ }
function scheduleStateRefresh() { /* substituído por startAllRefreshers */ }

/* ---------- 13. INIT --------------------------------------------------- */

function init() {
  setupDropZone($board,   'board');
  setupDropZone($sidebar, 'sidebar');

  // botão refresh manual
  const $btnRefresh = document.getElementById('btn-refresh');
  if ($btnRefresh) {
    $btnRefresh.addEventListener('click', async () => {
      $btnRefresh.classList.add('spinning');
      lastSignature = '';   // força detectar como mudança
      await loadData(false);
      broadcastSync('refresh');                // propaga pras outras abas
      setTimeout(() => $btnRefresh.classList.remove('spinning'), 600);
    });
  }

  // botão tema dia / noite
  const $btnTheme = document.getElementById('btn-theme');
  applyTheme(loadTheme());
  if ($btnTheme) {
    $btnTheme.addEventListener('click', () => {
      const cur = document.body.dataset.theme || 'night';
      const nxt = cur === 'day' ? 'night' : 'day';
      applyTheme(nxt);
      try { localStorage.setItem(LS_THEME_KEY, nxt); } catch(_){}
    });
  }

  document.addEventListener('click', (e) => {
    if (!activeDetailId) return;
    if ($detail.contains(e.target)) return;
    if (e.target.closest('.card') || e.target.closest('.card-mini')) return;
    closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDetail(); closeMotorista(); closeDispatched(); }
  });

  setupMotoristaModal();

  // click em área vazia da sidebar (não num card) → mostra despachados
  $sidebarInner.addEventListener('click', (e) => {
    if (e.target.closest('.card-mini, .mini-wrap, .mini-note, .mini-note-close')) return;
    openDispatched();
  });
  // fechar com ESC ou click fora
  document.addEventListener('click', (e) => {
    const dm = document.getElementById('dispatched-modal');
    if (!dm || dm.hidden) return;
    if (dm.contains(e.target)) return;
    if (e.target.closest('.sidebar-inner, .sidebar-empty')) return;
    closeDispatched();
  });
  document.getElementById('dispatched-close')
    .addEventListener('click', closeDispatched);

  // restaurar LOCATIONS do localStorage antes do primeiro load
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const [k,v] of arr) LOCATIONS.set(k, v);
    }
  } catch (_) {}

  setupCrossTabSync();
  checkLunchOverlay();   // mostra "BORA ALMOÇAR" se já é a hora
  loadData()
    .then(() => pullRemoteState())
    .then(() => { startAllRefreshers(); });
}

/* Sincronização entre abas — quando user faz ação em uma aba, todas as
 * outras abas abertas refletem (drag, finalize, nota, tema, refresh).
 * Versão estendida: também sincroniza entre dispositivos diferentes via
 * Apps Script Web App (POST/GET ?action=state). */
const LS_SYNC_KEY = 'painel-galpao-sync-v1';
let remoteStateUpdatedAt = 0;
let pushTimer = null;

function broadcastSync(kind) {
  try { localStorage.setItem(LS_SYNC_KEY, `${kind}|${Date.now()}|${Math.random()}`); } catch(_){}
  schedulePushRemote();
}

async function pushRemoteState() {
  const url = (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS[0] : '') || '';
  if (!url.includes('script.google.com')) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        locations: Object.fromEntries(LOCATIONS),
        finished:  loadFinishedList(),
        notes:     Object.fromEntries(loadNotesMap()),
      })
    });
  } catch (err) {
    console.warn('[sync] push falhou:', err);
  }
}

function schedulePushRemote() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemoteState, 700);
}

async function pullRemoteState() {
  const url = (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS[0] : '') || '';
  if (!url.includes('script.google.com')) return;
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=state&_t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data.updatedAt !== 'number') return;
    if (data.updatedAt <= remoteStateUpdatedAt) return;
    remoteStateUpdatedAt = data.updatedAt;
    applyRemoteState(data);
  } catch (err) {
    console.warn('[sync] pull falhou:', err);
  }
}

function applyRemoteState(data) {
  if (data.locations) {
    LOCATIONS.clear();
    for (const [k,v] of Object.entries(data.locations)) LOCATIONS.set(k, v);
    persistLocations();
  }
  if (Array.isArray(data.finished)) {
    try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify(data.finished)); } catch(_){}
  }
  if (data.notes) {
    try { localStorage.setItem(LS_NOTES_KEY, JSON.stringify(data.notes)); } catch(_){}
  }
  renderAll();
  if (activeDetailId) openDetail(activeDetailId);
}

function setupCrossTabSync() {
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key === LS_KEY) {
      // posições mudaram em outra aba
      try {
        const arr = JSON.parse(e.newValue || '[]');
        LOCATIONS.clear();
        for (const [k,v] of arr) LOCATIONS.set(k, v);
        renderAll();
      } catch(_){}
    } else if (e.key === LS_FINISHED_KEY) {
      // alguém finalizou — recarrega tudo (pra remover do dataset)
      lastSignature = '';
      loadData(true);
    } else if (e.key === LS_NOTES_KEY) {
      // notas mudaram - se detail aberto, recarrega
      if (activeDetailId) openDetail(activeDetailId);
    } else if (e.key === LS_THEME_KEY) {
      applyTheme(e.newValue || 'night');
    } else if (e.key === LS_SYNC_KEY) {
      const kind = String(e.newValue || '').split('|')[0];
      if (kind === 'refresh') {
        lastSignature = '';
        loadData(true);
      }
    }
  });
}

function loadTheme() {
  try { return localStorage.getItem(LS_THEME_KEY) || 'night'; } catch(_){ return 'night'; }
}
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.textContent = theme === 'day' ? '☀' : '☾';
    btn.title = theme === 'day' ? 'Mudar pra modo NOITE' : 'Mudar pra modo DIA';
  }
}

document.addEventListener('DOMContentLoaded', init);
