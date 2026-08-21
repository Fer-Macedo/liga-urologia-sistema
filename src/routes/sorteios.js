// ═══ SORTEIOS ═════════════════════════════════════════════════════════════════
const { query } = require('../models/database');
const { requireAuth, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const rateLimit = require('express-rate-limit');

const limiterVisualizacaoSorteio = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});
const limiterParticiparSorteio = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false
});

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

// Monta os campos comuns a criar/editar a partir do body do form — usado pelas duas rotas
// pra não duplicar a lógica de resolução de participantes/origem.
function resolverCamposSorteio(body) {
  const { tipo, nome, descricao, qtd_ganhadores, publico_alvo, participantes_manual, instagram_liga, origem_id } = body;
  const tarefas = body['tarefas[]'] ? (Array.isArray(body['tarefas[]']) ? body['tarefas[]'] : [body['tarefas[]']]) : [];
  const tarefasJson = tarefas.length ? JSON.stringify(tarefas.filter(t => t.trim())) : null;
  // Se publico_alvo='selecao', pegar nomes dos checkboxes selecionados
  let partManual = null;
  if (publico_alvo === 'selecao') {
    const selecionados = body['participantes_selecao[]']
      ? (Array.isArray(body['participantes_selecao[]']) ? body['participantes_selecao[]'] : [body['participantes_selecao[]']])
      : [];
    const extras = body['participantes_extra']
      ? body['participantes_extra'].split('\n').map(n=>n.trim()).filter(n=>n)
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
  // publico_alvo só existe/faz sentido pra sorteio 'interno' — se veio preenchido com um valor
  // válido, o tipo TEM que ser 'interno', não importa o que o formulário mandou no campo tipo.
  // Sem isso, um clique errado na tela deixa tipo='externo' com publico_alvo='evento' salvos
  // juntos: a busca de participantes olha só pra tipo e usa a tabela errada (sorteio_participantes,
  // vazia) — bug real que aconteceu em produção 17/08/2026.
  const publicosInterno = ['ligantes', 'diretivos', 'ambos', 'evento', 'pss', 'selecao', 'manual'];
  const tipoFinal = publicosInterno.includes(publico_alvo) ? 'interno' : tipo;
  return { tipo: tipoFinal, nome, descricao: descricao||null, qtdGanhadores: parseInt(qtd_ganhadores)||1, publicoAlvo: publico_alvo||null, partManual, instagramLiga: instagram_liga||null, tarefasJson, origemTipo, origemId };
}

// Resolve a lista de participantes de um sorteio conforme tipo/publico_alvo — usado tanto pra
// exibir a tela (GET /sorteios/:id) quanto pra validar, no confirmar-ganhador, que um nome
// escolhido (sorteado ou manual) realmente pertence a esse sorteio.
async function buscarParticipantesSorteio(sorteio) {
  // 19/08/2026: pedido do usuário — "Luciane Costa Rodrigues" aparecia certinho na lista mas o
  // registro manual dizia "Participante não encontrado". Causa raiz: o nome dela no cadastro do
  // evento tem um espaço sobrando no final ("Luciane Costa rodrigues ", artefato do formulário
  // público de inscrição). O confirmar-ganhador dá trim() no nome que chega do form, mas
  // comparava contra a lista de participantes SEM trim — "Luciane..." (trimado) nunca batia com
  // "Luciane... " (com espaço) por igualdade exata. Normaliza uma vez aqui, na fonte, pra tela,
  // roleta e confirmar-ganhador usarem sempre o mesmo nome "limpo".
  const limpo = n => (n || '').trim();
  let participantes = [];
  let contatosExternos = {};
  if (sorteio.tipo === 'interno') {
    if (sorteio.publico_alvo === 'ligantes') {
      const r = await query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome");
      participantes = r.rows.map(r => limpo(r.nome));
    } else if (sorteio.publico_alvo === 'diretivos') {
      const r = await query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome");
      participantes = r.rows.map(r => limpo(r.nome));
    } else if (sorteio.publico_alvo === 'ambos') {
      const [lig, dir] = await Promise.all([
        query("SELECT nome FROM membros WHERE ativo=1 ORDER BY nome"),
        query("SELECT nome FROM diretivos WHERE ativo=1 ORDER BY nome")
      ]);
      participantes = [...lig.rows.map(r => limpo(r.nome)), ...dir.rows.map(r => limpo(r.nome))];
    } else if ((sorteio.publico_alvo === 'manual' || sorteio.publico_alvo === 'selecao') && sorteio.participantes_manual) {
      participantes = JSON.parse(sorteio.participantes_manual).map(limpo);
    } else if (sorteio.publico_alvo === 'evento' && sorteio.origem_id) {
      const r = await query("SELECT nome FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado' ORDER BY nome", [sorteio.origem_id]);
      participantes = r.rows.map(r => limpo(r.nome));
    } else if (sorteio.publico_alvo === 'pss' && sorteio.origem_id) {
      const r = await query("SELECT nome FROM ps_candidatos WHERE processo_id=$1 AND status='confirmado' ORDER BY nome", [sorteio.origem_id]);
      participantes = r.rows.map(r => limpo(r.nome));
    }
  } else {
    const r = await query('SELECT * FROM sorteio_participantes WHERE sorteio_id=$1 ORDER BY criado_em', [sorteio.id]);
    participantes = r.rows.map(p => limpo(p.nome));
    r.rows.forEach(p => { contatosExternos[limpo(p.nome)] = { email: p.email, instagram: p.instagram, whatsapp: p.whatsapp }; });
  }
  return { participantes, contatosExternos };
}

// Busca email/whatsapp dos ganhadores JÁ CONFIRMADOS de um sorteio interno — pra poder entrar
// em contato e combinar a entrega do brinde. 19/08/2026: pedido do usuário. Só dos ganhadores
// (não dos ~500 participantes): além de desnecessário, carregar o contato de todo mundo só pra
// mostrar o de 1-2 pessoas seria expor dado sensível (e-mail/whatsapp de membro) sem motivo —
// sorteio externo já tem isso resolvido à parte, em contatosExternos (dado autodeclarado num
// formulário público, não o cadastro interno). PSS guarda telefone (não whatsapp) — alias pra
// contatoTexto() na view não precisar saber a diferença.
async function buscarContatosGanhadores(sorteio, ganhadores) {
  const contatos = {};
  if (sorteio.tipo !== 'interno' || !ganhadores.length) return contatos;
  let r = null;
  if (sorteio.publico_alvo === 'ligantes') {
    r = await query("SELECT nome, email, whatsapp FROM membros WHERE ativo=1");
  } else if (sorteio.publico_alvo === 'diretivos') {
    r = await query("SELECT nome, email, whatsapp FROM diretivos WHERE ativo=1 AND pendente=false");
  } else if (sorteio.publico_alvo === 'ambos') {
    const [lig, dir] = await Promise.all([
      query("SELECT nome, email, whatsapp FROM membros WHERE ativo=1"),
      query("SELECT nome, email, whatsapp FROM diretivos WHERE ativo=1 AND pendente=false")
    ]);
    r = { rows: [...lig.rows, ...dir.rows] };
  } else if (sorteio.publico_alvo === 'evento' && sorteio.origem_id) {
    r = await query("SELECT nome, email, whatsapp FROM evento_inscricoes WHERE evento_id=$1 AND status='confirmado'", [sorteio.origem_id]);
  } else if (sorteio.publico_alvo === 'pss' && sorteio.origem_id) {
    r = await query("SELECT nome, email, telefone AS whatsapp FROM ps_candidatos WHERE processo_id=$1 AND status='confirmado'", [sorteio.origem_id]);
  }
  if (r) {
    r.rows.forEach(row => {
      const nome = (row.nome || '').trim();
      if (ganhadores.includes(nome)) contatos[nome] = { email: row.email, whatsapp: row.whatsapp };
    });
  }
  return contatos;
}

// Criar sorteio
router.post('/sorteios/criar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const c = resolverCamposSorteio(req.body);
    const r = await query(
      `INSERT INTO sorteios (tipo,nome,descricao,qtd_ganhadores,publico_alvo,participantes_manual,instagram_liga,tarefas,status,criado_por,origem_tipo,origem_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rascunho',$9,$10,$11) RETURNING id`,
      [c.tipo, c.nome, c.descricao, c.qtdGanhadores, c.publicoAlvo, c.partManual, c.instagramLiga, c.tarefasJson, req.session.usuario.id, c.origemTipo, c.origemId]
    );
    req.flash('msg', ['Sorteio criado com sucesso!']);
    res.redirect('/sorteios/' + r.rows[0].id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios'); }
});

// Editar sorteio (só antes de sortear — depois de ter ganhador, usar "Resetar" primeiro)
router.post('/sorteios/:id/editar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const atual = await query('SELECT status, ganhador_nome FROM sorteios WHERE id=$1', [req.params.id]);
    if (!atual.rows.length) { req.flash('erro', ['Sorteio não encontrado.']); return res.redirect('/sorteios'); }
    // ganhador_nome pode estar preenchido mesmo com status ainda 'rascunho' — sorteio com mais
    // de 1 prêmio, em andamento, com alguns já confirmados e outros por sortear (ver
    // confirmar-ganhador). Editar nesse meio-tempo (trocar publico_alvo, qtd_ganhadores etc.)
    // corromperia o progresso — bloqueia igual já bloqueava pra status='sorteado'.
    if (atual.rows[0].status === 'sorteado' || atual.rows[0].ganhador_nome) {
      req.flash('erro', ['Este sorteio já tem ganhador sorteado — resete antes de editar.']);
      return res.redirect('/sorteios/' + req.params.id);
    }
    const c = resolverCamposSorteio(req.body);
    await query(
      `UPDATE sorteios SET tipo=$1,nome=$2,descricao=$3,qtd_ganhadores=$4,publico_alvo=$5,participantes_manual=$6,instagram_liga=$7,tarefas=$8,origem_tipo=$9,origem_id=$10 WHERE id=$11`,
      [c.tipo, c.nome, c.descricao, c.qtdGanhadores, c.publicoAlvo, c.partManual, c.instagramLiga, c.tarefasJson, c.origemTipo, c.origemId, req.params.id]
    );
    req.flash('msg', ['Sorteio atualizado com sucesso!']);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Detalhe do sorteio
router.get('/sorteios/:id', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const s = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    if(!s.rows.length) return res.redirect('/sorteios');
    const sorteio = s.rows[0];

    const { participantes, contatosExternos } = await buscarParticipantesSorteio(sorteio);

    let origemNome = null;
    if(sorteio.origem_tipo === 'evento' && sorteio.origem_id){
      const r = await query('SELECT nome FROM eventos WHERE id=$1', [sorteio.origem_id]);
      origemNome = r.rows[0]?.nome || null;
    } else if(sorteio.origem_tipo === 'pss' && sorteio.origem_id){
      const r = await query('SELECT nome FROM ps_processos WHERE id=$1', [sorteio.origem_id]);
      origemNome = r.rows[0]?.nome || null;
    }

    const ganhadores = sorteio.ganhador_nome ? sorteio.ganhador_nome.split('|') : [];
    const contatosGanhadores = await buscarContatosGanhadores(sorteio, ganhadores);

    res.render('pages/sorteio-detalhe', {
      config: await getConfig(), usuario: req.session.usuario,
      paginaAtual: 'sorteios',
      sorteio, participantes, contatosExternos, contatosGanhadores, ganhadores, origemNome,
      msg: req.flash('msg'), erro: req.flash('erro')
    });
  } catch(e) { res.send('ERRO: ' + e.message); }
});

// Confirma UM ganhador por vez (sorteado na roleta ou escolhido manualmente) — sempre ANEXA ao
// ganhador_nome já existente, nunca substitui a lista inteira. 19/08/2026: pedido do usuário —
// antes, um sorteio com qtd_ganhadores=2 sorteava e salvava os 2 nomes de uma vez só; na prática
// (evento ao vivo, ~500 pessoas) é comum o 1º sorteado não atender/não estar presente, e o nome
// errado ficava registrado como ganhador junto do certo. Agora cada prêmio é sorteado (ou
// escolhido manualmente) e confirmado individualmente.
// 20/08/2026: BUG REAL em produção, AO VIVO — qtd_ganhadores dessa rota costumava ser um TETO
// RÍGIDO: assim que o número de ganhadores confirmados batia com ele, essa rota passava a
// RECUSAR qualquer novo sorteio/registro (e o status virava 'sorteado', trocando o botão
// "Sortear" por "Refazer Sorteio" — sumindo com o jeito de continuar). Um sorteio criado com
// qtd_ganhadores=1 por engano (ou qualquer valor errado) ficava travado pra sempre depois do 1º
// ganhador, sem chance de corrigir ao vivo — só resetando tudo (perdendo os ganhadores já
// confirmados) resolvia. Corrigido na raiz: qtd_ganhadores agora é só um RÓTULO informativo
// ("Prêmio X de N") — nunca bloqueia. O admin sorteia/registra quantos ganhadores quiser, na
// hora que quiser, e só quando decidir que terminou é que clica em "Finalizar Sorteio"
// (ver rota /finalizar abaixo) pra travar e liberar a validação.
router.post('/sorteios/:id/confirmar-ganhador', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) {
      req.flash('erro', ['Selecione um participante.']);
      return res.redirect('/sorteios/' + req.params.id);
    }

    const s = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    if (!s.rows.length) return res.redirect('/sorteios');
    const sorteio = s.rows[0];

    if (sorteio.status === 'sorteado') {
      req.flash('erro', ['Este sorteio já foi finalizado — resete antes de registrar mais ganhadores.']);
      return res.redirect('/sorteios/' + req.params.id);
    }
    const atuais = sorteio.ganhador_nome ? sorteio.ganhador_nome.split('|') : [];
    if (atuais.includes(nome)) {
      req.flash('erro', ['Essa pessoa já foi confirmada como ganhadora nesse sorteio.']);
      return res.redirect('/sorteios/' + req.params.id);
    }
    // Nome tem que vir da lista real de participantes desse sorteio — vale tanto pro nome que
    // veio do sorteio automático (roleta) quanto pro escolhido manualmente (select da tela).
    const { participantes } = await buscarParticipantesSorteio(sorteio);
    if (!participantes.includes(nome)) {
      req.flash('erro', ['Participante não encontrado na lista deste sorteio.']);
      return res.redirect('/sorteios/' + req.params.id);
    }

    const novos = [...atuais, nome];
    await query(`UPDATE sorteios SET ganhador_nome=$1 WHERE id=$2`, [novos.join('|'), req.params.id]);
    req.flash('msg', ['Ganhador confirmado! Sorteie (ou registre) o próximo, ou finalize quando terminar.']);
    res.redirect('/sorteios/' + req.params.id);
  } catch(e) { req.flash('erro', [e.message]); res.redirect('/sorteios/' + req.params.id); }
});

// Finaliza o sorteio — ação EXPLÍCITA do admin (não mais automática ao bater qtd_ganhadores, ver
// comentário acima). Trava a lista de ganhadores (bloqueia confirmar-ganhador/editar) e libera a
// etapa de Validar. Fecha também a página pública de inscrição, pra sorteio externo.
router.post('/sorteios/:id/finalizar', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const s = await query('SELECT status, ganhador_nome FROM sorteios WHERE id=$1', [req.params.id]);
    if (!s.rows.length) return res.redirect('/sorteios');
    if (s.rows[0].status === 'sorteado') return res.redirect('/sorteios/' + req.params.id);
    if (!s.rows[0].ganhador_nome) {
      req.flash('erro', ['Sorteie ou registre pelo menos um ganhador antes de finalizar.']);
      return res.redirect('/sorteios/' + req.params.id);
    }
    await query("UPDATE sorteios SET status='sorteado', sorteado_em=NOW(), sorteado_por=$1 WHERE id=$2", [req.session.usuario.id, req.params.id]);
    req.flash('msg', ['Sorteio finalizado — agora é só validar.']);
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

// QR Code (PNG) do link de inscrição pública — mesmo padrão já usado no check-out de eventos
// (reaproveita o mesmo serviço externo, api.qrserver.com, em vez de trazer lib nova).
router.get('/sorteios/:id/qrcode', requireAuth, requirePermissao('sorteios'), async (req, res) => {
  try {
    const link = 'https://inscricao.lauroucpcde.com/participar/' + req.params.id;
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=png&data=' + encodeURIComponent(link);
    const r = await fetch(qrUrl);
    if (!r.ok) return res.status(502).send('Erro ao gerar QR Code.');
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="sorteio-qr-' + req.params.id + '.png"');
    res.send(buf);
  } catch(e) { console.error('Sorteio QR erro:', e.message); res.status(500).send('Erro ao gerar QR Code.'); }
});

// ─── PÁGINA PÚBLICA DE INSCRIÇÃO (sorteio Externo) ──────────────────────────────
// Único lugar do sistema onde uma pessoa de FORA se cadastra sem estar em nenhuma
// tabela (ligante/diretivo/inscrito de evento). Fecha assim que o sorteio é sorteado.
router.get('/participar/:id', limiterVisualizacaoSorteio, async (req, res) => {
  try {
    const r = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    const sorteio = r.rows[0];
    if (!sorteio || sorteio.tipo !== 'externo') return res.status(404).send('Sorteio não encontrado.');
    const aberto = sorteio.status !== 'sorteado';
    const tarefas = sorteio.tarefas ? JSON.parse(sorteio.tarefas) : [];
    res.render('pages/sorteio-participar-publico', { sorteio, tarefas, config: await getConfig(), aberto, sucesso: false, jaInscrito: false, erro: null, nome: null });
  } catch(e) { console.error('Participar GET erro:', e.message); res.status(500).send('Erro ao carregar.'); }
});

router.post('/participar/:id', limiterParticiparSorteio, async (req, res) => {
  try {
    const r = await query('SELECT * FROM sorteios WHERE id=$1', [req.params.id]);
    const sorteio = r.rows[0];
    if (!sorteio || sorteio.tipo !== 'externo') return res.status(404).send('Sorteio não encontrado.');
    const cfgPub = await getConfig();
    const tarefas = sorteio.tarefas ? JSON.parse(sorteio.tarefas) : [];
    const aberto = sorteio.status !== 'sorteado';
    if (!aberto) {
      return res.render('pages/sorteio-participar-publico', { sorteio, tarefas, config: cfgPub, aberto: false, sucesso: false, jaInscrito: false, erro: 'As inscrições deste sorteio já foram encerradas.', nome: null });
    }

    const nome = (req.body.nome || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const instagram = (req.body.instagram || '').trim();
    const whatsappNum = (req.body.whatsapp_num || '').replace(/\D/g, '');
    const whatsapp = whatsappNum ? (req.body.ddi || '+595') + whatsappNum : '';
    if (!nome || !email || !instagram || !whatsappNum) {
      return res.render('pages/sorteio-participar-publico', { sorteio, tarefas, config: cfgPub, aberto: true, sucesso: false, jaInscrito: false, erro: 'Completa todos los campos.', nome: null });
    }

    const jaExiste = await query('SELECT id FROM sorteio_participantes WHERE sorteio_id=$1 AND LOWER(email)=$2', [req.params.id, email]);
    if (jaExiste.rows.length > 0) {
      return res.render('pages/sorteio-participar-publico', { sorteio, tarefas, config: cfgPub, aberto: true, sucesso: false, jaInscrito: true, erro: null, nome: nome.split(' ')[0] });
    }

    await query(
      'INSERT INTO sorteio_participantes (sorteio_id, nome, email, instagram, whatsapp) VALUES ($1,$2,$3,$4,$5)',
      [req.params.id, nome, email, instagram || null, whatsapp || null]
    );
    res.render('pages/sorteio-participar-publico', { sorteio, tarefas, config: cfgPub, aberto: true, sucesso: true, jaInscrito: false, erro: null, nome: nome.split(' ')[0] });
  } catch(e) { console.error('Participar POST erro:', e.message); res.status(500).send('Erro ao inscrever.'); }
});

};
