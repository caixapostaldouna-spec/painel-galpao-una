# Estúdio de Personalização — Protótipo

Protótipo de uma plataforma de personalização de camisetas, no mesmo espírito do
fluxo da Camisa Dimona (escolher produto → cor/malha → criar a arte → técnica de
estampa → resumo/carrinho). Construído em **HTML + CSS + JS puro**, sem
dependências e sem build — é só abrir o `index.html`.

## Como rodar

Abra `estudio/index.html` no navegador (ou acesse `/estudio/` no GitHub Pages).

## O que dá pra fazer

**1. Produto**
- 4 modelos com silhuetas próprias: Camiseta, Regata, Manga Longa, Moletom.
- Malha/tecido (Algodão, Premium, Dry Fit, Orgânico) e tamanho (PP–XG).

**2. Cor**
- Paleta de 12 cores aplicada ao tecido em tempo real (frente e costas).

**3. Arte (editor no palco)**
- **Texto**: 9 fontes, tamanho, cor, negrito/itálico, caixa alta, alinhamento.
- **Imagem**: upload de PNG/JPG (logo/arte) + cliparts de exemplo.
- **Formas**: retângulo, círculo, triângulo, linha, estrela, coração.
- Cada elemento pode ser **movido, girado, redimensionado, duplicado e
  reordenado em camadas** (alças no palco + atalhos de teclado).
- Edição independente para **frente** e **costas**.

**4. Estampa**
- Técnica de impressão (Silk, Silk Digital, Transfer DTF, Bordado, Sublimação),
  cada uma com efeito no preço.

**5. Resumo / Carrinho**
- Preço calculado ao vivo (produto + malha + técnica + personalização + costas).
- Modal de resumo com o detalhamento do pedido.

## Atalhos

| Tecla | Ação |
|---|---|
| `Delete` / `Backspace` | excluir elemento selecionado |
| `Esc` | desselecionar |
| `Ctrl/Cmd + Z` | desfazer |
| `Ctrl/Cmd + Y` / `Ctrl+Shift+Z` | refazer |
| `Ctrl/Cmd + D` | duplicar elemento |

## Arquivos

- `index.html` — estrutura (topbar, rail, painel, palco, inspector, carrinho)
- `style.css` — visual (tema claro moderno)
- `script.js` — catálogo, estado, editor (drag/resize/rotate), preço, histórico

> Protótipo de front-end: não há backend, pagamento real nem persistência.
