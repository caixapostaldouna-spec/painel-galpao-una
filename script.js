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
const SHEET_CSV_URLS = [
  // Apps Script Web App que consolida TODAS as abas mensais automaticamente.
  // Quando você cria uma aba JUN 2026 / JUL 2026 / etc. na planilha, o
  // script já enxerga e o painel passa a mostrar — sem trocar essa URL.
  "https://script.google.com/macros/s/AKfycbxfRx6Alz5EOz-aUmMh3Q_8qX3RRnye4BAvDG8zqzYydUICBhqbu3UvyzOP0ly5BeMt/exec",
];

const FALLBACK_CSV = "dados.csv";

// Auto-refresh do CSV (ms). 0 desliga. 30s = bom equilíbrio.
const REFRESH_MS = 30000;

/* ---------- 2. CONSTANTES ----------------------------------------------- */

const MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

const COL = { PROJETO: 1, CONTATO: 3, PRAZO: 4, FORNECEDOR: 6, PROCESSO: 7 };

const FORNECEDORES_CONHECIDOS = ["MK","TG","IZ","XBZ","CRI"];

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

  // detecta mudança comparando assinatura conjunta
  const sig = texts.map(t => `${t.length}|${t.slice(0,40)}|${t.slice(-40)}`).join('::');
  if (silent && sig === lastSignature) {
    updateStamp();
    return;
  }
  lastSignature = sig;

  // parseia cada CSV e concatena as linhas (aplica filtro TORUN por aba)
  let rows = [];
  for (const text of texts) {
    rows = rows.concat(parseCSV(text));
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
    const date = prazoRaw ? parseDate(prazoRaw) : null;
    // se TEM data: precisa ser do mês corrente em diante. Sem data passa.
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
      projeto: projeto.toUpperCase(),
      contato: (r[COL.CONTATO] || '').trim(),
      date,
      fornecedores: parseFornecedores(r[COL.FORNECEDOR]),
      processos:    parseProcesso(r[COL.PROCESSO])
    });
  }
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

/* -- finalizados (somem pra sempre) ------------------------------------ */
function loadFinishedSet() {
  try {
    const raw = localStorage.getItem(LS_FINISHED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) { return new Set(); }
}
function markFinished(id) {
  const set = loadFinishedSet();
  set.add(id);
  try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify([...set])); } catch (_) {}
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

  // se o detail está aberto e o card sumiu, fechar
  if (activeDetailId && !RECORDS.has(activeDetailId)) closeDetail();
  // se mudou, atualiza miniatura
  if (activeDetailId) openDetail(activeDetailId);
}

function buildDateHTML(date) {
  const d = formatDate(date);
  if (!d) return `<span class="date-empty">—</span>`;
  return `${d.day}<span class="sep">|</span><span class="month">${d.month}</span>`;
}

function buildCardFull(rec) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = rec.id;
  card.draggable = true;

  const inner = document.createElement('div');
  inner.className = 'card-inner';
  if (!rec.date) inner.classList.add('no-date');

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = rec.projeto;

  const divider = document.createElement('div');
  divider.className = 'card-divider';

  const date = document.createElement('div');
  date.className = 'card-date';
  if (!rec.date) date.classList.add('is-empty');
  date.innerHTML = buildDateHTML(rec.date);

  const sup = document.createElement('div');
  const count = rec.fornecedores.length;
  sup.className = `card-suppliers count-${Math.min(Math.max(count,0),4)}`;
  if (count === 0) sup.style.visibility = 'hidden';
  else {
    for (const f of rec.fornecedores) {
      const s = document.createElement('div');
      s.className = `supplier ${supplierClass(f)}`;
      s.innerHTML = `${TSHIRT_SVG}<span class="sig">${escapeHTML(f)}</span>`;
      sup.appendChild(s);
    }
  }

  const proc = document.createElement('div');
  proc.className = 'card-process';
  for (const p of rec.processos) {
    const b = document.createElement('span');
    b.className = 'proc-btn';
    b.textContent = p;
    proc.appendChild(b);
  }

  inner.append(name, divider, date, sup, proc);
  card.appendChild(inner);
  attachCardHandlers(card);
  return card;
}

function buildCardMini(rec) {
  const card = document.createElement('div');
  card.className = 'card-mini';
  card.dataset.id = rec.id;
  card.draggable = true;

  const name = document.createElement('div');
  name.className = 'mini-name';
  name.textContent = rec.projeto;

  const div = document.createElement('div');
  div.className = 'mini-divider';

  const date = document.createElement('div');
  date.className = 'mini-date';
  if (!rec.date) date.classList.add('is-empty');
  date.innerHTML = buildDateHTML(rec.date);

  card.append(name, div, date);
  attachCardHandlers(card);
  return card;
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
    openDetail(card.dataset.id);
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
  if (!confirm(`Finalizar o trabalho "${rec.projeto}"?\n\nO card vai sumir do painel pra sempre (mesmo que continue na planilha).`)) return;
  markFinished(id);
  clearNoteFor(id);
  RECORDS.delete(id);
  LOCATIONS.delete(id);
  persistLocations();
  document.querySelectorAll(`[data-id="${cssEscape(id)}"]`).forEach(n => n.remove());
  if (activeDetailId === id) closeDetail();
  showToast(`"${rec.projeto}" FINALIZADO`, 2200);
  updateStamp();
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

  document
    .querySelectorAll(`[data-id="${cssEscape(id)}"]`)
    .forEach(n => n.remove());

  const rec = RECORDS.get(id);
  if (target === 'sidebar') $sidebarInner.appendChild(buildCardMini(rec));
  else                      $board.appendChild(buildCardFull(rec));

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
  const noteText = getNoteFor(id);
  $detailContent.innerHTML = `
    <div class="detail-text">
      <div class="detail-name">${escapeHTML(line1)}</div>
      ${line2 ? `<div class="detail-name">${escapeHTML(line2)}</div>` : ''}
      <div class="detail-contact-label">CONTATO</div>
      <div class="detail-contact">${escapeHTML(contato || '—')}</div>
    </div>
    <div class="detail-mini">
      <div class="detail-mini-inner">
        <div class="detail-mini-name">${escapeHTML(rec.projeto)}</div>
        <div class="detail-mini-divider"></div>
        <div class="detail-mini-date${rec.date ? '' : ' is-empty'}">${dateHTML}</div>
      </div>
    </div>
    <div class="detail-note">
      <div class="detail-note-label">OBSERVAÇÃO</div>
      <textarea class="detail-note-input" id="detail-note-input"
        placeholder="cole link, telefone, status..."
        rows="2">${escapeHTML(noteText)}</textarea>
    </div>
  `;
  $detail.classList.add('active');

  const $note = document.getElementById('detail-note-input');
  if ($note) {
    let noteTimer = null;
    $note.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => saveNoteFor(id, $note.value), 250);
    });
    // bloqueia eventos do board (dragstart, etc) enquanto digita
    $note.addEventListener('click', e => e.stopPropagation());
    $note.addEventListener('mousedown', e => e.stopPropagation());
  }
}

function closeDetail() {
  activeDetailId = null;
  $detail.classList.remove('active');
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

function updateStamp() {
  if (!$stamp) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  $stamp.textContent = `ATUALIZADO ${hh}:${mm}:${ss} · ${RECORDS.size} CARDS`;
}

/* ---------- 12. AUTO-REFRESH ------------------------------------------- */

function scheduleRefresh() {
  if (REFRESH_MS <= 0) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadData(true);
    scheduleRefresh();
  }, REFRESH_MS);
}

/* ---------- 13. INIT --------------------------------------------------- */

function init() {
  setupDropZone($board,   'board');
  setupDropZone($sidebar, 'sidebar');

  document.addEventListener('click', (e) => {
    if (!activeDetailId) return;
    if ($detail.contains(e.target)) return;
    if (e.target.closest('.card') || e.target.closest('.card-mini')) return;
    closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });

  // restaurar LOCATIONS do localStorage antes do primeiro load
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const [k,v] of arr) LOCATIONS.set(k, v);
    }
  } catch (_) {}

  loadData().then(() => scheduleRefresh());
}

document.addEventListener('DOMContentLoaded', init);
