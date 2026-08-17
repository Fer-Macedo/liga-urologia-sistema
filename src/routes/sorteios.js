// ═══ SORTEIOS ═════════════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');

module.exports = function (router) {

// Lista de sorteios
router.get('/sorteios', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const [sorteiosR, ligantesR, diretivosR, eventosR, processosR] = await Promise.all([
      query('SELECT * FROM sorteios ORDER BY criado_em DESC'),
      query("SELECT id, nome FROM membros WHERE ativo=1 ORDER BY nome"),
      query("SELECT id, nome FROM diretivos WHERE ativo=1 AND pendente=false ORDER BY nome"),
      // Concluído = status='confirmado' (mesma convenção de eventos e PSS). Conta só quem
      // concluiu de verdade, pendente não entra no sorteio.
      query("SELECT e.id, e.nome, (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id=e.id AND status='confirmado') as concluidos FROM eventos e ORDER BY e.criado_em DESC"),
      query("SELECT p.id, p.nome, (SELECT COUNT(*) FROM ps_candidatos WHERE processo_id=p.id AND status='confirmado') as concluidos FROM ps_processos p ORDER BY p.criado_em DESC")
    ]);
    res.render('pages/sorteios', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteios: sorteiosR.rows,
      ligantes: ligantesR.rows,
      diretivos: diretivosR.rows,
      eventosDisponiveis: eventosR.rows,
      processosDisponiveis: processosR.rows,
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
    const { tipo, nome, descricao, qtd_ganhadores, publico_alvo, participantes_manual, instagram_liga, origem_id } = req.body;
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
    // 'evento'/'pss': participantes são resolvidos NA HORA (ver GET /sorteios/:id) direto dos
    // inscritos/candidatos com status='confirmado' — nunca guarda uma lista fixa aqui, senão
    // quem concluir depois de criado o sorteio ficaria de fora.
    const origemTipo = (publico_alvo === 'evento' || publico_alvo === 'pss') ? publico_alvo : null;
    const origemId = origemTipo ? (parseInt(origem_id) || null) : null;

    const r = await query(
      `INSERT INTO sorteios (tipo,nome,descricao,qtd_ganhadores,publico_alvo,participantes_manual,instagram_liga,tarefas,status,criado_por,origem_tipo,origem_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rascunho',$9,$10,$11) RETURNING id`,
      [tipo, nome, descricao||null, parseInt(qtd_ganhadores)||1, publico_alvo||null, partManual, instagram_liga||null, tarefasJson, req.session.usuario.id, origemTipo, origemId]
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
      } else if(sorteio.publico_alvo === 'evento' && sorteio.origem_id){
        // Só quem CONCLUIU a inscrição (status='confirmado') — pendente não entra no sorteio.
        // Resolvido na hora (não é uma lista fixa): quem concluir depois de criado o sorteio
        // já entra automaticamente na próxima vez que a página for aberta.
        const r = await query("SELECT nome FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado' ORDER BY nome", [sorteio.origem_id]);
        participantes = r.rows.map(r=>r.nome);
      } else if(sorteio.publico_alvo === 'pss' && sorteio.origem_id){
        const r = await query("SELECT nome FROM ps_candidatos WHERE processo_id=$1 AND status='confirmado' ORDER BY nome", [sorteio.origem_id]);
        participantes = r.rows.map(r=>r.nome);
      }
    } else {
      const r = await query('SELECT * FROM sorteio_participantes WHERE sorteio_id=$1 ORDER BY criado_em', [sorteio.id]);
      participantes = r.rows.map(p=>p.nome);
    }

    let origemNome = null;
    if(sorteio.origem_tipo === 'evento' && sorteio.origem_id){
      const r = await query('SELECT nome FROM eventos WHERE id=$1', [sorteio.origem_id]);
      origemNome = r.rows[0]?.nome || null;
    } else if(sorteio.origem_tipo === 'pss' && sorteio.origem_id){
      const r = await query('SELECT nome FROM ps_processos WHERE id=$1', [sorteio.origem_id]);
      origemNome = r.rows[0]?.nome || null;
    }

    const ganhadores = sorteio.ganhador_nome ? sorteio.ganhador_nome.split('|') : [];

    res.render('pages/sorteio-detalhe', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteio, participantes, ganhadores, origemNome,
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

    req.flash('msg', [isValidado ? 'Ganhador validado e brinde registrado!' : 'Ganhador marcado como inválido.']);
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
