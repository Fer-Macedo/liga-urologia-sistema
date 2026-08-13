// ═══ CALENDÁRIO ═══════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// ── CATEGORIAS DO CALENDÁRIO ──
router.get('/calendario/categorias', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM calendario_categorias ORDER BY criado_em');
    res.json(r.rows);
  } catch(e) { res.json([]); }
});

router.post('/calendario/categorias', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { nome, cor } = req.body;
    if(!nome) return res.json({ok:false, erro:'Nome obrigatório'});
    await query('INSERT INTO calendario_categorias (nome,cor,criado_por) VALUES ($1,$2,$3)', [nome, cor||'#2b6803', req.session.usuario.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});

router.delete('/calendario/categorias/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM calendario_categorias WHERE id=$1', [req.params.id]);
    res.json({ok:true});
  } catch(e) { res.json({ok:false, erro:e.message}); }
});



// Helper para buscar atividades
async function getAniversarios(anoRef) {
  const r = await query(`
    SELECT nome, data_nascimento::date as data_nascimento, 'membro' as tipo FROM membros
      WHERE ativo=1 AND data_nascimento IS NOT NULL
    UNION ALL
    SELECT nome, data_nascimento::date as data_nascimento, 'diretivo' as tipo FROM diretivos
      WHERE ativo=1 AND data_nascimento IS NOT NULL
  `);

  const aniversarios = [];
  const anos = [anoRef - 1, anoRef, anoRef + 1];

  r.rows.forEach(m => {
    // data_nascimento vem do Postgres como DATE (sem hora): o driver, seguindo a regra do
    // JS para strings so-de-data, sempre devolve isso em UTC — daqui pra tras esta certo.
    const nasc = new Date(m.data_nascimento);
    const dia = nasc.getUTCDate();
    const mes = nasc.getUTCMonth(); // 0-11

    anos.forEach(ano => {
      // AQUI e onde o aniversario nascia torto: reconstruir com Date.UTC(...) gera meia-
      // noite UTC, mas TODO o resto do calendario (atividades de verdade, criadas na tela)
      // guarda hora local (o servidor roda em America/Asuncion — confirmado, GMT-3/4) e a
      // grade do calendario le o dia com getFullYear/getMonth/getDate LOCAIS. Meia-noite
      // UTC cai no fim da tarde do dia ANTERIOR em Asuncion, entao todo aniversario
      // aparecia um dia adiantado no calendario (Ellen nascida 27/07 aparecendo em 26/07).
      // O construtor local alinha com a mesma convencao que ja funciona para atividades.
      const dataAniv = new Date(ano, mes, dia);
      aniversarios.push({
        id: `aniv-${m.tipo}-${m.nome}-${ano}`,
        titulo: `Aniversário — ${m.nome}`,
        descricao: `${m.tipo === 'membro' ? 'Ligante' : 'Diretivo'} ${m.nome} faz aniversário hoje!`,
        categoria: 'Aniversario',
        cor: '#f97316',
        data_inicio: dataAniv.toISOString(),
        data_fim: null,
        dia_inteiro: true,
        local: null,
        link_externo: null,
        publico: false, // não aparece na agenda pública
        criado_em: new Date().toISOString()
      });
    });
  });

  return aniversarios;
}

async function getAtividades(apenasPublicas = false, incluirAniversarios = false) {
  const where = apenasPublicas ? 'WHERE publico = TRUE' : '';
  const r = await query(`SELECT * FROM calendario_atividades ${where} ORDER BY data_inicio`);
  let atividades = r.rows;

  if (incluirAniversarios) {
    const anivs = await getAniversarios(new Date().getFullYear());
    atividades = [...atividades, ...anivs];
  }

  return atividades;
}


// PAINEL INTERNO
router.get('/calendario', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const atividades = await getAtividades(false, true);
    res.render('pages/calendario', {
      config: await getConfig(),
      usuario: req.session.usuario,
      paginaAtual: 'calendario',
      atividades: atividades,
      msg: req.flash('msg'),
      erro: req.flash('erro')
    });
  } catch(e) {
    console.error('ERRO CALENDARIO:', e.message);
    res.send('ERRO: ' + e.message);
  }
});

// PÁGINA PÚBLICA (sem login)
// Mantém o mês/ano que o usuário estava vendo ao criar/editar/excluir uma atividade
function calendarioRedirect(req) {
  const mes = parseInt(req.query.mes, 10);
  const ano = parseInt(req.query.ano, 10);
  if (Number.isInteger(mes) && Number.isInteger(ano)) return `/calendario?mes=${mes}&ano=${ano}`;
  return '/calendario';
}

// CRIAR ATIVIDADE
router.post('/calendario/novo', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `INSERT INTO calendario_atividades (titulo,descricao,categoria,cor,data_inicio,data_fim,dia_inteiro,local,link_externo,publico,criado_por,criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.session.usuario.id]
    );
    req.flash('msg', ['Atividade criada com sucesso!']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
});

// EDITAR ATIVIDADE
router.post('/calendario/:id/editar', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    const { titulo, descricao, categoria, cor, data_inicio, data_fim, local, link_externo } = req.body;
    const dia_inteiro = req.body.dia_inteiro === 'true';
    const publico = req.body.publico === 'true';
    await query(
      `UPDATE calendario_atividades SET titulo=$1,descricao=$2,categoria=$3,cor=$4,data_inicio=$5,data_fim=$6,dia_inteiro=$7,local=$8,link_externo=$9,publico=$10 WHERE id=$11`,
      [titulo, descricao||null, categoria, cor||'#2b6803',
       data_inicio, data_fim||null, dia_inteiro, local||null,
       link_externo||null, publico, req.params.id]
    );
    req.flash('msg', ['Atividade atualizada!']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
});

// EXCLUIR ATIVIDADE
router.post('/calendario/:id/excluir', requireAuth, requirePermissao('calendario'), async (req, res) => {
  try {
    await query('DELETE FROM calendario_atividades WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Atividade excluída.']);
    res.redirect(calendarioRedirect(req));
  } catch(e) { req.flash('erro', [e.message]); res.redirect(calendarioRedirect(req)); }
});

};
