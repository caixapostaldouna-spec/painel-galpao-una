/**
 * PAINEL DE PRODUÇÃO GALPÃO UNA — Apps Script Web App
 *
 * Funções:
 *  - GET sem parâmetros        → retorna CSV consolidado de todas as abas
 *                                mensais a partir da linha "Torun" de cada.
 *  - GET ?action=state         → retorna JSON com o estado compartilhado
 *                                (locations / finished / notes / updatedAt).
 *  - POST com body JSON        → grava o estado compartilhado.
 *
 *  O estado é guardado em PropertiesService (key/value do Apps Script,
 *  até 500KB total). Permite sync entre dispositivos diferentes:
 *   - cada painel POST a cada ação local (drag, despachar, nota)
 *   - cada painel GET ?action=state a cada 10s e merge com o local
 */

const PROPS = PropertiesService.getScriptProperties();

// Coluna J da planilha: marca "DESPACHADO" gravada pelo painel. É a VERDADE
// definitiva do despacho — vive junto com a linha, então nunca é podada nem
// se perde quando linhas são adicionadas/movidas/editadas na planilha.
const DISPATCH_COL = 10;

const MES_NUMS = {
  JAN: 0, JANEIRO: 0,
  FEV: 1, FEVEREIRO: 1,
  MAR: 2, MARCO: 2, 'MARÇO': 2,
  ABR: 3, ABRIL: 3,
  MAI: 4, MAIO: 4,
  JUN: 5, JUNHO: 5,
  JUL: 6, JULHO: 6,
  AGO: 7, AGOSTO: 7,
  SET: 8, SETEMBRO: 8,
  OUT: 9, OUTUBRO: 9,
  NOV: 10, NOVEMBRO: 10,
  DEZ: 11, DEZEMBRO: 11,
};

function parseAbaName(name) {
  const m = String(name || '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .match(/^([A-Z]+)\s*(\d{2,4})$/);
  if (!m) return null;
  const mes = MES_NUMS[m[1]];
  if (mes == null) return null;
  let ano = parseInt(m[2], 10);
  if (ano < 100) ano += 2000;
  return { mes, ano };
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  // ---- endpoint state: retorna JSON do estado compartilhado ----------
  if (action === 'state') {
    return jsonOutput({
      locations:     JSON.parse(PROPS.getProperty('state_locations')     || '{}'),
      finished:      JSON.parse(PROPS.getProperty('state_finished')      || '{}'),
      notes:         JSON.parse(PROPS.getProperty('state_notes')         || '{}'),
      dateOverrides: JSON.parse(PROPS.getProperty('state_dateOverrides') || '{}'),
      manualOrder:   JSON.parse(PROPS.getProperty('state_manualOrder')   || '{}'),
      sidebarOrder:  JSON.parse(PROPS.getProperty('state_sidebarOrder')  || '{}'),
      updatedAt:     Number(PROPS.getProperty('state_updatedAt')         || 0)
    });
  }

  // ---- default: CSV consolidado das abas mensais ---------------------
  // NAO filtra por mes corrente: traz TODAS as abas mensais (a partir do
  // TORUN de cada). Trabalhos so saem do painel quando o usuario despachar
  // manualmente (duplo clique no card-mini). Esse comportamento eh espelhado
  // no front em filterAndBuildRecords().
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const monthSheets = [];
  for (const sheet of sheets) {
    const parsed = parseAbaName(sheet.getName());
    if (!parsed) continue;
    const abaMonths = parsed.ano * 12 + parsed.mes;
    monthSheets.push({ sheet, parsed, abaMonths });
  }
  monthSheets.sort((a, b) => a.abaMonths - b.abaMonths);

  const finalRows = [];
  let headerAdded = false;
  for (const { sheet } of monthSheets) {
    const maxRow = sheet.getMaxRows();
    const lastCol = Math.max(1, sheet.getLastColumn());
    const data = sheet.getRange(1, 1, maxRow, lastCol).getValues();
    if (data.length === 0) continue;
    if (!headerAdded) {
      finalRows.push(data[0]);
      headerAdded = true;
    }
    let torunIdx = -1;
    for (let i = 1; i < data.length; i++) {
      const projeto = String(data[i][1] || '').trim();
      if (/torun|torum/i.test(projeto)) { torunIdx = i; break; }
    }
    const startAt = torunIdx >= 0 ? torunIdx : 1;
    for (let i = startAt; i < data.length; i++) {
      const projeto = String(data[i][1] || '').trim();
      if (!projeto) continue;
      // linha marcada DESPACHADO na coluna J: filtrada NA ORIGEM. Nunca mais
      // aparece no painel, não importa lápide, device novo ou data editada.
      if (String(data[i][DISPATCH_COL - 1] || '').trim()) continue;
      finalRows.push(data[i]);
    }
  }
  const csv = finalRows.map(row => row.map(cell => {
    let v = cell == null ? '' : String(cell);
    if (cell instanceof Date) {
      const dd = String(cell.getDate()).padStart(2, '0');
      const mm = String(cell.getMonth() + 1).padStart(2, '0');
      v = dd + '/' + mm + '/' + cell.getFullYear();
    }
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }).join(',')).join('\n');
  return ContentService.createTextOutput(csv)
    .setMimeType(ContentService.MimeType.PLAIN_TEXT);
}

function doPost(e) {
  // serializa o read-modify-write do "finished" pra dois dispositivos nao
  // sobrescreverem um ao outro (corrida que ressuscitava cards).
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e2) { /* segue sem lock se nao conseguir */ }

  const result = { ok: true };
  try {
    const body = JSON.parse(e.postData.contents);

    // ---- ação dispatch/restore: grava/limpa a marca na PLANILHA -------
    // jobs = [{ key }] onde key é a finishKey estável (slug#contato#data).
    if (body.action === 'dispatch' || body.action === 'restore') {
      try {
        result.marked = markDispatchInSheet_(body.jobs || [], body.action === 'dispatch');
      } catch (e5) { result.sheetError = String(e5); }
      PROPS.setProperty('state_updatedAt', String(Date.now()));
      return jsonOutput(result);
    }

    // campos simples (limitados pelo nr de cards ativos): grava direto, cada um
    // no seu try pra um erro nao derrubar os outros nem o updatedAt.
    setProp_('state_locations',     body.locations,     result, 'locations');
    setProp_('state_dateOverrides', body.dateOverrides, result, 'dateOverrides');
    setProp_('state_manualOrder',   body.manualOrder,   result, 'manualOrder');
    setProp_('state_sidebarOrder',  body.sidebarOrder,  result, 'sidebarOrder');

    // NOTAS: MERGE por timestamp (igual finished). Cada nota é {html, at};
    // html vazio = tombstone de deleção — apagar propaga e NUNCA ressuscita.
    if (body.notes !== undefined) {
      try {
        const merged = mergeNotesMaps_(readNotesMap_(), toNotesMap_(body.notes));
        PROPS.setProperty('state_notes', JSON.stringify(pruneByAtToFit_(merged, 8500)));
      } catch (e6) { result.notesError = String(e6); }
    }

    // FINISHED: MERGE (nunca sobrescreve em bloco) por timestamp, depois PODA
    // pra caber no limite de ~9KB/valor do PropertiesService. Assim uma lapide
    // de despacho nao some do servidor so porque um device mandou lista parcial.
    if (body.finished !== undefined) {
      try {
        const merged = mergeFinishedMaps_(readFinishedMap_(), toFinishedMap_(body.finished));
        const fitted = pruneByAtToFit_(merged, 8500);
        PROPS.setProperty('state_finished', JSON.stringify(fitted));
      } catch (e3) { result.finishedError = String(e3); }
    }

    // SEMPRE avanca o updatedAt (mesmo se algum campo falhou) pra nunca congelar
    // o sync dos demais dispositivos.
    PROPS.setProperty('state_updatedAt', String(Date.now()));
  } catch (err) {
    result.ok = false;
    result.error = String(err);
  } finally {
    try { lock.releaseLock(); } catch (e4) {}
  }
  return jsonOutput(result);
}

// grava um campo simples; erro de um nao derruba os outros
function setProp_(key, value, result, label) {
  if (value === undefined || value === null) return;
  try { PROPS.setProperty(key, JSON.stringify(value)); }
  catch (e) { result[label + 'Error'] = String(e); }
}

// le o finished atual do servidor como map id->{state,at}
function readFinishedMap_() {
  const raw = PROPS.getProperty('state_finished');
  if (!raw) return {};
  try { return toFinishedMap_(JSON.parse(raw)); } catch (e) { return {}; }
}

// normaliza array antigo (strings / {id,finishedAt}) OU map novo {id:{state,at}}
function toFinishedMap_(parsed) {
  const map = {};
  if (parsed == null) return map;
  if (Object.prototype.toString.call(parsed) === '[object Array]') {
    for (let i = 0; i < parsed.length; i++) {
      const it = parsed[i];
      if (typeof it === 'string') map[it] = { state: 'out', at: 1 };
      else if (it && it.id)       map[it.id] = { state: 'out', at: Number(it.finishedAt) || 1 };
    }
  } else if (typeof parsed === 'object') {
    for (const k in parsed) {
      if (!parsed.hasOwnProperty(k)) continue;
      const v = parsed[k];
      if (v && (v.state === 'out' || v.state === 'in')) map[k] = { state: v.state, at: Number(v.at) || 0 };
      else map[k] = { state: 'out', at: 1 };
    }
  }
  return map;
}

// merge por timestamp; em empate 'out' vence 'in' (re-despacho nao perde)
function mergeFinishedMaps_(cur, inc) {
  for (const k in inc) {
    if (!inc.hasOwnProperty(k)) continue;
    const rv = inc[k], lv = cur[k];
    const win = !lv || rv.at > lv.at || (rv.at === lv.at && rv.state === 'out' && lv.state !== 'out');
    if (win) cur[k] = rv;
  }
  return cur;
}

// mantem os mais recentes (por at) que couberem em maxBytes (limite ~9KB/valor)
function pruneByAtToFit_(map, maxBytes) {
  const keys = Object.keys(map);
  keys.sort(function (a, b) { return (map[b].at || 0) - (map[a].at || 0); });
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = map[keys[i]];
    if (JSON.stringify(out).length > maxBytes) { delete out[keys[i]]; break; }
  }
  return out;
}

/* ---------- NOTAS: mesmo modelo do finished (timestamp + tombstone) ------ */

// le o state_notes atual como map id->{html,at}
function readNotesMap_() {
  const raw = PROPS.getProperty('state_notes');
  if (!raw) return {};
  try { return toNotesMap_(JSON.parse(raw)); } catch (e) { return {}; }
}

// normaliza formato antigo (id->string) OU novo (id->{html,at})
function toNotesMap_(parsed) {
  const map = {};
  if (parsed == null || typeof parsed !== 'object') return map;
  for (const k in parsed) {
    if (!parsed.hasOwnProperty(k)) continue;
    const v = parsed[k];
    if (typeof v === 'string') map[k] = { html: v, at: 1 };
    else if (v && typeof v === 'object') map[k] = { html: String(v.html || ''), at: Number(v.at) || 0 };
  }
  return map;
}

// merge por timestamp (mais novo vence); html vazio = nota deletada
function mergeNotesMaps_(cur, inc) {
  for (const k in inc) {
    if (!inc.hasOwnProperty(k)) continue;
    const rv = inc[k], lv = cur[k];
    if (!lv || rv.at > lv.at) cur[k] = rv;
  }
  return cur;
}

/* ---------- DESPACHO NA PLANILHA (coluna J) ------------------------------ */

function slugify_(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'X';
}

// data de uma célula (Date nativa OU texto dd/mm[/aaaa]) -> {day,month,year}
function cellDate_(v) {
  if (v instanceof Date) return { day: v.getDate(), month: v.getMonth(), year: v.getFullYear() };
  const m = String(v || '').trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
  if (!m) return null;
  let y = m[3] ? parseInt(m[3], 10) : (new Date()).getFullYear();
  if (y < 100) y += 2000;
  return { day: parseInt(m[1], 10), month: parseInt(m[2], 10) - 1, year: y };
}

// finishKey de uma linha da planilha — MESMA fórmula do front (script.js)
function rowFinishKey_(row) {
  const p = slugify_(String(row[1] || '').trim());
  const c = String(row[3] || '').trim();
  const d = cellDate_(row[4]);
  return p + '#' + (c ? slugify_(c) : '') + '#' + (d ? (d.year + '-' + d.month + '-' + d.day) : '');
}

// marca (dispatched=true) ou limpa (false) a coluna J das linhas cuja
// finishKey bate com algum job. Retorna quantas linhas alterou.
function markDispatchInSheet_(jobs, dispatched) {
  const keys = {};
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i] && jobs[i].key) keys[jobs[i].key] = true;
  }
  if (Object.keys(keys).length === 0) return 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let count = 0;
  for (const sheet of ss.getSheets()) {
    if (!parseAbaName(sheet.getName())) continue;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;
    const lastCol = Math.max(DISPATCH_COL, sheet.getLastColumn());
    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    for (let i = 1; i < data.length; i++) {
      const projeto = String(data[i][1] || '').trim();
      if (!projeto) continue;
      if (!keys[rowFinishKey_(data[i])]) continue;
      sheet.getRange(i + 1, DISPATCH_COL).setValue(dispatched ? 'DESPACHADO' : '');
      count++;
    }
  }
  return count;
}

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
