// Textos formais dos documentos de projeto (ensino) — compartilhado pelos DOIS geradores
// (projeto-doc.js e projeto-doc-timbrado.js), para os dois saírem idênticos.
//
// Modelo aprovado pela coordinación (JORNADA SALUD MASCULINA):
//   "La [Nombre] es gratuita y obligatoria para todos los ligantes LAURO. Para la comunidad
//    de alumnos UCP en general tendrá una inversión de R$ 12,00 (doce reales) o G$ 20.000
//    (veinte mil guaraníes), se llevará a cabo los días 18, 19, 20 y 21 de agosto de 2025 a
//    las 18h, en la plataforma Google Meet."

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Norma obrigatória da Coordinación de Ligas: todo documento de projeto (ensino/extensão),
// baixado e/ou enviado a ela, tem que se chamar "LAURO_Proyecto de <Ensino|Extensão>_<nome
// do projeto>" — ela recebe projetos de varias ligas ao mesmo tempo e precisa identificar
// origem, tipo e projeto so pelo nome do arquivo. Aplicado na geracao, no upload manual E de
// novo no momento do envio — isso cobre tambem anexos antigos que ja existiam antes da regra.
function nomeDocumentoProjeto(tipo, nomeProjeto, extensao) {
  const label = tipo === 'ensino' ? 'Ensino' : 'Extensão';
  const nome = String(nomeProjeto || 'Proyecto').trim();
  const ext = String(extensao || 'docx').replace(/^\./, '') || 'docx';
  return 'LAURO_Proyecto de ' + label + '_' + nome + '.' + ext;
}

// Número cardinal por extenso em espanhol (0 a 999.999 — cobre reais e guaraníes de sobra).
function enEspanol(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'cero';
  const uni = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
    'once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve',
    'veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
  const dec = ['','','','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  const cen = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
  function hasta999(x) {
    if (x === 0) return '';
    if (x === 100) return 'cien';
    let s = '';
    const c = Math.floor(x / 100), r = x % 100;
    if (c > 0) s += cen[c];
    if (r > 0) {
      if (s) s += ' ';
      if (r < 30) s += uni[r];
      else { s += dec[Math.floor(r/10)]; if (r % 10) s += ' y ' + uni[r % 10]; }
    }
    return s;
  }
  let s = '';
  const miles = Math.floor(n / 1000), resto = n % 1000;
  if (miles > 0) s += (miles === 1 ? 'mil' : hasta999(miles) + ' mil');
  if (resto > 0) s += (s ? ' ' : '') + hasta999(resto);
  return s;
}

// Valor monetário por extenso, com a apócope do "uno" antes do substantivo masculino
// (un real, veintiún guaraníes). singular/plural do nome da moeda.
function moneda(n, sing, plur) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 1) return 'un ' + sing;
  let palabras = enEspanol(n).replace(/veintiuno$/, 'veintiún').replace(/\buno$/, 'un');
  return palabras + ' ' + plur;
}

// "20.000" — milhar com ponto (padrão paraguaio), sem depender de locale do ambiente.
function milhar(n) {
  return Math.round(Math.abs(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Junta os dias em "18, 19, 20 y 21 de agosto de 2025" quando todos são do mesmo mês/ano.
// Fora disso, cai para "18/08/2025, 19/08/2025..." (raro em jornada). Recebe datas YYYY-MM-DD.
function textoDias(datasISO) {
  const ds = [...new Set(datasISO.filter(Boolean))].sort();
  if (!ds.length) return '';
  const partes = ds.map(d => d.split('-')); // [aaaa, mm, dd]
  const mesmoMesAno = partes.every(p => p[0] === partes[0][0] && p[1] === partes[0][1]);
  if (mesmoMesAno) {
    const dias = partes.map(p => parseInt(p[2], 10));
    const mes = MESES_ES[parseInt(partes[0][1], 10) - 1] || partes[0][1];
    const ano = partes[0][0];
    const listaDias = dias.length === 1 ? String(dias[0])
      : dias.slice(0, -1).join(', ') + ' y ' + dias[dias.length - 1];
    return 'los días ' + listaDias + ' de ' + mes + ' de ' + ano;
  }
  return 'los días ' + ds.map(d => d.split('-').reverse().join('/')).join(', ');
}

// Hora "18:00" -> "18h" ; "18:30" -> "18:30".
function textoHora(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  return m[2] === '00' ? (parseInt(m[1], 10) + 'h') : (parseInt(m[1], 10) + ':' + m[2]);
}

// Datas das classes: do temário (data por classe) ou, na falta, do intervalo de execução.
function datasDoProjeto(p) {
  let tem = [];
  try { tem = Array.isArray(p.temario) ? p.temario : JSON.parse(p.temario || '[]'); } catch (e) {}
  const doTemario = tem.map(t => (t && t.data) || '').filter(Boolean);
  if (doTemario.length) return doTemario;
  // fallback: início..fim da execução (YYYY-MM-DD)
  const so = s => (s ? String(s).slice(0, 10) : '');
  return [so(p.data_execucao_inicio), so(p.data_execucao_fim)].filter(Boolean);
}

// Monta o parágrafo corrido da seção INSCRIPCIÓN conforme o modelo aprovado.
// Devolve uma string (cada gerador embrulha no seu formato de parágrafo).
function textoInscripcion(p) {
  const nombre = (p.nome || '').trim();
  let base = 'La ' + (nombre || 'actividad') + ' es gratuita y obligatoria para todos los ligantes LAURO';

  let inversion = '';
  if (!p.inscricao_gratuita) {
    const brl = Number(p.inscricao_valor_brl || 0);
    const gs = Number(p.inscricao_valor || 0);
    const trechos = [];
    if (brl > 0) trechos.push('R$ ' + brl.toFixed(2).replace('.', ',') + ' (' + moneda(brl, 'real', 'reales') + ')');
    if (gs > 0) trechos.push('G$ ' + milhar(gs) + ' (' + moneda(gs, 'guaraní', 'guaraníes') + ')');
    if (trechos.length) {
      inversion = '. Para la comunidad de alumnos UCP en general tendrá una inversión de ' + trechos.join(' o ');
    }
  }

  // Quando/onde
  const dias = textoDias(datasDoProjeto(p));
  const hora = textoHora(p.horario_inicio);
  // Online (virtual/online/remoto/híbrido) -> "en la plataforma X"; presencial -> "en [local]".
  // O nome da plataforma pode vir no campo `plataforma` ou, quando vazio, no `local`.
  const esOnline = /online|virtual|remot|h[ií]brid/i.test(String(p.modalidade || '')) || !!p.plataforma;
  const nomePlataforma = p.plataforma || p.local || '';
  const lugar = esOnline
    ? (nomePlataforma ? ('en la plataforma ' + nomePlataforma) : '')
    : (p.local ? ('en ' + p.local) : '');

  let cuando = '';
  if (dias || hora || lugar) {
    cuando = ', y se llevará a cabo';
    if (dias) cuando += ' ' + dias;
    if (hora) cuando += ' a las ' + hora;
    if (lugar) cuando += ', ' + lugar;
  }

  return base + inversion + cuando + '.';
}

module.exports = { enEspanol, moneda, milhar, textoDias, textoHora, textoInscripcion, nomeDocumentoProjeto };
