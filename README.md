# painel-galpao-una — mudou de casa

O painel de produção **não mora mais aqui**. Desde 28/08/2026 ele vive dentro
do chat, em [`public/painel`](https://github.com/caixapostaldouna-spec/una-chat/tree/master/public/painel)
do repositório `una-chat`, e abre em:

**https://chat-galpaouna.vercel.app/painel**

## Por que mudou

A ponte entre o painel e o chat tem dois lados — o painel lê os pedidos em
produção do chat e guarda nele o estado compartilhado do quadro. Mudar os dois
exigia dois repositórios e dois PRs, e um deles ficou pra trás numa mesclagem:
a TV passou dias sem sincronizar entre os aparelhos, e ninguém percebeu.

Junto veio o conserto do que estava quebrado:

- o estado compartilhado saiu do Apps Script (cujo endereço passou a devolver
  404) e foi pro banco do chat, com uma linha por card;
- a planilha "STATUS - Projetos" deixou de alimentar a TV. O trabalho nasce na
  aprovação, vira pedido e, quando entra em produção, aparece no painel.

## O que sobrou aqui

Só esta página, que redireciona quem abrir o endereço antigo — a TV do galpão,
um favorito, um atalho. Assim ninguém precisa digitar endereço novo.

O `apps-script.gs` foi para
[`docs/painel`](https://github.com/caixapostaldouna-spec/una-chat/tree/master/docs/painel)
no repositório novo, como histórico.
