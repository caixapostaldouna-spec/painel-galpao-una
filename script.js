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
// A segunda fonte é o CHAT DO UNA: os pedidos que a equipe move pra
// PRODUÇÃO lá aparecem aqui sozinhos, no mesmo formato de coluna da
// planilha (pedido do dono, 20/08). É o caminho pra planilha se aposentar:
// enquanto isso, as duas fontes convivem e o painel junta as duas.
const SHEET_CSV_URLS = [
  "https://script.google.com/macros/s/AKfycbyNLmiFQkfCmUqWAdc5dZ48JNgAQn58nth0myjAGcW5ASy5yLwFRENueFkvxvmqlf-ZRw/exec",
  "https://chat-galpaouna.vercel.app/api/producao/pedidos",
];

const FALLBACK_CSV = "dados.csv";

// Auto-refresh do CSV (ms). 0 desliga. 30s = bom equilíbrio.
const REFRESH_MS = 30000;

/* ---------- 2. CONSTANTES ----------------------------------------------- */

const MESES = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

const COL = { PROJETO: 1, CONTATO: 3, PRAZO: 4, FORNECEDOR: 6, PROCESSO: 7 };

const FORNECEDORES_CONHECIDOS = ["MK","TG","IZ","XBZ","CRI"];

// Recuo de dias úteis DESLIGADO (pedido do dono, 12/08/2026): o card mostra
// a data EXATA da planilha. Quem quiser outra data edita no próprio card
// (override manual continua valendo por cima). Pra religar, volte pra 2.
const BUSINESS_DAYS_BACK = 0;

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
const LS_FINISHED_KEY = 'painel-galpao-finished-v1';      // snapshots locais (só UI)
const LS_FINISHED_MAP_KEY = 'painel-galpao-finished-map-v1'; // id->{state,at} (sincronizado)
const LS_NOTES_KEY    = 'painel-galpao-notes-v1';
const LS_THEME_KEY    = 'painel-galpao-theme-v1';
const LS_SCALE_KEY    = 'painel-galpao-scale-v1';   // escala pessoal (A- / A+)
const LS_CSV_CACHE_KEY = 'painel-galpao-csv-cache-v1'; // última carga boa (abertura instantânea)
const LS_DATE_OVR_KEY = 'painel-galpao-date-overrides-v1';
const LS_ORDER_KEY    = 'painel-galpao-order-v1';
const LS_SIDE_ORDER_KEY = 'painel-galpao-sidebar-order-v1';

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

// Map<id, {day, month, year}> — datas editadas manualmente pelo usuario
// (sobrescreve a data calculada da planilha; persiste local + remoto)
const DATE_OVERRIDES = new Map();

// Map<id, number> — ordem manual definida via drag/drop (cards com order vao
// PRIMEIRO no board, ordenados por esse numero; depois vem os por data)
const MANUAL_ORDER = new Map();

// Map<id, number> — ordem manual na SIDEBAR (prontos). Menor numero = mais no topo.
// Cards COM nota sobem pro topo automaticamente (recebem numero baixo).
const SIDEBAR_ORDER = new Map();

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

/* Chave ESTÁVEL de identidade do trabalho, usada pra marcar "despachado".
 * Deriva de campos imutáveis (nome + contato + data do cliente), NÃO da
 * posição na lista. Assim o despacho não some quando o sufixo __N do id
 * posicional muda (2ª aba do mês, linha duplicada, reordenação na planilha).
 * O '#' separa os campos e nunca aparece no slug/data. */
function finishKey(projeto, contato, dateCliente) {
  const p = slugify(projeto);
  const c = contato ? slugify(contato) : '';
  const d = dateCliente ? `${dateCliente.year}-${dateCliente.month}-${dateCliente.day}` : '';
  return `${p}#${c}#${d}`;
}

/* ---------- 6. LOAD DATA ------------------------------------------------ */

/* Texto da última resposta BOA de cada fonte, guardado por índice.
 * Serve pra duas coisas: uma fonte que tropeça mantém os cards que já
 * estavam na tela (antes ela sumia da carga), e dá pra atualizar UMA fonte
 * sozinha — é o que faz a fonte do chat andar mais rápido que a planilha. */
let TEXTOS_POR_FONTE = [];
const fontesVivas = () => TEXTOS_POR_FONTE.filter(t => typeof t === 'string' && t);

function urlsAtivas() {
  return (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS : [])
    .map(u => (u || '').trim())
    .filter(Boolean);
}

async function baixarFonte(url) {
  const cb = `${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
  const res = await fetch(url + cb, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

let _loadNoAr = false;
async function loadData(silent = false) {
  if (_loadNoAr) return;          // ainda tem uma carga no ar — não empilha
  _loadNoAr = true;
  try { return await _loadData(silent); } finally { _loadNoAr = false; }
}
async function _loadData(silent = false) {
  const urls = urlsAtivas();
  const usingSheets = urls.length > 0;
  if (!silent) showToast(`CARREGANDO ${usingSheets ? `${urls.length} ABA(S) DO SHEETS` : "DADOS.CSV"}...`);

  let texts = [];
  try {
    if (usingSheets) {
      // Uma fonte fora do ar NÃO pode apagar o painel: pega o que respondeu
      // e segue. Só é falha de verdade quando TODAS caem (antes, com
      // Promise.all, um tropeço de qualquer fonte esvaziava a TV).
      const results = await Promise.allSettled(urls.map(baixarFonte));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') TEXTOS_POR_FONTE[i] = r.value;
        else console.warn('[Painel] fonte fora do ar:', urls[i], r.reason);
      });
      texts = fontesVivas();
      if (!texts.length) throw new Error('nenhuma fonte respondeu');
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

  // guarda a última carga boa: a PRÓXIMA abertura desenha na hora com ela
  try { localStorage.setItem(LS_CSV_CACHE_KEY, JSON.stringify(texts)); } catch (_) {}

  processTexts(texts, silent);
}

/* ---------- 6b. FONTE RÁPIDA (os pedidos do UNA CHAT) -------------------
 * Mover um pedido pra PRODUÇÃO no chat tem que acender o card aqui quase na
 * hora (pedido do dono, 20/08). Essa fonte é uma consulta leve nossa, então
 * ela é conferida a cada poucos segundos sozinha — a planilha, que é a
 * chamada pesada, continua no ritmo dela. */
const FONTE_RAPIDA_MS = 4000;
const EH_FONTE_RAPIDA = /\/api\/producao\/pedidos/;

let _rapidaNoAr = false;
async function refrescarFonteRapida() {
  if (_rapidaNoAr || !fontesVivas().length) return;   // espera a 1ª carga cheia
  const urls = urlsAtivas();
  const i = urls.findIndex(u => EH_FONTE_RAPIDA.test(u));
  if (i < 0) return;
  _rapidaNoAr = true;
  try {
    const txt = await baixarFonte(urls[i]);
    if (txt !== TEXTOS_POR_FONTE[i]) {
      TEXTOS_POR_FONTE[i] = txt;
      processTexts(fontesVivas(), true);   // só redesenha se o hash mudou
    }
  } catch (err) {
    console.warn('[Painel] fonte rápida fora do ar:', err);
  } finally {
    _rapidaNoAr = false;
  }
}

/* Abertura INSTANTÂNEA: desenha já com a última carga guardada no aparelho,
 * enquanto a busca de verdade acontece por trás (que redesenha se mudou). */
function renderFromCache() {
  try {
    const raw = localStorage.getItem(LS_CSV_CACHE_KEY);
    if (!raw) return false;
    const texts = JSON.parse(raw);
    if (!Array.isArray(texts) || !texts.length) return false;
    processTexts(texts, true);
    return true;
  } catch (_) { return false; }
}

function processTexts(texts, silent) {
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

  // migra dados gravados com o id posicional antigo pro id estável novo
  migrateLegacyKeys(records);

  // preserva o LOCATIONS dos cards que ainda existem
  const prevLocs = restoreLocations(); // ou usa LOCATIONS atual
  RECORDS.clear();
  LOCATIONS.clear();
  for (const r of records) {
    RECORDS.set(r.id, r);
    const loc = prevLocs.get(r.id) || prevLocs.get(r.legacyId);
    LOCATIONS.set(r.id, loc === 'sidebar' ? 'sidebar' : 'board');
    // recalcula a data exibida considerando location + override manual
    r.date = computeDisplayDate(r, LOCATIONS.get(r.id));
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

  // 2) NÃO descarta mais por mês — só some do painel quando o usuário
  //    despachar manualmente (duplo clique no card da sidebar).

  const finished = loadFinishedSet();
  const out = [];
  const used = new Map();        // finishKey -> count (id estável)
  const usedLegacy = new Map();  // slug -> count (id posicional antigo, só migração)
  for (const r of slice) {
    const projeto = (r[COL.PROJETO] || '').trim();
    if (!projeto) continue;
    // linha de cabeçalho não vira card (protege quando a linha TORUN some)
    if (/^PROJETO$/i.test(projeto)) continue;

    const contato = (r[COL.CONTATO] || '').trim();
    const prazoRaw = (r[COL.PRAZO] || '').trim();
    const dateCliente = prazoRaw ? parseDate(prazoRaw) : null;
    // recua 2 dias úteis pra dar margem de produção
    const date = dateCliente ? shiftBusinessDays(dateCliente, -BUSINESS_DAYS_BACK) : null;

    // chave ESTÁVEL por identidade (nome + contato + data do cliente) —
    // imune a deslocamento de linha na planilha.
    const fkey = finishKey(projeto, contato, dateCliente);

    // id AGORA é a própria chave estável (~N só pra linhas 100% idênticas).
    // Assim notas/posições/ordem/datas nunca mais "pulam" pra outro card
    // quando uma linha nova entra na planilha e desloca as demais.
    const count = used.get(fkey) || 0;
    used.set(fkey, count + 1);
    const id = count > 0 ? `${fkey}~${count}` : fkey;

    // id posicional ANTIGO (slug__N) — só pra migrar dados já gravados
    // (notas/posições/ordem) pro id estável na primeira carga.
    const slug = slugify(projeto);
    const lcount = usedLegacy.get(slug) || 0;
    usedLegacy.set(slug, lcount + 1);
    const legacyId = lcount > 0 ? `${slug}__${lcount}` : slug;

    // despachado se bater pela chave estável OU pelo id legado (despachos
    // antigos, gravados antes desta correção, continuam valendo).
    if (finished.has(fkey) || finished.has(legacyId)) continue;

    out.push({
      id,
      legacyId,                                 // só pra migração de dados antigos
      finishKey: fkey,                          // identidade estável p/ despacho
      projeto: shortName(projeto.toUpperCase(), 15),
      projetoFull: projeto.toUpperCase(),       // nome inteiro pro painel de detalhe
      contato,
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
 * DUAS estruturas, de propósito:
 *
 *  1) FINISHED_MAP  →  id -> { state:'out'|'in', at:timestamp }
 *     É a VERDADE pro filtro e pro sync.
 *       'out' = despachado (some do painel)
 *       'in'  = restaurado  (volta pro painel)  ← lápide com timestamp
 *     Merge entre dispositivos é por TIMESTAMP (o mais recente vence). Assim,
 *     um push velho de outro aparelho NUNCA mais ressuscita um despacho novo,
 *     e o restaurar também propaga certo. Fica local SEM limite — o aparelho
 *     nunca esquece o que ele mesmo despachou.
 *
 *  2) snapshots (LS_FINISHED_KEY) → lista local com os dados completos de cada
 *     card, só pra UI "despachados recentes". NÃO é mandada pesada pro sync. */

function loadFinishedMap() {
  try {
    const raw = localStorage.getItem(LS_FINISHED_MAP_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      const m = new Map();
      for (const [id, v] of Object.entries(obj || {})) {
        if (v && (v.state === 'out' || v.state === 'in')) {
          m.set(id, { state: v.state, at: Number(v.at) || 0 });
        }
      }
      return m;
    }
  } catch (_) {}
  // migração: constrói o map a partir dos snapshots antigos (tudo 'out')
  const m = new Map();
  for (const f of loadFinishedList()) {
    if (f && f.id) m.set(f.id, { state: 'out', at: Number(f.finishedAt) || 1 });
  }
  if (m.size) persistFinishedMap(m);
  return m;
}
function persistFinishedMap(m) {
  try { localStorage.setItem(LS_FINISHED_MAP_KEY, JSON.stringify(Object.fromEntries(m))); } catch (_) {}
}
// normaliza o que vier do remoto: aceita o map novo {id:{state,at}} OU o
// formato antigo (array de strings, ou array de snapshots {id, finishedAt}).
function normalizeFinishedRemote(data) {
  const m = new Map();
  if (!data) return m;
  if (Array.isArray(data)) {
    for (const it of data) {
      if (typeof it === 'string') m.set(it, { state: 'out', at: 1 });
      else if (it && it.id) m.set(it.id, { state: 'out', at: Number(it.finishedAt) || 1 });
    }
  } else if (typeof data === 'object') {
    for (const [id, v] of Object.entries(data)) {
      if (v && (v.state === 'out' || v.state === 'in')) m.set(id, { state: v.state, at: Number(v.at) || 0 });
      else m.set(id, { state: 'out', at: 1 });   // tolerante a formatos estranhos
    }
  }
  return m;
}
// merge remoto -> local por timestamp (mais novo vence). Em EMPATE de timestamp,
// 'out' (despachado) vence 'in' (restaurado) — re-despachar nunca perde pra um
// restore antigo, e a colisão em at:1 (migrados/normalizados) não ressuscita.
// Retorna true se mudou.
function mergeFinishedRemote(data) {
  const remote = normalizeFinishedRemote(data);
  if (!remote.size) return false;
  const local = loadFinishedMap();
  let changed = false;
  for (const [id, rv] of remote) {
    const lv = local.get(id);
    const win = !lv
      || rv.at > lv.at
      || (rv.at === lv.at && rv.state === 'out' && lv.state !== 'out');
    if (win) { local.set(id, rv); changed = true; }
  }
  if (changed) persistFinishedMap(local);
  return changed;
}

function loadFinishedList() {
  try {
    const raw = localStorage.getItem(LS_FINISHED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // back-compat: versão bem antiga guardava só array de strings
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map(id => ({ id, finishedAt: 0 }));
    }
    return parsed;
  } catch (_) { return []; }
}
// conjunto de ids ATUALMENTE despachados ('out') — usado pelo filtro do CSV.
function loadFinishedSet() {
  const s = new Set();
  for (const [id, v] of loadFinishedMap()) if (v.state === 'out') s.add(id);
  return s;
}
// chave de despacho de um record: a estável (finishKey) com fallback pro id
function keyOf(rec) { return (rec && rec.finishKey) || (rec && rec.id) || ''; }

function markFinished(rec) {
  const key = keyOf(rec);
  if (!key) return;
  // 1) marca no map pela chave ESTÁVEL (verdade pro filtro/sync) com timestamp
  const m = loadFinishedMap();
  m.set(key, { state: 'out', at: Date.now() });
  persistFinishedMap(m);
  // 2) guarda snapshot local pra UI de despachados (cap generoso, só local)
  const list = loadFinishedList().filter(f => (f.finishKey || f.id) !== key);
  list.unshift({
    id: rec.id,
    finishKey: key,
    projeto: rec.projeto,
    projetoFull: rec.projetoFull,
    contato: rec.contato,
    date: rec.date,
    dateCliente: rec.dateCliente,
    fornecedores: rec.fornecedores,
    processos: rec.processos,
    finishedAt: Date.now()
  });
  if (list.length > 120) list.length = 120;
  try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify(list)); } catch (_) {}
  schedulePushRemote();
  // 3) grava DESPACHADO na coluna J da PLANILHA — verdade definitiva.
  //    O servidor filtra a linha na origem; imune a poda de lápide, device
  //    novo e edição de data. Se falhar (offline), a lápide local segura.
  postDispatchAction('dispatch', key);
}

// POST fire-and-forget pro Apps Script marcar/limpar a coluna J na planilha
function postDispatchAction(action, key) {
  const url = (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS[0] : '') || '';
  if (!url.includes('script.google.com') || !key) return Promise.resolve();
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, jobs: [{ key }] })
  }).catch(err => console.warn(`[sync] ${action} na planilha falhou:`, err));
}
// restaurar = lápide 'in' com timestamp novo (vence o 'out' antigo no merge).
// Recebe a chave estável E o id legado, e marca 'in' nos dois (cobre despachos
// gravados antes da correção, que estavam keyed pelo id posicional).
function unmarkFinished(key, legacyId) {
  const m = loadFinishedMap();
  const now = Date.now();
  if (key) m.set(key, { state: 'in', at: now });
  if (legacyId && legacyId !== key) m.set(legacyId, { state: 'in', at: now });
  persistFinishedMap(m);
  const list = loadFinishedList().filter(f => (f.finishKey || f.id) !== key && f.id !== legacyId);
  try { localStorage.setItem(LS_FINISHED_KEY, JSON.stringify(list)); } catch (_) {}
  schedulePushRemote();
  // limpar a marca DESPACHADO na planilha fica a cargo de restoreCard (que
  // AGUARDA o POST antes de recarregar o CSV — senão a linha ainda vem filtrada)
}

/* -- notas por card ------------------------------------------------------
 * Formato NOVO: id -> { html, at }.  `at` = timestamp da última edição.
 * html vazio = TOMBSTONE de deleção — apagar uma nota propaga a deleção
 * pros outros devices e ela NUNCA mais ressuscita via sync (antes o pull
 * remoto re-aplicava a nota deletada 10s depois).
 * Back-compat: string antiga vira { html, at: 1 } (qualquer edição vence). */
function loadNotesMap() {
  try {
    const raw = localStorage.getItem(LS_NOTES_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) || {};
    const m = new Map();
    for (const [id, v] of Object.entries(obj)) {
      if (typeof v === 'string') m.set(id, { html: v, at: 1 });
      else if (v && typeof v === 'object') m.set(id, { html: String(v.html || ''), at: Number(v.at) || 0 });
    }
    return m;
  } catch (_) { return new Map(); }
}
function persistNotesMap(m) {
  try { localStorage.setItem(LS_NOTES_KEY, JSON.stringify(Object.fromEntries(m))); } catch(_){}
}
function saveNoteFor(id, text) {
  const m = loadNotesMap();
  // texto vazio vira tombstone (não delete) — deleção precisa sincronizar
  m.set(id, { html: (text && text.trim()) ? text : '', at: Date.now() });
  persistNotesMap(m);
  schedulePushRemote();
}
function getNoteFor(id) {
  const v = loadNotesMap().get(id);
  return (v && v.html) || '';
}
function clearNoteFor(id) {
  saveNoteFor(id, '');   // tombstone + push (deleção propaga pros devices)
}

/* -- DATE_OVERRIDES (datas editadas manualmente) ----------------------- */
function loadDateOverrides() {
  try {
    const raw = localStorage.getItem(LS_DATE_OVR_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    DATE_OVERRIDES.clear();
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && Number.isInteger(v.day)) DATE_OVERRIDES.set(k, v);
    }
  } catch (_) {}
}
function persistDateOverrides() {
  try {
    localStorage.setItem(LS_DATE_OVR_KEY, JSON.stringify(Object.fromEntries(DATE_OVERRIDES)));
  } catch (_) {}
}
function setDateOverride(id, dateObj) {
  if (dateObj) DATE_OVERRIDES.set(id, dateObj);
  else DATE_OVERRIDES.delete(id);
  persistDateOverrides();
  schedulePushRemote();
}

/* -- MANUAL_ORDER (ordem manual via drag entre cards) ------------------ */
function loadManualOrder() {
  try {
    const raw = localStorage.getItem(LS_ORDER_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    MANUAL_ORDER.clear();
    for (const [k, v] of Object.entries(obj || {})) {
      if (Number.isFinite(v)) MANUAL_ORDER.set(k, Number(v));
    }
  } catch (_) {}
}
function persistManualOrder() {
  try {
    localStorage.setItem(LS_ORDER_KEY, JSON.stringify(Object.fromEntries(MANUAL_ORDER)));
  } catch (_) {}
}

/* -- SIDEBAR_ORDER (ordem manual na sidebar / prontos) ----------------- */
function loadSidebarOrder() {
  try {
    const raw = localStorage.getItem(LS_SIDE_ORDER_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    SIDEBAR_ORDER.clear();
    for (const [k, v] of Object.entries(obj || {})) {
      if (Number.isFinite(v)) SIDEBAR_ORDER.set(k, Number(v));
    }
  } catch (_) {}
}
function persistSidebarOrder() {
  try {
    localStorage.setItem(LS_SIDE_ORDER_KEY, JSON.stringify(Object.fromEntries(SIDEBAR_ORDER)));
  } catch (_) {}
}
/* -- MIGRAÇÃO id posicional (slug__N) -> id estável (finishKey) ---------
 * Roda a cada carga: se algum dado (nota/data/ordem) ainda estiver keyed
 * pelo id antigo, copia pro id novo e apaga o antigo. Idempotente. */
function migrateLegacyKeys(records) {
  let notes = null;
  let touched = false;
  for (const r of records) {
    if (!r.legacyId || r.legacyId === r.id) continue;
    for (const map of [DATE_OVERRIDES, MANUAL_ORDER, SIDEBAR_ORDER]) {
      if (map.has(r.legacyId)) {
        if (!map.has(r.id)) map.set(r.id, map.get(r.legacyId));
        map.delete(r.legacyId);
        touched = true;
      }
    }
    if (notes === null) notes = loadNotesMap();
    if (notes.has(r.legacyId)) {
      if (!notes.has(r.id)) notes.set(r.id, notes.get(r.legacyId));
      notes.delete(r.legacyId);
      touched = true;
    }
  }
  if (touched) {
    persistDateOverrides();
    persistManualOrder();
    persistSidebarOrder();
    if (notes) persistNotesMap(notes);
  }
}

// joga um card pro topo da sidebar (numero menor que todos os atuais)
function bumpSidebarToTop(id) {
  let min = 0;
  for (const v of SIDEBAR_ORDER.values()) if (v < min) min = v;
  SIDEBAR_ORDER.set(id, min - 1);
  persistSidebarOrder();
  schedulePushRemote();
}
// reordena a sidebar inteira pela ordem atual do DOM (1..N)
function reorderSidebarBeforeCard(draggedId, targetId) {
  if (draggedId === targetId) return;
  const orderedIds = [...$sidebarInner.querySelectorAll('.mini-wrap[data-id]')].map(w => w.dataset.id);
  const fromIdx = orderedIds.indexOf(draggedId);
  if (fromIdx < 0) return;
  orderedIds.splice(fromIdx, 1);
  const toIdx = orderedIds.indexOf(targetId);
  if (toIdx < 0) return;
  orderedIds.splice(toIdx, 0, draggedId);
  orderedIds.forEach((id, i) => SIDEBAR_ORDER.set(id, i + 1));
  persistSidebarOrder();
  schedulePushRemote();
  renderAll();
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
  // limpa wrappers da sidebar (cada mini-wrap segura um .card-mini + a etiqueta de nota)
  [...$sidebarInner.querySelectorAll('.mini-wrap, .card-mini')].forEach(n => n.remove());

  // separa em board / sidebar
  const boardRecs = [];
  const sidebarRecs = [];
  for (const [id, rec] of RECORDS) {
    const loc = LOCATIONS.get(id);
    if (loc === 'sidebar') sidebarRecs.push(rec);
    else                   boardRecs.push(rec);
  }

  // BOARD: cards com MANUAL_ORDER vao primeiro (na ordem definida pelo user).
  // Depois, os sem ordem manual seguem por data crescente (como antes).
  boardRecs.sort((a, b) => {
    const aHasOrder = MANUAL_ORDER.has(a.id);
    const bHasOrder = MANUAL_ORDER.has(b.id);
    if (aHasOrder && bHasOrder)  return MANUAL_ORDER.get(a.id) - MANUAL_ORDER.get(b.id);
    if (aHasOrder && !bHasOrder) return -1;
    if (!aHasOrder && bHasOrder) return 1;
    const aT = a.date ? a.date.year * 10000 + a.date.month * 100 + a.date.day : Infinity;
    const bT = b.date ? b.date.year * 10000 + b.date.month * 100 + b.date.day : Infinity;
    return aT - bT;
  });
  for (const rec of boardRecs) $board.appendChild(buildCardFull(rec));

  // SIDEBAR (prontos):
  //   1) cards com ORDEM MANUAL (SIDEBAR_ORDER) vao primeiro, por numero (topo).
  //   2) sem ordem manual: cards COM NOTA sobem pro topo (relevância: motoboy
  //      chegando), depois os sem nota na ordem que chegaram.
  const notesMap = loadNotesMap();
  // nota "de verdade" = html não-vazio (tombstone de deleção não conta)
  const hasNote = (id) => { const v = notesMap.get(id); return !!(v && v.html && v.html.trim()); };
  sidebarRecs.sort((a, b) => {
    const aO = SIDEBAR_ORDER.has(a.id);
    const bO = SIDEBAR_ORDER.has(b.id);
    if (aO && bO) return SIDEBAR_ORDER.get(a.id) - SIDEBAR_ORDER.get(b.id);
    if (aO) return -1;
    if (bO) return 1;
    const aN = hasNote(a.id) ? 0 : 1;   // nota = 0 → sobe
    const bN = hasNote(b.id) ? 0 : 1;
    return aN - bN;
  });
  for (const rec of sidebarRecs) $sidebarInner.appendChild(buildCardMini(rec));

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

  const targetCardW = 260;
  const minCardW    = 170;
  const minCardH    = 84;
  const maxCardH    = 190;

  // 1) determinar linhas FIXAS que cabem na altura disponível
  //    cards menores → mais linhas; sempre dentro de min/max
  const targetRowH = 148;
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
  // dia GRANDE + "/MM" pequeno — ganha espaço horizontal e vertical no card
  const mm = String(date.month + 1).padStart(2, '0');
  return `${d.day}<span class="date-mm">/${mm}</span>`;
}

/* Habilita edicao inline da data do card. Click abre input; Enter ou blur
 * comita; Esc cancela. Limpar e dar Enter remove o override (volta pra data
 * calculada da planilha). */
function enableDateEditing(dateEl, rec) {
  dateEl.classList.add('is-editable');
  dateEl.title = 'Clique pra editar · Enter salva · vazio + Enter volta pra planilha';
  dateEl.addEventListener('mousedown', (e) => {
    // impede dragstart quando user vai editar a data
    e.stopPropagation();
  });
  dateEl.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openDateEditor(dateEl, rec);
  });
}

/* Aceita o que a pessoa digitar com pressa: "15", "1509", "150926",
 * "15/09", "15-9", "15.09.2026"… A barra é opcional. */
function parseDataFlexivel(txt) {
  const t = String(txt || '').trim();
  if (!t) return null;
  const so = t.replace(/\D/g, '');
  // só dígitos (sem separador): deduz DD / DDMM / DDMMAA / DDMMAAAA
  if (so && so === t) {
    const now = new Date();
    let day, month = now.getMonth(), year = now.getFullYear();
    if (so.length <= 2)      { day = +so; }
    else if (so.length === 3){ day = +so.slice(0, 1); month = +so.slice(1) - 1; }
    else if (so.length === 4){ day = +so.slice(0, 2); month = +so.slice(2) - 1; }
    else if (so.length === 6){ day = +so.slice(0, 2); month = +so.slice(2, 4) - 1; year = 2000 + +so.slice(4); }
    else if (so.length === 8){ day = +so.slice(0, 2); month = +so.slice(2, 4) - 1; year = +so.slice(4); }
    else return null;
    if (day < 1 || day > 31 || month < 0 || month > 11) return null;
    return { day, month, year };
  }
  return parseDate(t);
}

function openDateEditor(dateEl, rec) {
  if (dateEl.querySelector('input.date-inline-input')) return; // ja em edicao
  const cur = rec.date
    ? `${String(rec.date.day).padStart(2,'0')}/${String(rec.date.month + 1).padStart(2,'0')}`
    : '';
  const originalHTML = dateEl.innerHTML;
  const originalEmpty = dateEl.classList.contains('is-empty');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'date-inline-input';
  input.value = cur;
  input.placeholder = 'DD/MM';
  input.maxLength = 10;

  dateEl.innerHTML = '';
  dateEl.classList.remove('is-empty');
  dateEl.appendChild(input);
  // selecionar tudo facilita digitar nova data
  setTimeout(() => { input.focus(); input.select(); }, 0);

  // a barra entra SOZINHA: digitou "1509" e aparece "15/09"
  input.addEventListener('input', () => {
    const v = input.value;
    if (!v.includes('/') && /^\d{3,}$/.test(v)) {
      const so = v.replace(/\D/g, '');
      input.value = so.slice(0, 2) + '/' + so.slice(2, 4) + (so.length > 4 ? '/' + so.slice(4, 8) : '');
    }
  });

  let committed = false;
  const restore = () => {
    dateEl.innerHTML = originalHTML;
    if (originalEmpty) dateEl.classList.add('is-empty');
  };
  const commit = () => {
    if (committed) return;
    committed = true;
    const txt = input.value.trim();
    if (!txt) {
      // limpa override → volta pra data calculada da planilha
      setDateOverride(rec.id, null);
      rec.date = computeDisplayDate(rec, LOCATIONS.get(rec.id) || 'board');
      renderAll();
      return;
    }
    const parsed = parseDataFlexivel(txt);
    if (!parsed) {
      // não entendi: avisa em vez de descartar calado
      showToast('DATA INVÁLIDA — USE DIA/MÊS (EX.: 15/09)', 2600);
      restore();
      return;
    }
    setDateOverride(rec.id, parsed);
    rec.date = parsed;
    renderAll();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { committed = true; restore(); }
  });
  input.addEventListener('blur', commit);
  // bloqueia drag do card enquanto edita
  input.addEventListener('dragstart', (e) => e.preventDefault());
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
  enableDateEditing(date, rec);

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
  enableDateEditing(date, rec);

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
  tag.title = 'Duplo clique pra apagar';
  // sem rótulo de texto — só o corpo da nota, pra aproveitar todo o espaço
  tag.innerHTML = `<div class="mini-note-body">${noteHTML}</div>`;
  // duplo clique na etiqueta inteira → confirma e apaga
  tag.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const cardId = tag.dataset.id || tag.closest('.mini-wrap')?.dataset.id;
    if (!cardId) return;
    if (!confirm('Apagar essa nota?')) return;
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
    // começou o gesto em cima da data (ou do editor)? é clique de edição,
    // não arrasto — sem isso qualquer tremidinha do mouse virava drag
    if (e.target && e.target.closest && e.target.closest('.card-date, .date-inline-input')) {
      e.preventDefault();
      return;
    }
    draggedId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggedId); } catch (_) {}
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    $board.classList.remove('drop-active');
    $sidebar.classList.remove('drop-active');
    document.querySelectorAll('.card.drop-before').forEach(n => n.classList.remove('drop-before'));
    draggedId = null;
  });

  // Drop em cima de outro card no BOARD: reordena (insere o draggado ANTES deste).
  // So funciona pra card-full do board (sidebar tem outra logica de ordem).
  if (!card.classList.contains('card-mini')) {
    card.addEventListener('dragover', (e) => {
      if (!draggedId || draggedId === card.dataset.id) return;
      const dragRec = RECORDS.get(draggedId);
      if (!dragRec) return;
      // so reordena se ambos estao no board
      if (LOCATIONS.get(draggedId) !== 'board') return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drop-before');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-before');
    });
    card.addEventListener('drop', (e) => {
      card.classList.remove('drop-before');
      if (!draggedId || draggedId === card.dataset.id) return;
      if (LOCATIONS.get(draggedId) !== 'board') return;
      e.preventDefault();
      e.stopPropagation();
      reorderBeforeCard(draggedId, card.dataset.id);
    });
  } else {
    // CARD-MINI (sidebar / prontos): drop em cima de outro mini reordena
    // (sobe/desce). So vale se o card arrastado ja estiver na sidebar.
    card.addEventListener('dragover', (e) => {
      if (!draggedId || draggedId === card.dataset.id) return;
      if (LOCATIONS.get(draggedId) !== 'sidebar') return;  // board→sidebar deixa pro drop-zone
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drop-before');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-before');
    });
    card.addEventListener('drop', (e) => {
      card.classList.remove('drop-before');
      if (!draggedId || draggedId === card.dataset.id) return;
      if (LOCATIONS.get(draggedId) !== 'sidebar') return;
      e.preventDefault();
      e.stopPropagation();
      reorderSidebarBeforeCard(draggedId, card.dataset.id);
    });
  }
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.classList.contains('card-mini')) {
      // card da sidebar → abre NOTAS DO MOTORISTA (com paste de imagem/texto)
      openMotorista(card.dataset.id);
    }
    // card-full do board nao abre mais detail panel (user pediu pra remover)
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
  if (SIDEBAR_ORDER.has(id)) { SIDEBAR_ORDER.delete(id); persistSidebarOrder(); }
  if (MANUAL_ORDER.has(id))  { MANUAL_ORDER.delete(id);  persistManualOrder();  }
  persistLocations();
  document.querySelectorAll(`.mini-wrap[data-id="${cssEscape(id)}"], .card-mini[data-id="${cssEscape(id)}"], .card[data-id="${cssEscape(id)}"]`).forEach(n => n.remove());
  if (activeDetailId === id) closeDetail();
  showToast(`"${rec.projeto}" DESPACHADO`, 2200);
  updateStamp();
}

async function restoreCard(key, legacyId) {
  unmarkFinished(key, legacyId);
  showToast('RESTAURANDO...', 2500);
  // AGUARDA limpar a marca na planilha ANTES de recarregar o CSV —
  // senão o servidor ainda devolve a linha filtrada e o card não volta.
  try { await postDispatchAction('restore', key); } catch (_) {}
  lastSignature = '';   // força re-fetch
  await loadData(false);
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

/* Reordena dois cards no board: insere `draggedId` ANTES de `targetId`.
 * Atribui MANUAL_ORDER pra todos os cards do board com base na ordem
 * resultante no DOM (sao numeros inteiros sequenciais 1..N). */
function reorderBeforeCard(draggedId, targetId) {
  if (draggedId === targetId) return;
  // Pega a ordem atual dos cards do board no DOM
  const orderedIds = [...$board.querySelectorAll('.card[data-id]')].map(c => c.dataset.id);
  const fromIdx = orderedIds.indexOf(draggedId);
  const toIdx   = orderedIds.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  // remove e re-insere antes do target
  orderedIds.splice(fromIdx, 1);
  const newTargetIdx = orderedIds.indexOf(targetId);
  orderedIds.splice(newTargetIdx, 0, draggedId);
  // atualiza MANUAL_ORDER pra TODOS os cards do board (preserva visivel)
  orderedIds.forEach((id, i) => MANUAL_ORDER.set(id, i + 1));
  persistManualOrder();
  schedulePushRemote();
  renderAll();
}

function moveCard(id, target) {
  if (!RECORDS.has(id)) return;
  const current = LOCATIONS.get(id);
  if (current === target) return;
  LOCATIONS.set(id, target);
  persistLocations();

  // ajusta a data exibida pelo location, respeitando override manual se houver
  const rec = RECORDS.get(id);
  rec.date = computeDisplayDate(rec, target);

  // quando sai do board pra sidebar, descarta a ordem manual do board desse
  // card — se voltar pro board mais tarde ele entra de novo pela ordem por data.
  if (target === 'sidebar' && MANUAL_ORDER.has(id)) {
    MANUAL_ORDER.delete(id);
    persistManualOrder();
  }
  // quando sai da sidebar pro board, descarta a ordem manual da sidebar.
  if (target === 'board' && SIDEBAR_ORDER.has(id)) {
    SIDEBAR_ORDER.delete(id);
    persistSidebarOrder();
  }

  schedulePushRemote();

  // re-renderiza tudo (re-sorta board por data/ordem e sidebar por nota/ordem)
  renderAll();
}

/* Calcula a data que deve aparecer no card baseado em:
 *   - override manual (DATE_OVERRIDES) tem prioridade
 *   - sidebar  → data real do cliente (sem -2 d.u.)
 *   - board    → data com -BUSINESS_DAYS_BACK dias uteis (margem de producao) */
function computeDisplayDate(rec, location) {
  if (DATE_OVERRIDES.has(rec.id)) return DATE_OVERRIDES.get(rec.id);
  if (!rec.dateCliente) return null;
  if (location === 'sidebar') return rec.dateCliente;
  return shiftBusinessDays(rec.dateCliente, -BUSINESS_DAYS_BACK);
}

function cssEscape(s) {
  return String(s).replace(/(["\\\[\]])/g, '\\$1');
}

/* ---------- 10. DETAIL PANEL ------------------------------------------- */

// openDetail/closeDetail: detail panel removido — funcoes mantidas como no-op
// pra nao quebrar referencias antigas (renderAll, applyRemoteState, cross-tab sync)
function openDetail(_id) { /* detail panel desativado */ }
function closeDetail()   { activeDetailId = null; }

/* ---------- MODAL NOTAS DO MOTORISTA ---------------------------------
 * Aberto ao clicar num card da sidebar.
 * Aceita CTRL+V de imagem OU texto (texto vira CAIXA ALTA).
 * Conteúdo salvo em LS_NOTES_KEY por id do card (compartilha com o detail).
 */
let activeMotoristaId = null;
let motoristaLoading  = false;     // flag pra evitar salvar durante openMotorista

function openMotorista(id) {
  const rec = RECORDS.get(id);
  if (!rec) return;
  // bloqueia listeners até o conteúdo carregar
  motoristaLoading = true;
  activeMotoristaId = id;
  const modal   = document.getElementById('motorista-modal');
  const content = document.getElementById('motorista-content');
  const title   = document.getElementById('motorista-title');
  title.textContent = (rec.projetoFull || rec.projeto) + ' — NOTAS PARA O MOTORISTA';
  content.innerHTML = getNoteFor(id) || '';
  modal.removeAttribute('hidden');
  // posicao agora eh fixa no rodape (CSS), nao depende do card
  setTimeout(() => {
    content.focus();
    motoristaLoading = false;
  }, 150);
}

// Commit do popover — chamado ao Enter. Salva, fecha, e desce o card pro fim da lista.
function commitMotorista() {
  if (!activeMotoristaId) return;
  const id = activeMotoristaId;
  const content = document.getElementById('motorista-content');
  let hasNote = false;
  if (content) {
    const html = content.innerHTML;
    if (html && html.trim()) {
      saveNoteFor(id, html);
      hasNote = true;
    }
  }
  // card com nota SOBE pro topo da sidebar (relevância: tem motoboy chegando)
  if (hasNote && LOCATIONS.get(id) === 'sidebar') {
    bumpSidebarToTop(id);
  }
  closeMotorista();
  renderAll();   // re-sorta e redesenha (etiqueta + posição no topo)
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

  const fmap = loadFinishedMap();
  const items = loadFinishedList()
    .filter(it => { const v = fmap.get(it.finishKey || it.id); return v && v.state === 'out'; })
    .slice()
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, 15);

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
        <button class="dispatched-restore" data-key="${escapeHTML(it.finishKey || it.id || '')}" data-id="${escapeHTML(it.id || '')}">↻ RESTAURAR</button>
      `;
      list.appendChild(el);
    }
    list.querySelectorAll('.dispatched-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreCard(btn.dataset.key, btn.dataset.id);
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
  // Enter (sem Shift) commita: salva, desce o card pro fim da lista e fecha o popover.
  // Shift+Enter mantém quebra de linha normal.
  content.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitMotorista();
    }
  });

  // CTRL+V — captura imagem ou texto, salva como HTML em LS_NOTES_KEY
  content.addEventListener('paste', async (e) => {
    e.preventDefault();
    if (!activeMotoristaId || motoristaLoading) return;
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
    if (!activeMotoristaId || motoristaLoading) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!activeMotoristaId || motoristaLoading) return;
      saveNoteFor(activeMotoristaId, content.innerHTML);
      refreshMiniNoteTag(activeMotoristaId, content.innerHTML);
    }, 350);
  });
}

// atualiza/cria/remove a etiqueta-nota abaixo do card-mini correspondente
// (varre todos os wraps com esse id por garantia — em teoria so existe um,
//  mas se algo no DOM ficar duplicado a gente apaga em todos)
function refreshMiniNoteTag(id, html) {
  const wraps = document.querySelectorAll(`.mini-wrap[data-id="${cssEscape(id)}"]`);
  if (!wraps.length) return;
  wraps.forEach(wrap => {
    const existing = wrap.querySelector('.mini-note');
    if (existing) existing.remove();
    if (html && html.trim()) wrap.appendChild(buildMiniNoteTag(html, id));
  });
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

// (setInterval do checkLunchOverlay agora vive só dentro de startAllRefreshers)

function updateStamp() {
  if (!$stamp) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  $stamp.textContent = `${hh}:${mm}`;
}

// relógio ticando a cada minuto (e certo já na abertura — antes
// ficava "--:--" até o primeiro tique de 60s)
updateStamp();
setInterval(updateStamp, 60000);

/* ---------- 12. AUTO-REFRESH ------------------------------------------- */

/* ----- AUTO-REFRESH em 3 camadas (resiliente) -----------------------
 *  10s: state sync entre dispositivos
 *  30s: check rápido do CSV (só re-renderiza se hash mudou)
 *   5m: hard refresh — limpa cache e força fetch novo
 *  +  : Page Visibility API — refresh imediato quando volta da background
 */
const FULL_REFRESH_MS  = 5 * 60 * 1000;   // 5 min
const QUICK_REFRESH_MS = 10 * 1000;       // 10 s — planilha (chamada pesada)
const STATE_PULL_MS    = 5 * 1000;        // 5 s — drag/despacho/notas

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

let _refreshersStarted = false;
function startAllRefreshers() {
  if (_refreshersStarted) return;   // GUARD: nao recriar setInterval em loop
  _refreshersStarted = true;
  // 30s: check rapido
  setInterval(async () => { await loadData(true); }, QUICK_REFRESH_MS);
  // 4s: só os pedidos do chat (consulta leve) — produção entra quase na hora
  setInterval(refrescarFonteRapida, FONTE_RAPIDA_MS);
  // 5min: hard refresh (forca ignorar cache)
  setInterval(async () => {
    lastSignature = '';
    await loadData(true);
  }, FULL_REFRESH_MS);
  // 10s: pull do state compartilhado
  setInterval(pullRemoteState, STATE_PULL_MS);
  // verifica overlay BORA ALMOCAR a cada 30s
  setInterval(checkLunchOverlay, 30000);
  // 60s: verifica se ha nova build (auto-reload)
  setInterval(checkForNewBuild, 5000);
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
    if (e.key !== 'Escape') return;
    // tinha popup aberto? o Esc é dele
    const dm = document.getElementById('dispatched-modal');
    const mm = document.getElementById('motorista-modal');
    const tinhaAberto = !!activeDetailId || !!activeMotoristaId ||
      (dm && !dm.hidden) || (mm && !mm.hidden);
    closeDetail(); closeMotorista(); closeDispatched();
    // Esc "sobrando" e o painel está EMBUTIDO (dentro do UNA CHAT):
    // avisa o pai pra voltar pras conversas
    if (!tinhaAberto && window.parent !== window) {
      try { window.parent.postMessage({ tipo: 'painel-esc' }, '*'); } catch (_) {}
    }
  });

  setupMotoristaModal();
  setupZoomButtons();

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

  // restaurar LOCATIONS / overrides / ordem manual do localStorage antes do primeiro load
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const [k,v] of arr) LOCATIONS.set(k, v);
    }
  } catch (_) {}
  loadDateOverrides();
  loadManualOrder();
  loadSidebarOrder();

  setupCrossTabSync();
  checkLunchOverlay();   // mostra "BORA ALMOÇAR" se já é a hora
  // Estado compartilhado e CSV buscados EM PARALELO. O desenho espera o
  // estado só até 3,5s (Apps Script frio demora) — se passar disso, desenha
  // com o que tem e o estado corrige sozinho quando chegar (applyRemoteState
  // redesenha). Antes era em fila e a tela ficava preta esperando.
  const estadoCedo = pullRemoteState();
  // desenha JÁ com a última carga guardada (abre na hora); a rede corrige atrás
  const tinhaCache = renderFromCache();
  const noMaximo = new Promise((r) => setTimeout(r, tinhaCache ? 1200 : 3500));
  Promise.race([estadoCedo, noMaximo])
    .then(() => loadData(tinhaCache))
    .then(() => { startAllRefreshers(); });
}

/* Sincronização entre abas — quando user faz ação em uma aba, todas as
 * outras abas abertas refletem (drag, finalize, nota, tema, refresh).
 * Versão estendida: também sincroniza entre dispositivos diferentes via
 * Apps Script Web App (POST/GET ?action=state). */
const LS_SYNC_KEY = 'painel-galpao-sync-v1';
let remoteStateUpdatedAt = 0;
let pushTimer = null;
let pendingPush = false;   // true entre uma ação local e o push chegar no servidor

function broadcastSync(kind) {
  try { localStorage.setItem(LS_SYNC_KEY, `${kind}|${Date.now()}|${Math.random()}`); } catch(_){}
  schedulePushRemote();
}

// manda os finalizados mais recentes pro servidor. O corpo do POST não tem o
// limite de 9KB (isso é só por VALOR no PropertiesService) — quem cuida disso é
// o doPost, que MESCLA e PODA antes de gravar. Mandamos um teto alto só como
// trava de segurança; o aparelho ainda guarda tudo local (nunca ressuscita o
// próprio). Cap em 800 = folga grande pra atividade real de meses.
function finishedMapForSync() {
  const entries = [...loadFinishedMap().entries()]
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, 800);
  return Object.fromEntries(entries);
}
// remove imagens (data: URLs) das notas antes de enviar — uma só já estoura o
// limite de ~9KB/valor do PropertiesService e faz o POST INTEIRO falhar,
// congelando todo o sync. Imagens ficam locais; texto sincroniza normal.
// Manda também os TOMBSTONES (html vazio) — é assim que a deleção propaga.
function notesForSync() {
  const out = {};
  for (const [id, v] of loadNotesMap()) {
    let s = String(v.html || '').replace(/<img[^>]*>/gi, '');
    if (s.length > 4000) s = s.slice(0, 4000);
    out[id] = { html: s.trim() ? s : '', at: v.at || 0 };
  }
  return out;
}

async function pushRemoteState() {
  const url = (Array.isArray(SHEET_CSV_URLS) ? SHEET_CSV_URLS[0] : '') || '';
  if (!url.includes('script.google.com')) { pendingPush = false; return; }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        locations:      Object.fromEntries(LOCATIONS),
        finished:       finishedMapForSync(),
        notes:          notesForSync(),
        dateOverrides:  Object.fromEntries(DATE_OVERRIDES),
        manualOrder:    Object.fromEntries(MANUAL_ORDER),
        sidebarOrder:   Object.fromEntries(SIDEBAR_ORDER),
      })
    });
  } catch (err) {
    console.warn('[sync] push falhou:', err);
  } finally {
    pendingPush = false;   // libera o pull (mudança local já foi enviada)
  }
}

function schedulePushRemote() {
  pendingPush = true;      // marca: tem mudança local esperando subir
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemoteState, 700);
}

async function pullRemoteState() {
  // se há mudança local ainda não enviada, NÃO deixa o pull sobrescrever
  // (evita reverter um drag/despacho recente "do nada"). Pega no próximo ciclo.
  if (pendingPush) return;
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

// um record está despachado se sua chave estável OU seu id legado está 'out'
function isFinishedRec(rec, outSet) {
  return !!rec && (outSet.has(rec.finishKey) || outSet.has(rec.id));
}

function applyRemoteState(data) {
  // FINISHED primeiro (antes de locations): assim o overwrite de locations não
  // re-assenta no board um card que acabou de ser despachado em outro device.
  if (data.finished !== undefined) {
    // MERGE por timestamp (nunca substitui em bloco) — um push velho não
    // consegue mais ressuscitar um card despachado neste aparelho.
    mergeFinishedRemote(data.finished);
    // tira do painel na hora os que passaram a estar despachados em outro device
    const out = loadFinishedSet();
    for (const [id, rec] of [...RECORDS]) {
      if (isFinishedRec(rec, out)) { RECORDS.delete(id); LOCATIONS.delete(id); }
    }
    persistLocations();
  }
  if (data.locations) {
    const out = loadFinishedSet();
    // OVERLAY (sem clear): não descarta a posição de um card que só este
    // device conhece (recém-carregado) — antes o clear jogava ele pro board.
    for (const [k,v] of Object.entries(data.locations)) {
      // não re-assenta card já despachado (record conhecido e 'out')
      if (isFinishedRec(RECORDS.get(k), out)) continue;
      if (v === 'board' || v === 'sidebar') LOCATIONS.set(k, v);
    }
    persistLocations();
  }
  if (data.notes && typeof data.notes === 'object') {
    // merge por TIMESTAMP (igual finished): o mais novo vence, inclusive
    // tombstone de deleção (html vazio). Nota deletada NUNCA ressuscita.
    // Empate mantém a local — protege nota com imagem (imagem não sobe pro
    // sync, então a cópia remota do mesmo instante vem sem a imagem).
    const localNotes = loadNotesMap();
    let changed = false;
    for (const [id, v] of Object.entries(data.notes)) {
      const rv = (typeof v === 'string')
        ? { html: v, at: 1 }
        : { html: String((v && v.html) || ''), at: Number(v && v.at) || 0 };
      const lv = localNotes.get(id);
      if (!lv || rv.at > lv.at) { localNotes.set(id, rv); changed = true; }
    }
    if (changed) persistNotesMap(localNotes);
  }
  if (data.dateOverrides && typeof data.dateOverrides === 'object') {
    DATE_OVERRIDES.clear();
    for (const [k,v] of Object.entries(data.dateOverrides)) {
      if (v && Number.isInteger(v.day)) DATE_OVERRIDES.set(k, v);
    }
    persistDateOverrides();
  }
  if (data.manualOrder && typeof data.manualOrder === 'object') {
    MANUAL_ORDER.clear();
    for (const [k,v] of Object.entries(data.manualOrder)) {
      if (Number.isFinite(v)) MANUAL_ORDER.set(k, Number(v));
    }
    persistManualOrder();
  }
  if (data.sidebarOrder && typeof data.sidebarOrder === 'object') {
    SIDEBAR_ORDER.clear();
    for (const [k,v] of Object.entries(data.sidebarOrder)) {
      if (Number.isFinite(v)) SIDEBAR_ORDER.set(k, Number(v));
    }
    persistSidebarOrder();
  }
  // o remoto pode ter mandado chaves legadas (device com build antiga):
  // migra pro id estável antes de renderizar, senão a ordem some até o
  // próximo loadData.
  migrateLegacyKeys([...RECORDS.values()]);
  // recalcula datas dos records com overrides + location
  for (const [id, rec] of RECORDS) {
    rec.date = computeDisplayDate(rec, LOCATIONS.get(id) || 'board');
  }
  renderAll();
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
    } else if (e.key === LS_FINISHED_KEY || e.key === LS_FINISHED_MAP_KEY) {
      // alguém finalizou/restaurou — recarrega tudo (pra refletir no dataset)
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

/* -- Escala pessoal (A- / A+) — aumenta/diminui letras E cards juntos.
 * Vive no aparelho (localStorage): a TV fica no tamanho dela, o computador
 * de quem tem vista cansada fica maior. recalcLayout refaz as contas
 * sozinho porque lê o tamanho do board já escalado. */
function loadScale() {
  const v = parseFloat(localStorage.getItem(LS_SCALE_KEY) || '1');
  return Number.isFinite(v) && v >= 0.6 && v <= 2 ? v : 1;
}
function applyScale(z) {
  z = Math.round(Math.min(2, Math.max(0.6, z)) * 10) / 10;
  document.documentElement.style.setProperty('--ui-scale', z);
  try { localStorage.setItem(LS_SCALE_KEY, String(z)); } catch (_) {}
  recalcLayout();
  showToast(`TAMANHO ${Math.round(z * 100)}%`, 1200);
  return z;
}
function setupZoomButtons() {
  const $out = document.getElementById('btn-zoom-out');
  const $in  = document.getElementById('btn-zoom-in');
  document.documentElement.style.setProperty('--ui-scale', loadScale());
  if ($out) $out.addEventListener('click', () => applyScale(loadScale() - 0.1));
  if ($in)  $in.addEventListener('click',  () => applyScale(loadScale() + 0.1));
  // duplo clique em qualquer um = volta pro tamanho normal
  for (const b of [$out, $in]) {
    if (b) b.addEventListener('dblclick', () => applyScale(1));
  }
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
