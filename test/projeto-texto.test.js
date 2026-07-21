// A seção INSCRIPCIÓN do documento vai para a coordinación da universidade. Os valores por
// extenso em espanhol e a redação corrida precisam sair certos — é documento formal.
const { test } = require('node:test');
const assert = require('node:assert');
const { enEspanol, moneda, milhar, textoInscripcion } = require('../src/services/projeto-texto');

test('número por extenso em espanhol', () => {
  assert.strictEqual(enEspanol(12), 'doce');
  assert.strictEqual(enEspanol(15), 'quince');
  assert.strictEqual(enEspanol(20), 'veinte');
  assert.strictEqual(enEspanol(20000), 'veinte mil');
  assert.strictEqual(enEspanol(25000), 'veinticinco mil');
  assert.strictEqual(enEspanol(30000), 'treinta mil');
  assert.strictEqual(enEspanol(100), 'cien');
  assert.strictEqual(enEspanol(1000), 'mil');
});

test('moeda com apócope do uno (un real, veintiún guaraníes)', () => {
  assert.strictEqual(moneda(1, 'real', 'reales'), 'un real');
  assert.strictEqual(moneda(12, 'real', 'reales'), 'doce reales');
  assert.strictEqual(moneda(21, 'guaraní', 'guaraníes'), 'veintiún guaraníes');
  assert.strictEqual(moneda(30000, 'guaraní', 'guaraníes'), 'treinta mil guaraníes');
});

test('milhar com ponto (padrão paraguaio)', () => {
  assert.strictEqual(milhar(20000), '20.000');
  assert.strictEqual(milhar(25000), '25.000');
  assert.strictEqual(milhar(500), '500');
});

test('texto de inscrição pago: valores em real e guarani, dias, hora e plataforma', () => {
  const t = textoInscripcion({
    nome: 'Jornada Salud Masculina en Foco',
    inscricao_gratuita: false,
    inscricao_valor: 20000, inscricao_valor_brl: 12,
    temario: [{ data: '2025-08-18' }, { data: '2025-08-19' }, { data: '2025-08-20' }, { data: '2025-08-21' }],
    horario_inicio: '18:00', modalidade: 'online', plataforma: 'Google Meet'
  });
  assert.match(t, /es gratuita y obligatoria para todos los ligantes LAURO/);
  assert.match(t, /R\$ 12,00 \(doce reales\)/);
  assert.match(t, /G\$ 20\.000 \(veinte mil guaraníes\)/);
  assert.match(t, /los días 18, 19, 20 y 21 de agosto de 2025/);
  assert.match(t, /a las 18h/);
  assert.match(t, /en la plataforma Google Meet/);
});

test('texto de inscrição gratuita: sem valores, mas com quando/onde', () => {
  const t = textoInscripcion({
    nome: 'Jornada X', inscricao_gratuita: true,
    temario: [{ data: '2025-08-18' }], horario_inicio: '19:30',
    modalidade: 'presencial', local: 'Auditorio UCP'
  });
  assert.match(t, /gratuita y obligatoria/);
  assert.doesNotMatch(t, /inversión/);
  assert.match(t, /los días 18 de agosto de 2025/);
  assert.match(t, /a las 19:30/);
  assert.match(t, /en Auditorio UCP/);
});

test('online (virtual) com plataforma no campo local vira "en la plataforma"', () => {
  const t = textoInscripcion({
    nome: 'Jornada', inscricao_gratuita: true,
    temario: [{ data: '2026-08-17' }], horario_inicio: '19:00',
    modalidade: 'virtual', plataforma: null, local: 'Google Meet'
  });
  assert.match(t, /a las 19h/);
  assert.match(t, /en la plataforma Google Meet/);
});
