# Painel de Produção — Galpão Una

Painel industrial dos trabalhos em produção. Lê dados direto do Google Sheets
(uma aba por mês) e mostra cards arrastáveis: **central** = em produção,
**coluna direita** = aguardando retirada.

## Como funciona

- Cards aparecem automaticamente conforme você adiciona linhas no Sheets.
- Basta colocar o **nome do projeto** (coluna B) — todo o resto é opcional.
- Filtro automático: só mostra trabalhos do **mês corrente em diante**.
- Filtro **TORUN**: cada aba começa a listar a partir da primeira linha
  cujo projeto seja "Torun" ou "Torum".
- **Arrastar** card pra coluna direita = trabalho pronto aguardando retirada.
- **Duplo clique** no card da coluna direita = trabalho FINALIZADO, some pra
  sempre (mesmo que continue na planilha).
- **Clique** abre painel de detalhe com observações livres (salva localmente).

## Adicionar novo mês

1. No Google Sheets: `Arquivo > Compartilhar > Publicar na web` → aba do mês
   novo → formato CSV → publicar.
2. Copiar a URL gerada (termina em `output=csv`).
3. Adicionar a URL no array `SHEET_CSV_URLS` no início do `script.js`.
4. Commit + push. GitHub Pages atualiza em ~30s.

## Arquivos

- `index.html` — estrutura
- `style.css` — visual industrial (preto + amarelo ouro)
- `script.js` — toda a lógica (parser CSV, drag-drop, filtros, persistência)
- `dados.csv` — fallback local (usado se o array de URLs estiver vazio)
