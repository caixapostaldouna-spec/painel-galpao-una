# Mockup de Camiseta — Editor (protótipo)

Página única e sólida para montar o **mockup de uma camiseta (frente e verso)**:
trocar modelo e cor, adicionar textos, imagens e formas, e exportar em PNG.
Sem loja, sem carrinho — só o editor. Feito em **HTML + CSS + JS puro**, sem
dependências e sem build, pronto para ser embutido em outro site no futuro.

## Como rodar
Abra `estudio/index.html` no navegador. Pronto.

## Recursos
- **Modelo:** Básica, Baby Look, Regata, Manga Longa, Moletom (estrutura
  extensível — novos tipos entram em `PRODUCTS` no `script.js`).
- **Cor:** 12 cores + seletor de cor personalizada (vale frente e verso).
- **Texto:** 9 fontes, tamanho, cor, negrito/itálico, caixa alta, alinhamento.
- **Imagem:** upload de PNG/JPG (logo/arte) + cliparts de exemplo.
- **Formas:** retângulo, círculo, triângulo, linha, estrela, coração.
- **Manipulação:** mover, girar, redimensionar, duplicar, camadas; alças no palco.
- **Frente e verso** independentes, com animação de virada.
- **Exportar PNG** do lado atual em alta resolução (1200×1200).
- **Autosave** no navegador (não perde o trabalho ao atualizar) + desfazer/refazer.

## Atalhos
`Delete` excluir · `Esc` desselecionar · `Ctrl/Cmd+Z` desfazer ·
`Ctrl/Cmd+Y` refazer · `Ctrl/Cmd+D` duplicar.

## Como crescer depois
- **Novos tipos de camiseta:** adicionar SVG em `SHIRTS` e item em `PRODUCTS`.
- **Área de estampa:** ajustável pela constante `PA` (proporções no mockup).
- **Embutir em site:** os 3 arquivos (`index.html`, `style.css`, `script.js`)
  são estáticos e portáteis.

> Protótipo de front-end: sem backend e sem persistência em servidor.
