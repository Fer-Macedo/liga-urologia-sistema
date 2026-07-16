const { query } = require('../models/database');
const { requireAuth, requireMembro } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { limiterLogin, limiterEsqueciSenha, limiterCodigoRecuperacao, limiterPagamentoCartao } = require('../services/rate-limiters');

module.exports = function (router) {

router.get('/membro/foto/:tipo/:id', requireMembro, async (req, res) => {
  const { tipo, id } = req.params;
  const tabela = tipo==='diretivo'?'diretivos':'ligantes';
  const r = await query(`SELECT foto_chave FROM ${tabela} WHERE id=$1`, [id]);
  if(!r.rows[0]||!r.rows[0].foto_chave) return res.status(404).send('');
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
  const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:r.rows[0].foto_chave }), { expiresIn:3600 });
  res.redirect(url);
});

// ─── PORTAL DO MEMBRO ────────────────────────────────────────────────────────
const bcryptMembro = require('bcrypt');
const { CAMPOS_MEUS_DADOS } = require('../services/campos-meus-dados');

function membroCompletoEdicao(config, membro, tipo) {
  return membro.edicao_liberada || config[`edicao_${tipo}s_grupo`] === '1';
}

async function getMembroPortal(tipo, id) {
  if (tipo === 'ligante') {
    const r = await query('SELECT id, nome, email, whatsapp FROM ligantes WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
  } else {
    const r = await query('SELECT id, nome, email, whatsapp FROM diretivos WHERE id=$1 AND ativo=1 AND pendente=false', [id]);
    return r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
  }
}

// GET /membro/perfil/:tipo/:id - pagina publica de perfil, linkada pelo site institucional (lauroucpcde.com)
// Mostra so nome, foto e cargo/semestre (mesmos dados ja expostos em /api/equipe-publica) - sem login, sem dado sensivel.
router.get('/membro/perfil/:tipo/:id', async (req, res) => {
  try {
    const { gerarUrlInline } = require('../services/arquivos');
    const { rotuloAniversario } = require('../services/cargo-genero');
    const tipo = req.params.tipo === 'diretivo' ? 'diretivo' : 'ligante';
    const r = tipo === 'diretivo'
      ? await query("SELECT id, nome, cargo, sexo, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM diretivos WHERE id=$1 AND ativo=1 AND pendente=false", [req.params.id])
      : await query("SELECT id, nome, COALESCE(foto_site_chave, foto_chave) as foto_chave FROM ligantes WHERE id=$1 AND ativo=1 AND pendente=false", [req.params.id]);
    if (!r.rows.length) return res.status(404).send('Perfil no encontrado');
    const m = r.rows[0];
    let foto_url = null;
    if (m.foto_chave) { try { foto_url = await gerarUrlInline(m.foto_chave); } catch(e) {} }
    const pessoa = { nome: m.nome, cargo: rotuloAniversario({ tipo, cargo: m.cargo, sexo: m.sexo }), foto_url };
    res.render('pages/membro/perfil-publico', { pessoa, tipo });
  } catch(e) { res.status(500).send('Error al cargar el perfil'); }
});

// GET /membro/login
router.get('/membro/login', (req, res) => {
  if (req.session.membroPortal) return res.redirect('/membro/dashboard');
  res.render('pages/membro/login', { erro: null });
});

// POST /membro/login
router.post('/membro/login', limiterLogin, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.render('pages/membro/login', { erro: 'Preencha email e senha.' });
  let membro = null, tipo = null, id = null;
  const l = await query('SELECT id, nome, email FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
  if (l.rows.length) { membro = l.rows[0]; tipo = 'ligante'; id = l.rows[0].id; }
  if (!membro) {
    const d = await query('SELECT id, nome, email FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1 AND pendente=false', [email]);
    if (d.rows.length) { membro = d.rows[0]; tipo = 'diretivo'; id = d.rows[0].id; }
  }
  if (!membro) {
    // Verificar se existe mas está inativo
    const lInat = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1)', [email]);
    const dInat = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1)', [email]);
    if (lInat.rows.length || dInat.rows.length) {
      return res.render('pages/membro/login', { erro: 'Você não tem mais permissão para acessar essa área. Esta área é restrita a membros ativos da Liga.' });
    }
    return res.render('pages/membro/login', { erro: 'Email não encontrado.' });
  }
  const senhaR = await query('SELECT senha_hash, primeiro_acesso FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  if (!senhaR.rows.length) return res.render('pages/membro/login', { erro: 'Acesso não configurado. Contate a secretaria.' });
  const ok = await bcryptMembro.compare(senha, senhaR.rows[0].senha_hash);
  if (!ok) return res.render('pages/membro/login', { erro: 'Senha incorreta.' });
  req.session.membroPortal = { tipo, id, nome: membro.nome, email: membro.email };
  if (senhaR.rows[0].primeiro_acesso) return res.redirect('/membro/trocar-senha');
  res.redirect('/membro/dashboard');
});

// GET /membro/trocar-senha
router.get('/membro/trocar-senha', requireMembro, (req, res) => {
  res.render('pages/portal/trocar-senha', { erro: null, baseUrl: '/membro' });
});

// POST /membro/trocar-senha
router.post('/membro/trocar-senha', requireMembro, limiterLogin, async (req, res) => {
  const { senha_atual, nova_senha, confirmar_senha } = req.body;
  if (!nova_senha || nova_senha.length < 8) return res.render('pages/portal/trocar-senha', { erro: ['Senha deve ter pelo menos 8 caracteres.'], baseUrl: '/membro' });
  if (nova_senha !== confirmar_senha) return res.render('pages/portal/trocar-senha', { erro: ['Senhas não conferem.'], baseUrl: '/membro' });
  const { tipo, id } = req.session.membroPortal;
  const bcryptMembro = require('bcryptjs');
  const senhaAtualR = await query('SELECT senha_hash FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', [tipo, id]);
  const senhaAtualOk = senhaAtualR.rows.length && await bcryptMembro.compare(senha_atual || '', senhaAtualR.rows[0].senha_hash);
  if (!senhaAtualOk) return res.render('pages/portal/trocar-senha', { erro: ['Senha atual incorreta.'], baseUrl: '/membro' });
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, tipo, id]);
  res.redirect('/membro/dashboard');
});

// GET /membro/logout
router.get('/membro/logout', (req, res) => {
  req.session.membroPortal = null;
  res.redirect('/membro/login');
});

// GET /membro/dashboard
router.get('/membro/dashboard', requireMembro, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  if (!membro) { req.session.membroPortal = null; return res.redirect('/membro/login'); }
  const hoje = new Date().toISOString().split('T')[0];
  const mesAtual = hoje.substring(0, 7);
  // Cobrança atual
  const mesRef = mesAtual.replace('-','');
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' AND status IN ('pendente','atrasado') ORDER BY data_vencimento DESC LIMIT 1`, [membro.email]);
  const cobrancaAtual = cobR.rows[0] || null;
  // Frequencia ligante
  let frequencia = { percentual: 0, presencas: 0, total: 0 };
  if (tipo === 'ligante') {
    const membroDashR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
    const membroDashId = membroDashR.rows[0]?.id;
    if(membroDashId) {
      const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroDashId]);
      if(tmR.rows.length) {
        const fR = await query('SELECT COUNT(*) FILTER (WHERE p.presente=1) as presencas, COUNT(*) as total FROM atividades a LEFT JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2', [membroDashId, tmR.rows[0].turma_id]);
        if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
      }
    }
  } else if (tipo === 'diretivo') {
    const fR = await query(`SELECT COUNT(*) FILTER (WHERE dp.presente=1) as presencas, COUNT(*) as total FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1`,[id]);
    if(fR.rows[0]) { const p=parseInt(fR.rows[0].presencas)||0; const t=parseInt(fR.rows[0].total)||0; frequencia={presencas:p,total:t,percentual:t>0?Math.round(p/t*100):0}; }
  }
  // Comunicados
  const comR = await query(`
    SELECT c.*, 
      CASE WHEN cl.id IS NOT NULL THEN true ELSE false END as lido
    FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) 
    ORDER BY c.criado_em DESC LIMIT 10
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const naoLidosR = await query(`
    SELECT COUNT(*) as total FROM comunicados c
    LEFT JOIN comunicados_leituras cl ON cl.comunicado_id=c.id AND cl.membro_tipo=$2 AND cl.membro_id=$3
    WHERE c.ativo=true AND (c.destinatarios='todos' OR c.destinatarios=$1) AND cl.id IS NULL
  `, [tipo==='ligante'?'ligantes':'diretivos', tipo, id]);
  const comunicadosNaoLidos = parseInt(naoLidosR.rows[0]?.total)||0;
  // Proximo evento
  const evR = await query(`SELECT id, nome, data_inicio, local FROM eventos WHERE data_inicio >= NOW() ORDER BY data_inicio ASC LIMIT 1`);
  // Grupos cientificos
  const grR = await query(`SELECT gc.nome as gnome, pc.titulo as ptitulo FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id JOIN projetos_cientificos pc ON pc.id=gc.projeto_id WHERE m.origem_tipo=$1 AND m.origem_id=$2`, [tipo, id]);
  const cientAvisosR = await query(`
    SELECT COUNT(*) as total FROM avisos_cientificos a
    WHERE a.criado_em >= NOW() - INTERVAL '7 days'
    AND (
      a.grupo_id IN (SELECT grupo_id FROM membros_grupo_cientifico WHERE origem_tipo=$1 AND origem_id=$2)
      OR a.projeto_id IN (SELECT gc.projeto_id FROM membros_grupo_cientifico m JOIN grupos_cientificos gc ON gc.id=m.grupo_id WHERE m.origem_tipo=$1 AND m.origem_id=$2)
    )
  `, [tipo, id]).catch(()=>({rows:[{total:0}]}));
  // Trabalhos devolvidos para correcao contam como pendencia do membro tambem, nao so avisos
  const cientDevolvidosR = await query(`
    SELECT COUNT(*) as total FROM versoes_trabalho v
    WHERE v.status='devolvido' AND v.grupo_id IN (SELECT grupo_id FROM membros_grupo_cientifico WHERE origem_tipo=$1 AND origem_id=$2)
  `, [tipo, id]).catch(()=>({rows:[{total:0}]}));
  const cientificoAvisos = (parseInt(cientAvisosR.rows[0]?.total)||0) + (parseInt(cientDevolvidosR.rows[0]?.total)||0);
  res.render('pages/membro/dashboard', { membro, cobrancaAtual, frequencia, comunicados: comR.rows, comunicadosNaoLidos, proximoEvento: evR.rows[0]||null, grupos: grR.rows, cientificoAvisos });
});

// GET /membro/pagbank/chave-publica — chave p/ criptografar cartao no navegador
router.get('/membro/pagbank/chave-publica', requireMembro, async (req, res) => {
  const { obterChavePublica } = require('../services/pagbank');
  const r = await obterChavePublica();
  if (!r.ok) return res.status(502).json({ ok: false, erro: 'Nao foi possivel iniciar o pagamento. Tente novamente.' });
  res.json({ ok: true, publicKey: r.publicKey });
});

// POST /membro/pagar-cartao — pagamento com cartao embutido no portal (sem redirecionar)
router.post('/membro/pagar-cartao', requireMembro, limiterPagamentoCartao, async (req, res) => {
  try {
    const { tipo, id } = req.session.membroPortal;
    const { cobranca_id, encryptedCard, holder_name, holder_cpf } = req.body;
    if (!cobranca_id || !encryptedCard || !holder_name) return res.json({ ok: false, erro: 'Dados do cartao incompletos.' });

    const membro = await getMembroPortal(tipo, id);
    if (!membro) return res.json({ ok: false, erro: 'Sessao invalida.' });

    // Garante que a cobranca pertence ao proprio membro logado (evita pagar cobranca de outro)
    const cobR = await query(
      `SELECT c.* FROM cobrancas c JOIN membros m ON m.id=c.membro_id
       WHERE c.id=$1 AND LOWER(m.email)=LOWER($2) AND c.status IN ('pendente','atrasado')`,
      [cobranca_id, membro.email]
    );
    if (!cobR.rows.length) return res.json({ ok: false, erro: 'Cobranca nao encontrada ou ja paga.' });
    const cob = cobR.rows[0];

    const { pagarComCartao } = require('../services/pagbank');
    const dentroDoPrazo = !require('dayjs')().isAfter(require('dayjs')(cob.data_vencimento).endOf('day'));
    const valorPagar = (cob.valor_desconto != null && dentroDoPrazo) ? cob.valor_desconto : cob.valor_cheio;
    const r = await pagarComCartao({
      referencia: cob.referencia,
      valor: valorPagar,
      membro: { nome: membro.nome, email: membro.email, cpf: membro.cpf },
      encryptedCard,
      holderName: holder_name,
      holderCpf: holder_cpf
    });

    if (!r.ok) return res.json({ ok: false, erro: r.erro });
    if (!r.aprovado) return res.json({ ok: false, erro: 'Pagamento nao aprovado (status: ' + r.status + '). Verifique os dados do cartao ou tente outro cartao.' });

    await query("UPDATE cobrancas SET status='pago', data_pagamento=NOW(), pagbank_charge_id=$1, metodo_pagamento='cartao', valor_pago=$3 WHERE id=$2", [r.charge_id, cob.id, valorPagar]);
    try {
      const { lancarMensalidadeNoFluxo } = require('../services/fluxo-mensalidade');
      await lancarMensalidadeNoFluxo(query, cob.id);
    } catch(e) { console.error('lancar fluxo (cartao portal):', e.message); }

    res.json({ ok: true });
  } catch(e) {
    console.error('/membro/pagar-cartao erro:', e.message);
    res.json({ ok: false, erro: 'Erro ao processar pagamento. Tente novamente.' });
  }
});

// GET /membro/financeiro/dados — API JSON para historico inline
router.get('/membro/financeiro/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const membro = await getMembroPortal(tipo, id);
    const cobR = await query("SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC", [membro.email]);
    res.json({ cobrancas: cobR.rows });
  } catch(e) { res.json({ cobrancas: [], error: e.message }); }
});

// GET /membro/financeiro
router.get('/membro/financeiro', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const membro = await getMembroPortal(tipo, id);
  const cobR = await query(`SELECT * FROM cobrancas WHERE membro_id=(SELECT id FROM membros WHERE LOWER(email)=LOWER($1) LIMIT 1) AND status != 'cancelado' ORDER BY data_vencimento DESC`, [membro.email]);
  res.render('pages/membro/financeiro', { membro, cobrancas: cobR.rows });
});

// POST /membro/comunicado/:id/lido — marcar comunicado como lido
router.post('/membro/comunicado/:id/lido', requireMembro, async (req, res) => {
  try {
    const { tipo, id } = req.session.membroPortal;
    await query(
      'INSERT INTO comunicados_leituras (comunicado_id, membro_tipo, membro_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, tipo, id]
    );
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, erro: e.message }); }
});

// GET /membro/frequencia — redireciona para dashboard (novo portal)
router.get('/membro/frequencia', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#frequencia');
});

// GET /membro/frequencia/dados — API JSON para historico inline
router.get('/membro/frequencia/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  let registros = [];
  try {
    if (tipo === 'ligante') {
      const membroR = await query('SELECT id FROM membros WHERE LOWER(email)=LOWER((SELECT email FROM ligantes WHERE id=$1))', [id]);
      const membroId = membroR.rows[0]?.id;
      if(membroId) {
        const tmR = await query('SELECT turma_id FROM turma_membros WHERE membro_id=$1 ORDER BY criado_em DESC LIMIT 1', [membroId]);
        if(tmR.rows.length) {
          const fR = await query(`SELECT a.data_atividade as data, a.descricao, p.presente FROM atividades a INNER JOIN presencas p ON p.atividade_id=a.id AND p.membro_id=$1 WHERE a.turma_id=$2 ORDER BY a.data_atividade DESC LIMIT 50`, [membroId, tmR.rows[0].turma_id]);
          registros = fR.rows;
        }
      }
    } else if (tipo === 'diretivo') {
      const fR = await query(`SELECT a.data_atividade as data, a.descricao, COALESCE(dp.presente,0) as presente FROM diretivo_atividades a INNER JOIN diretivo_presencas dp ON dp.atividade_id=a.id AND dp.diretivo_id=$1 ORDER BY a.data_atividade DESC LIMIT 50`, [id]);
      registros = fR.rows;
    }
    res.json({ registros });
  } catch(e) { res.json({ registros: [], error: e.message }); }
});

// GET /membro/eventos — redireciona para dashboard (novo portal)
router.get('/membro/eventos', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#eventos');
});

// GET /membro/eventos/dados — API JSON para eventos inline
router.get('/membro/eventos/dados', requireMembro, async (req, res) => {
  try {
    const evR = await query(`SELECT id, nome, data_inicio, local, descricao, status FROM eventos ORDER BY data_inicio DESC LIMIT 30`);
    res.json({ eventos: evR.rows });
  } catch(e) { res.json({ eventos: [], error: e.message }); }
});

// GET /membro/agenda — redireciona para dashboard (novo portal)
router.get('/membro/agenda', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#agenda');
});

// GET /membro/agenda/dados — API JSON para calendario inline
router.get('/membro/agenda/dados', requireMembro, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes) || (new Date().getMonth()+1);
    const ano = parseInt(req.query.ano) || new Date().getFullYear();
    const evR = await query(`SELECT id, titulo, descricao, data_inicio, data_fim, dia_inteiro, local, link_externo, cor FROM calendario_atividades WHERE publico = TRUE ORDER BY data_inicio ASC`);
    const anivR = await query(`SELECT id, nome, tipo, foto_chave, TO_CHAR(data_nascimento::date,'YYYY-MM-DD') as data_nascimento FROM (SELECT id, nome, data_nascimento, foto_chave, 'ligante' as tipo FROM ligantes WHERE ativo=1 AND data_nascimento IS NOT NULL UNION ALL SELECT id, nome, data_nascimento, foto_chave, 'diretivo' as tipo FROM diretivos WHERE ativo=1 AND data_nascimento IS NOT NULL) t WHERE EXTRACT(MONTH FROM data_nascimento::date)=$1 ORDER BY EXTRACT(DAY FROM data_nascimento::date)`, [mes]);
    res.json({ eventos: evR.rows, aniversariantes: anivR.rows });
  } catch(e) { res.json({ eventos: [], aniversariantes: [], error: e.message }); }
});

// GET /membro/comunicados — redireciona para dashboard (novo portal)
router.get('/membro/comunicados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try { await query(`UPDATE portal_cientifico_senhas SET ultimo_acesso_comunicados=NOW() WHERE origem_tipo=$1 AND origem_id=$2`, [tipo, id]); } catch(e) {}
  res.redirect('/membro/dashboard#comunicados');
});

// GET /membro/perfil/dados
router.get('/membro/perfil/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const config = await getConfig();
    let dados = null;
    if (tipo === 'ligante') {
      const r = await query(`SELECT id, nome, email, email_alternativo, whatsapp, data_nascimento, sexo, rg, cpf,
        semestre, turma, semestre_ingresso, catraca, orcid, foto_chave, edicao_liberada,
        tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo,
        contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao
        FROM ligantes WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'ligante' } : null;
    } else {
      const r = await query(`SELECT id, nome, email, whatsapp, data_nascimento, sexo, rg, cpf, catraca, cargo,
        semestre_turma, orcid, instagram, graduacao, ano_ingresso, onde_reside, edicao_liberada,
        transporte_proprio, tipo_transporte, disponibilidade, experiencia_urologia, foto_chave
        FROM diretivos WHERE id=$1`, [id]);
      dados = r.rows[0] ? { ...r.rows[0], tipo: 'diretivo' } : null;
    }
    if (!dados) return res.json({ dados: null, podeEditar: false, correcaoPendente: null });
    const pendR = await query("SELECT id, criado_em FROM cadastro_correcoes WHERE origem_tipo=$1 AND origem_id=$2 AND status='pendente'", [tipo, id]);
    res.json({
      dados,
      podeEditar: !!membroCompletoEdicao(config, dados, tipo),
      correcaoPendente: pendR.rows[0] || null
    });
  } catch(e) { res.json({ dados: null, podeEditar: false, correcaoPendente: null, error: e.message }); }
});

// Envio de correção de cadastro pelo Portal do Membro → vira pendência em /correcoes-cadastro
router.post('/membro/perfil/atualizar', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const config = await getConfig();
    const r = await query(`SELECT * FROM ${tipo === 'ligante' ? 'ligantes' : 'diretivos'} WHERE id=$1`, [id]);
    const membro = r.rows[0];
    if (!membro) return res.status(401).json({ ok: false, erro: 'Sessão expirada. Entre novamente.' });
    if (!membroCompletoEdicao(config, membro, tipo)) return res.json({ ok: false, erro: 'A edição de cadastro não está liberada para você no momento.' });
    const pendR = await query("SELECT id FROM cadastro_correcoes WHERE origem_tipo=$1 AND origem_id=$2 AND status='pendente'", [tipo, id]);
    if (pendR.rows.length) return res.json({ ok: false, erro: 'Você já tem uma atualização em análise. Aguarde a avaliação da equipe.' });

    // Só exigidos quando a resposta anterior os torna aplicáveis (ex.: "qual formação?" só se tem formação)
    const CONDICIONAIS = ['qual_formacao', 'qual_cargo', 'tipo_transporte'];
    const dados = {}, faltando = [];
    CAMPOS_MEUS_DADOS[tipo].forEach(c => {
      let v = req.body[c];
      if (c === 'disponibilidade') v = [].concat(req.body.disponibilidade || []).join(', ');
      dados[c] = v;
      if (!CONDICIONAIS.includes(c) && (!v || !String(v).trim())) faltando.push(c);
    });
    const vazio = c => !dados[c] || !String(dados[c]).trim();
    if (tipo === 'ligante') {
      if (dados.tem_formacao === 'Sim' && vazio('qual_formacao')) faltando.push('qual_formacao');
      if (dados.aceita_cargo === 'Sim' && vazio('qual_cargo')) faltando.push('qual_cargo');
    } else if (dados.transporte_proprio === 'Sim' && vazio('tipo_transporte')) faltando.push('tipo_transporte');
    if (faltando.length) return res.json({ ok: false, erro: 'Preencha todos os campos obrigatórios antes de enviar.' });

    await query('INSERT INTO cadastro_correcoes (origem_tipo, origem_id, dados) VALUES ($1,$2,$3)', [tipo, id, JSON.stringify(dados)]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, erro: e.message }); }
});

// GET /membro/estatuto/dados
router.get('/membro/estatuto/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='estatuto_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Estatuto nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar estatuto.' }); }
});

// GET /membro/regulamento/dados
router.get('/membro/regulamento/dados', requireMembro, async (req, res) => {
  try {
    const r = await query("SELECT valor FROM configuracoes WHERE chave='regulamento_pdf_chave'");
    const chave = r.rows[0]?.valor || '';
    if (!chave) return res.json({ url: null, msg: 'Regulamento nao disponivel ainda.' });
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY }});
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket:process.env.R2_BUCKET||'liga-urologia-files', Key:chave }), { expiresIn:3600 });
    res.json({ url });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar regulamento.' }); }
});

// GET /membro/contrato/dados
router.get('/membro/contrato/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const r = tipo === 'ligante'
      ? await query('SELECT pdf_assinado_chave, status, criado_em FROM contratos_ligantes WHERE ligante_id=$1 ORDER BY criado_em DESC LIMIT 1', [id])
      : await query('SELECT pdf_assinado_chave, status, criado_em FROM contratos_diretivos WHERE diretivo_id=$1 ORDER BY criado_em DESC LIMIT 1', [id]);
    const msgSemContrato = 'Você ainda não possui contrato assinado. Por favor, procure a secretaria para regularizar sua situação.';
    if (!r.rows[0]) return res.json({ url: null, msg: msgSemContrato });
    // Mostra somente o PDF assinado (documento final, escaneado) — nunca o rascunho gerado antes da assinatura
    if (!r.rows[0].pdf_assinado_chave) return res.json({ url: null, msg: msgSemContrato, status: r.rows[0].status });
    // Serve pelo proxy same-origin (/membro/contrato/pdf). O iframe apontando direto
    // pro R2 e bloqueado pelo CSP (frame-src so 'self') — por isso o contrato aparecia em branco.
    res.json({ url: '/membro/contrato/pdf', status: r.rows[0].status });
  } catch(e) { res.json({ url: null, msg: 'Erro ao carregar contrato.' }); }
});

// Serve o PDF do contrato assinado pelo proprio servidor (same-origin), para o iframe
// do portal poder exibir sem ser bloqueado pelo CSP frame-src. Mesmo padrao do proxy
// de materiais. Cada membro so acessa o proprio contrato (via sessao do portal).
router.get('/membro/contrato/pdf', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const r = tipo === 'ligante'
      ? await query('SELECT pdf_assinado_chave FROM contratos_ligantes WHERE ligante_id=$1 ORDER BY criado_em DESC LIMIT 1', [id])
      : await query('SELECT pdf_assinado_chave FROM contratos_diretivos WHERE diretivo_id=$1 ORDER BY criado_em DESC LIMIT 1', [id]);
    const chave = r.rows[0] && r.rows[0].pdf_assinado_chave;
    if (!chave) return res.status(404).send('Contrato nao disponivel');
    const { gerarUrlTemporaria } = require('../services/arquivos');
    const url = await gerarUrlTemporaria(chave, 60);
    const axios = require('axios');
    const resp = await axios.get(url, { responseType: 'stream', timeout: 30000 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    resp.data.pipe(res);
  } catch(e) { res.status(500).send('Erro ao carregar contrato'); }
});

// Admin upload estatuto/regulamento
router.post('/admin/portal/estatuto', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('estatuto_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
router.post('/admin/portal/regulamento', requireAuth, require('../services/arquivos').upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.json({ ok: false, msg: 'Nenhum arquivo.' });
  const chave = req.file.key || req.file.filename;
  await query("INSERT INTO configuracoes (chave, valor) VALUES ('regulamento_pdf_chave', $1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [chave]);
  res.json({ ok: true, chave });
});
// GET /membro/chat/mensagens
router.get('/membro/chat/mensagens', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const [r, atR] = await Promise.all([
      query('SELECT id, autor, texto, criado_em, lido_admin, remetente_nome FROM portal_mensagens WHERE origem_tipo=$1 AND origem_id=$2 ORDER BY criado_em ASC LIMIT 100', [tipo, id]),
      query("SELECT status FROM lauro_atendimentos WHERE numero_membro=$1 AND origem='portal' ORDER BY criado_em DESC LIMIT 1", ['portal-' + tipo + '-' + id])
    ]);
    await query("UPDATE portal_mensagens SET lido_membro=true WHERE origem_tipo=$1 AND origem_id=$2 AND autor='admin'", [tipo, id]);
    const encerrado = atR.rows.length > 0 && atR.rows[0].status === 'encerrado';
    res.json({ mensagens: r.rows, encerrado });
  } catch(e) { res.json({ mensagens: [], error: e.message }); }
});

// POST /membro/chat/enviar (fallback sem socket)
router.post('/membro/chat/enviar', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.json({ ok: false });
  try {
    const { registrarMensagemMembro } = require('../services/portal-chat');
    const r = await registrarMensagemMembro(query, tipo, id, texto.trim());
    const io = req.app._io;
    if (io) io.to('admins').emit('chat_novo', { tipo, id, texto: texto.trim(), nome: r.nome, atendimentoId: r.atendimentoId });
    res.json({ ok: true, msg: { id: r.id, criado_em: r.criado_em } });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// ─── FIM PORTAL DO MEMBRO ─────────────────────────────────────────────────────

// GET /membro/esqueci-senha

// Materiais de estudo — portal do membro (redireciona para dashboard novo portal)
router.get('/membro/materiais', requireMembro, (req, res) => {
  res.redirect('/membro/dashboard#materiais');
});
router.get('/membro/materiais/dados', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  res.json({ materiais: materiais.rows });
});
// GET /membro/cientifico/dados
router.get('/membro/cientifico/dados', requireMembro, async (req, res) => {
  const { tipo, id } = req.session.membroPortal;
  try {
    const grR = await query(`
      SELECT gc.id as grupo_id, gc.nome as grupo_nome, gc.tipo_trabalho, gc.status as grupo_status,
             pc.id as projeto_id, pc.titulo as projeto_titulo, COALESCE(gc.prazo, pc.prazo) as prazo, pc.status as projeto_status,
             (SELECT status FROM versoes_trabalho v WHERE v.grupo_id=gc.id ORDER BY v.enviado_em DESC LIMIT 1) as ultimo_status,
             (SELECT ru.nome FROM versoes_trabalho v LEFT JOIN usuarios ru ON ru.id=v.revisor_atual_id WHERE v.grupo_id=gc.id ORDER BY v.enviado_em DESC LIMIT 1) as revisor_atual_nome,
             (SELECT COUNT(*) FROM versoes_trabalho v WHERE v.grupo_id=gc.id AND v.status IN ('aguardando','em_revisao')) as pendentes
      FROM membros_grupo_cientifico m
      JOIN grupos_cientificos gc ON gc.id=m.grupo_id
      JOIN projetos_cientificos pc ON pc.id=gc.projeto_id
      WHERE m.origem_tipo=$1 AND m.origem_id=$2
      ORDER BY COALESCE(gc.prazo, pc.prazo) ASC NULLS LAST
    `, [tipo, id]);
    const grupoIds = grR.rows.map(g => g.grupo_id);
    const projetoIds = [...new Set(grR.rows.map(g => g.projeto_id))];
    let avisos = [];
    if (grupoIds.length || projetoIds.length) {
      const avR = await query(`
        SELECT a.texto, a.criado_em, g.nome as grupo_nome
        FROM avisos_cientificos a
        LEFT JOIN grupos_cientificos g ON g.id=a.grupo_id
        WHERE a.grupo_id = ANY($1::int[]) OR a.projeto_id = ANY($2::int[])
        ORDER BY a.criado_em DESC LIMIT 10
      `, [grupoIds, projetoIds]);
      avisos = avR.rows;
    }
    res.json({ grupos: grR.rows, avisos, portalUrl: 'https://cientifico.lauroucpcde.com' });
  } catch(e) { res.json({ grupos: [], avisos: [], erro: e.message }); }
});

router.get('/membro/materiais-lista', requireMembro, async (req, res) => {
  const materiais = await query("SELECT * FROM materiais_estudo WHERE ativo=true ORDER BY ordem ASC, criado_em DESC");
  const membro = await getMembroPortal(req.session.membroPortal.tipo, req.session.membroPortal.id);
  res.render('pages/membro/materiais', { membro, materiais: materiais.rows });
});

router.get('/membro/esqueci-senha', (req, res) => {
  res.render('pages/membro/esqueci-senha', { erro: null, ok: null });
});

// POST /membro/esqueci-senha
router.post('/membro/esqueci-senha', limiterEsqueciSenha, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('pages/membro/esqueci-senha', { erro: 'Informe o email.', ok: null });
  // Buscar ligante ou diretivo
  let tipo = null, id = null;
  const l = await query('SELECT id FROM ligantes WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
  if (l.rows.length) { tipo = 'ligante'; id = l.rows[0].id; }
  if (!tipo) {
    const d = await query('SELECT id FROM diretivos WHERE LOWER(email)=LOWER($1) AND ativo=1', [email]);
    if (d.rows.length) { tipo = 'diretivo'; id = d.rows[0].id; }
  }
  // Nao revelar se email existe ou nao (seguranca)
  if (!tipo) return res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
  // Gerar codigo de 6 digitos (crypto.randomInt — nao previsivel como Math.random)
  const codigo = require('crypto').randomInt(100000, 1000000).toString();
  const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
  // Invalidar codigos anteriores
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE email=LOWER($1) AND usado=false', [email]);
  // Salvar novo codigo
  await query('INSERT INTO recuperacao_senha_portal (origem_tipo, origem_id, email, codigo, expira_em) VALUES ($1,$2,LOWER($3),$4,$5)', [tipo, id, email, codigo, expira]);
  // Enviar email
  try {
    const { enviarEmail } = require('../services/notificacoes');
    const config = await getConfig();
    const orgNome = config.org_nome || 'LAURO - Liga Academica de Urologia';
    await enviarEmail({
      para: email,
      assunto: 'Codigo de recuperacao de senha — ' + orgNome,
      html: `<div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0C231B;margin-bottom:8px">${orgNome}</h2>
        <p style="color:#6B7A72;margin-bottom:24px">Portal do Membro</p>
        <p style="margin-bottom:16px">Voce solicitou a recuperacao de senha. Use o codigo abaixo para redefinir sua senha:</p>
        <div style="background:#0C231B;color:#4ade80;font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;margin:24px 0">${codigo}</div>
        <p style="color:#6B7A72;font-size:13px">Este codigo expira em <strong>15 minutos</strong>.</p>
        <p style="color:#6B7A72;font-size:13px;margin-top:8px">Se nao foi voce, ignore este email.</p>
        <hr style="border:none;border-top:1px solid #E5EBE8;margin:24px 0">
        <p style="color:#9BA8A4;font-size:11px">Portal do Membro — <a href="https://membro.lauroucpcde.com" style="color:#0F6E56">membro.lauroucpcde.com</a></p>
      </div>`
    });
  } catch(e) { console.error('Erro ao enviar email recuperacao:', e.message); }
  res.render('pages/membro/esqueci-senha', { erro: null, ok: 'Se o email estiver cadastrado, voce recebera o codigo em instantes.' });
});

// GET /membro/verificar-codigo
router.get('/membro/verificar-codigo', (req, res) => {
  const email = req.query.email || '';
  res.render('pages/membro/verificar-codigo', { email, erro: null });
});

// POST /membro/verificar-codigo
router.post('/membro/verificar-codigo', limiterCodigoRecuperacao, async (req, res) => {
  const { email, codigo, nova_senha, confirmar_senha } = req.body;
  if (!codigo || !nova_senha || !confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'Preencha todos os campos.' });
  if (nova_senha !== confirmar_senha) return res.render('pages/membro/verificar-codigo', { email, erro: 'As senhas nao conferem.' });
  if (nova_senha.length < 8) return res.render('pages/membro/verificar-codigo', { email, erro: 'A senha deve ter pelo menos 8 caracteres.' });
  // Verificar codigo
  const r = await query('SELECT * FROM recuperacao_senha_portal WHERE LOWER(email)=LOWER($1) AND codigo=$2 AND usado=false AND expira_em > NOW() ORDER BY criado_em DESC LIMIT 1', [email, codigo.trim()]);
  if (!r.rows.length) return res.render('pages/membro/verificar-codigo', { email, erro: 'Codigo invalido ou expirado. Solicite um novo codigo.' });
  const rec = r.rows[0];
  // Atualizar senha
  const hash = await bcryptMembro.hash(nova_senha, 10);
  await query('UPDATE portal_cientifico_senhas SET senha_hash=$1, primeiro_acesso=false WHERE origem_tipo=$2 AND origem_id=$3', [hash, rec.origem_tipo, rec.origem_id]);
  // Marcar codigo como usado
  await query('UPDATE recuperacao_senha_portal SET usado=true WHERE id=$1', [rec.id]);
  res.redirect('/membro/login?msg=Senha+redefinida+com+sucesso');
});


};
