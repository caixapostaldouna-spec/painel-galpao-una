/**
 * PAINEL DE PRODUÇÃO GALPÃO UNA — consolidador automático de abas mensais.
 *
 * Detecta TODAS as abas com nome de mês ("MAIO 2026", "JUN 2026", "JUL 26"...),
 * pega só as do mês corrente em diante, aplica filtro TORUN dentro de cada
 * aba (lista a partir da primeira linha com "Torun"/"Torum") e retorna um
 * CSV único.
 *
 * Como instalar (uma vez só):
 *  1) Abre a planilha no Google Sheets.
 *  2) Menu: Extensões > Apps Script.
 *  3) Apaga TODO o código que vier por padrão e cola este arquivo.
 *  4) Salva (Ctrl+S). Dá um nome qualquer ao projeto.
 *  5) Clica em "Implantar" (canto superior direito) > "Nova implantação".
 *  6) Engrenagem ao lado de "Selecionar tipo" > "App da Web".
 *  7) Em "Quem pode acessar" escolhe "Qualquer pessoa".
 *  8) Clica "Implantar" e autoriza a permissão (precisa fazer 1x).
 *  9) Copia a URL "URL do app da Web" que aparecer.
 * 10) Cola essa URL no painel (no script.js, dentro de SHEET_CSV_URLS).
 *
 * Daí em diante: você cria aba "JUN 2026" / "JUL 2026" / etc, adiciona os
 * trabalhos, e o painel já mostra automaticamente. Sem mexer em nada.
 */

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

/**
 * Tenta extrair (mês, ano) do nome da aba. Aceita:
 *   "MAIO 2026", "MAI 2026", "MAIO 26", "Mai 26", "JUL 25", "Jul 2025"...
 * Retorna null se não for um nome de mês.
 */
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  // mês corrente: usamos pra pular abas de meses passados
  const now = new Date();
  const minMonths = now.getFullYear() * 12 + now.getMonth();

  // ordena abas pela data (mês corrente primeiro, depois futuras em ordem)
  const monthSheets = [];
  for (const sheet of sheets) {
    const parsed = parseAbaName(sheet.getName());
    if (!parsed) continue;
    const abaMonths = parsed.ano * 12 + parsed.mes;
    if (abaMonths < minMonths) continue;  // descarta meses passados
    monthSheets.push({ sheet, parsed, abaMonths });
  }
  monthSheets.sort((a, b) => a.abaMonths - b.abaMonths);

  const finalRows = [];
  let headerAdded = false;

  for (const { sheet } of monthSheets) {
    const data = sheet.getDataRange().getValues();
    if (data.length === 0) continue;

    // primeira aba: pega o cabeçalho. Demais abas: ignora cabeçalho.
    if (!headerAdded) {
      finalRows.push(data[0]);
      headerAdded = true;
    }

    // encontra a primeira linha com "Torun" ou "Torum" em B (índice 1)
    let torunIdx = -1;
    for (let i = 1; i < data.length; i++) {
      const projeto = String(data[i][1] || '').trim();
      if (/^torun?$|torun|torum/i.test(projeto)) {
        torunIdx = i;
        break;
      }
    }
    // se a aba não tem TORUN ainda (rascunho/vazia), pega tudo a partir da
    // linha 2 mesmo, pra trabalhos novos aparecerem antes de você marcar
    // o TORUN.
    const startAt = torunIdx >= 0 ? torunIdx : 1;

    for (let i = startAt; i < data.length; i++) {
      const projeto = String(data[i][1] || '').trim();
      if (!projeto) continue;   // pula linhas vazias
      finalRows.push(data[i]);
    }
  }

  // serializa em CSV
  const csv = finalRows.map(row => row.map(cell => {
    let v = cell == null ? '' : String(cell);
    // datas: o Apps Script às vezes devolve objeto Date. Normaliza pra dd/mm.
    if (cell instanceof Date) {
      const dd = String(cell.getDate()).padStart(2, '0');
      const mm = String(cell.getMonth() + 1).padStart(2, '0');
      v = `${dd}/${mm}/${cell.getFullYear()}`;
    }
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }).join(',')).join('\n');

  return ContentService
    .createTextOutput(csv)
    .setMimeType(ContentService.MimeType.PLAIN_TEXT);
}
