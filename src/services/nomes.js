// Padroniza a grafia de nomes de pessoas SÓ na exibição — nunca altera o valor gravado no
// banco. Quem preenche formulário público escreve como quiser (TUDO MAIÚSCULO, tudo
// minúsculo, misturado); aqui vira sempre "Primeira Letra Maiúscula" por palavra, com
// acentos e apóstrofo preservados. Um só lugar pra essa regra — usada em toda lista de
// inscritos/candidatos (PSS, eventos, listas de assinatura) em vez de reescrita em cada tela.
function formatarNome(nome) {
  return (nome || '').toLowerCase().replace(/\p{L}[\p{L}'’-]*/gu, w => w.charAt(0).toUpperCase() + w.slice(1));
}

module.exports = { formatarNome };
