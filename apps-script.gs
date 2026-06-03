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
      finished:      JSON.parse(PROPS.getProperty('state_finished')      || '[]'),
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
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.locations)      PROPS.setProperty('state_locations',     JSON.stringify(body.locations));
    if (body.finished)       PROPS.setProperty('state_finished',      JSON.stringify(body.finished));
    if (body.notes)          PROPS.setProperty('state_notes',         JSON.stringify(body.notes));
    if (body.dateOverrides)  PROPS.setProperty('state_dateOverrides', JSON.stringify(body.dateOverrides));
    if (body.manualOrder)    PROPS.setProperty('state_manualOrder',   JSON.stringify(body.manualOrder));
    if (body.sidebarOrder)   PROPS.setProperty('state_sidebarOrder',  JSON.stringify(body.sidebarOrder));
    PROPS.setProperty('state_updatedAt', String(Date.now()));
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function jsonOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
