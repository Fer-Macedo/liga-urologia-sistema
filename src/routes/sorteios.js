// ═══ SORTEIOS ═════════════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// Lista de sorteios
router.get('/sorteios', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const [sorteiosR, ligantesR, diretivosR] = await Promise.all([
      query('SELECT * FROM sorteios ORDER BY criado_em DESC'),
      query("SELECT id, nome FROM membros WHERE ativo=1 ORDER BY nome"),
      query("SELECT id, nome FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome")
    ]);
    res.render('pages/sorteios', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteios: sorteiosR.rows,
      ligantes: ligantesR.rows,
      diretivos: diretivosR.rows,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { console.error(e); res.send('ERRO: ' + e.message); }
});

// Roleta animada
router.get('/sorteios/roleta', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const [lig, dir] = await Promise.all([
      query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome"),
      query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome")
    ]);
    res.render('pages/roleta', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      ligantes: lig.rows.map(r => r.nome),
      diretivos: dir.rows.map(r => r.nome)
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

// Criar sorteio
router.post('/sorteios/criar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    console.log('[SORTEIO DEBUG] body:', JSON.stringify({
      publico_alvo: req.body.publico_alvo,
      selecao: req.body['participantes_selecao[]'],
      extra: req.body['participantes_extra'],
      manual: req.body['participantes_manual']
    }));
    const { tipo, nome, descricao, qtd_ganhadores, publico_alvo, participantes_manual, instagram_liga } = req.body;
    const tarefas = req.body['tarefas[]'] ? (Array.isArray(req.body['tarefas[]']) ? req.body['tarefas[]'] : [req.body['tarefas[]']]) : [];
    const tarefasJson = tarefas.length ? JSON.stringify(tarefas.filter(t => t.trim())) : null;
    // Se publico_alvo='selecao', pegar nomes dos checkboxes selecionados
    let partManual = null;
    if (publico_alvo === 'selecao') {
      // Checkboxes selecionados
      const selecionados = req.body['participantes_selecao[]']
        ? (Array.isArray(req.body['participantes_selecao[]']) ? req.body['participantes_selecao[]'] : [req.body['participantes_selecao[]']])
        : [];
      // Nomes extras digitados manualmente
      const extras = req.body['participantes_extra']
        ? req.body['participantes_extra'].split('\n').map(n=>n.trim()).filter(n=>n)
        : [];
      const todos = [...selecionados, ...extras];
      partManual = todos.length ? JSON.stringify(todos) : null;
    } else if (participantes_manual) {
      partManual = JSON.stringify(participantes_manual.split('\n').map(n=>n.trim()).filter(n=>n));
    }

    const r = await query(
      `INSERT INTO sorteios (tipo,nome,descricao,qtd_ganhadores,publico_alvo,participantes_manual,instagram_liga,tarefas,status,criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rascunho',$9) RETURNING id`,
      [tipo, nome, descricao||null, parseInt(qtd_ganhadores)||1, publico_alvo||null, partManual, instagram_liga||null, tarefasJson, req.session.usuario.id]
    );
    req.flash('msg', ['Sorteio criado com sucesso!']);
    res.redirect('/sorteios/' + r.rows[0].id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios'); }
});

// Detalhe do sorteio
router.get('/sorteios/:id', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const s = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    if(!s.rows.length) return res.redirect('/sorteios');
    const sorteio = s.rows[0];

    // Buscar participantes conforme o tipo
    let participantes = [];
    if(sorteio.tipo === 'interno'){
      if(sorteio.publico_alvo === 'ligantes'){
        const r = await query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome");
        participantes = r.rows.map(r=>r.nome);
      } else if(sorteio.publico_alvo === 'diretivos'){
        const r = await query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome");
        participantes = r.rows.map(r=>r.nome);
      } else if(sorteio.publico_alvo === 'ambos'){
        const [lig, dir] = await Promise.all([
          query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome"),
          query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome")
        ]);
        participantes = [...lig.rows.map(r=>r.nome), ...dir.rows.map(r=>r.nome)];
      } else if((sorteio.publico_alvo === 'manual' || sorteio.publico_alvo === 'selecao') && sorteio.participantes_manual){
        participantes = JSON.parse(sorteio.participantes_manual);
      }
    } else {
      const r = await query('SELECT * FROM sorteio_participantes WHERE sorteio_id=$1 ORDER BY criado_em', [sorteio.id]);
      participantes = r.rows.map(p=>p.nome);
    }

    const ganhadores = sorteio.ganhador_nome ? sorteio.ganhador_nome.split('|') : [];

    res.render('pages/sorteio-detalhe', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteio, participantes, ganhadores,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

// Salvar resultado do sorteio
router.post('/sorteios/:id/salvar-resultado', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const ganhadores = JSON.parse(req.body.ganhadores || '[]');
    const ganhadorNome = ganhadores.join('|');
    await query(
      `UPDATE sorteios SET status='sorteado', ganhador_nome=$1, sorteado_em=NOW(), sorteado_por=$2 WHERE id=$3`,
      [ganhadorNome, req.session.usuario.id, req.params.id]
    );
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Validar ganhador
router.post('/sorteios/:id/validar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const { brinde, ganhador_contato, observacoes_validacao, validado } = req.body;
    const tarefasCumpridas = req.body.tarefas_cumpridas
      ? JSON.stringify(Array.isArray(req.body.tarefas_cumpridas) ? req.body.tarefas_cumpridas : [req.body.tarefas_cumpridas])
      : null;
    const isValidado = validado === 'true';

    await query(
      `UPDATE sorteios SET validado=$1, brinde=$2, ganhador_contato=$3, observacoes_validacao=$4, tarefas_cumpridas=$5 WHERE id=$6`,
      [isValidado, brinde||null, ganhador_contato||null, observacoes_validacao||null, tarefasCumpridas, req.params.id]
    );

    req.flash('msg', [isValidado ? '✅ Ganhador validado e brinde registrado!' : '❌ Ganhador marcado como inválido.']);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Resetar sorteio
router.get('/sorteios/:id/resetar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    await query(`UPDATE sorteios SET status='rascunho', ganhador_nome=NULL, ganhador_contato=NULL, brinde=NULL, validado=FALSE, sorteado_em=NULL, tarefas_cumpridas=NULL WHERE id=$1`, [req.params.id]);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { res.redirect('/sorteios/' + req.params.id); }
});

// Excluir sorteio
router.post('/sorteios/:id/excluir', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    await query('DELETE FROM sorteios WHERE id=$1', [req.params.id]);
    req.flash('msg', ['Sorteio excluído.']);
    res.redirect('/sorteios');
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios'); }
});

};
