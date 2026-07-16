// ═══ DIRETIVOS ══════════════════════════════════════════════════════════════
const bcryptCient = require('bcrypt');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireSecretaria } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');

module.exports = function (router) {

router.get('/cadastro-diretivo', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-diretivo-publico', { config, msg, erro, form: {}, appUrl: process.env.APP_URL || '' });
});

router.post('/cadastro-diretivo', require('../services/arquivos').upload.single('foto'), async (req, res) => {
  try {
    const { nome, rg, cpf, email, catraca, cargo, semestre_turma, orcid, data_nascimento, sexo,
            whatsapp, instagram, graduacao, ano_ingresso, onde_reside, transporte_proprio,
            tipo_transporte, experiencia_urologia } = req.body;
    const disponibilidade = [].concat(req.body.disponibilidade || []).join(', ');
    const camposObrigatorios = { nome, rg, cpf, email, catraca, cargo, semestre_turma, orcid, data_nascimento, sexo,
      instagram, graduacao, ano_ingresso, onde_reside, transporte_proprio, experiencia_urologia,
      whatsapp: whatsapp || req.body.whatsapp_num, disponibilidade: disponibilidade || null };
    const faltandoDiretivo = Object.keys(camposObrigatorios).filter(c => !camposObrigatorios[c] || !String(camposObrigatorios[c]).trim());
    if (transporte_proprio === 'Sim' && (!tipo_transporte || !tipo_transporte.trim())) faltandoDiretivo.push('tipo_transporte');
    if (faltandoDiretivo.length > 0) { req.session.erro = ['Preencha todos os campos obrigatórios.']; return res.redirect('/cadastro-diretivo'); }
    if (!req.file) { req.session.erro = ['A foto é obrigatória para o cadastro.']; return res.redirect('/cadastro-diretivo'); }
    // Upload de foto se enviada
    let foto_chave = null;
    if (req.file) {
      try {
        const { uploadArquivo } = require('../services/arquivos');
        const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'diretivos');
        foto_chave = r.chave;
      } catch(ef) { console.error('Erro upload foto diretivo:', ef.message); }
    }
    const whatsappNum = whatsapp || ((req.body.ddi||'')+' '+(req.body.whatsapp_num||'')).trim() || null;
    const r = await query(
      `INSERT INTO diretivos (nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,data_nascimento,sexo,
        whatsapp,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,tipo_transporte,
        disponibilidade,experiencia_urologia,foto_chave,pendente,cadastrado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,NOW())
       RETURNING id`,
      [nome,rg,cpf,email,catraca,cargo,semestre_turma,orcid,(data_nascimento&&data_nascimento.trim()&&data_nascimento!='Invalid Date'?data_nascimento:null),sexo,
       whatsappNum,instagram,graduacao,ano_ingresso,onde_reside,transporte_proprio,
       tipo_transporte,disponibilidade,experiencia_urologia,foto_chave]
    );
    console.log('Cadastro diretivo OK — id:', r.rows[0].id, 'nome:', nome, 'email:', email);
    req.session.msg = ['Cadastro realizado com sucesso! Obrigado, ' + nome.split(' ')[0] + '! Aguarde a aprovacao da diretoria.'];
    res.redirect('/cadastro-diretivo');
  } catch(e) {
    console.error('Erro cadastro diretivo DETALHADO:', e.message, e.stack);
    req.session.erro = ['Erro ao cadastrar: ' + e.message + '. Tente novamente.'];
    res.redirect('/cadastro-diretivo');
  }
});

router.get('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  const statusFiltro = req.query.status || 'ativos';
  let whereAtivo;
  if (statusFiltro === 'pendente') whereAtivo = 'pendente=true';
  else if (statusFiltro === 'inativos') whereAtivo = 'ativo=0 AND pendente=false';
  else if (statusFiltro === 'todos') whereAtivo = 'pendente=false';
  else whereAtivo = 'ativo=1 AND pendente=false';
  const r = await query('SELECT * FROM diretivos WHERE ' + whereAtivo + ' ORDER BY cargo, nome');
  const pcR = await query('SELECT COUNT(*) n FROM diretivos WHERE pendente=true');
  const pendentesCount = parseInt(pcR.rows[0].n);
  res.render('pages/diretivos', {
    config, msg, erro, diretivos: r.rows, usuario: req.session.usuario,
    appUrl: process.env.APP_URL || 'https://liga-urologia.onrender.com',
    statusFiltro, pendentesCount
  });
});

router.post('/diretivos', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, cargo, semestre_turma, data_nascimento, sexo, onde_reside, disponibilidade } = req.body;
  await query('INSERT INTO diretivos (nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento,sexo,onde_reside,disponibilidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [nome,rg,cpf,email,whatsapp,cargo,semestre_turma,data_nascimento||null,sexo||null,onde_reside,disponibilidade]);
  req.session.msg = ['Diretivo cadastrado com sucesso!'];
  res.redirect('/diretivos');
});

router.get('/diretivos/:id/aprovar', requireAuth, requireSecretaria, async (req, res) => {
  await query('UPDATE diretivos SET pendente=false, ativo=1 WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'DIRETIVO_LIBERADO', 'Cadastro pendente liberado ID: ' + req.params.id, req);

  // Libera acesso ao Portal de Membros (senha padrao 123456, obriga trocar no primeiro acesso).
  try {
    const jaTemSenha = await query('SELECT 1 FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', ['diretivo', req.params.id]);
    if (!jaTemSenha.rows.length) {
      const hashPadrao = await bcryptCient.hash('123456', 10);
      await query('INSERT INTO portal_cientifico_senhas (origem_tipo,origem_id,senha_hash,primeiro_acesso) VALUES ($1,$2,$3,true)', ['diretivo', req.params.id, hashPadrao]);
    }
  } catch(e) { console.error('[Portal] Erro ao liberar acesso do diretivo:', e.message); }

  req.session.msg = ['Cadastro de diretivo liberado com sucesso!'];
  res.redirect('/diretivos?status=pendente');
});
router.get('/diretivos/:id/excluir', requireAuth, requireSecretaria, async (req, res) => {
  await query('DELETE FROM diretivos WHERE id=$1 AND pendente=true', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'DIRETIVO_RECUSADO', 'Cadastro pendente recusado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro pendente recusado e removido.'];
  res.redirect('/diretivos?status=pendente');
});

router.post('/diretivos/:id(\\d+)/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const r = await query('SELECT edicao_liberada, nome FROM diretivos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) { req.session.erro = ['Diretivo não encontrado.']; return res.redirect('/diretivos'); }
    const novo = !r.rows[0].edicao_liberada;
    await query('UPDATE diretivos SET edicao_liberada=$1 WHERE id=$2', [novo, req.params.id]);
    await logAtividade(req.session.usuario.id, novo ? 'DIRETIVO_EDICAO_LIBERADA' : 'DIRETIVO_EDICAO_BLOQUEADA', r.rows[0].nome, req);
    req.session.msg = [novo ? 'Edição de cadastro liberada para este diretivo.' : 'Edição de cadastro bloqueada para este diretivo.'];
  } catch(e) { req.session.erro = ['Erro ao alterar edição: ' + e.message]; }
  res.redirect('/diretivos');
});

router.post('/diretivos/:id/editar', requireAuth, requireSecretaria, (req, res) => {
  const { upload, uploadArquivo } = require('../services/arquivos');
  upload.single('foto')(req, res, async (err) => {
    try {
      if (err) { req.session.erro = ['Erro no upload da foto: ' + err.message]; return res.redirect('/diretivos'); }
      const { nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento,sexo,
              onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
              transporte_proprio,tipo_transporte } = req.body;
      const _oldEmailD=(await query('SELECT email FROM diretivos WHERE id=$1',[req.params.id])).rows[0];
      // Foto: se enviada, sobe ao R2 e atualiza foto_chave; se não, mantém a atual
      let setFoto = '';
      const params = [nome,rg,cpf,email,whatsapp,instagram,catraca,cargo,semestre_turma,data_nascimento||null,sexo||null,
                      onde_reside,disponibilidade,ano_ingresso,orcid,graduacao,experiencia_urologia,
                      transporte_proprio,tipo_transporte];
      if (req.body.remover_foto === '1') {
        // Usuário pediu para remover a foto: zera foto_chave
        setFoto = ', foto_chave=$' + params.length;
      } else if (req.file && req.file.buffer && req.file.size > 0) {
        const r = await uploadArquivo(req.file.buffer, 'diretivo-'+req.params.id+'.'+(req.file.mimetype.split('/')[1]||'jpg'), req.file.mimetype, 'diretivos');
        params.push(r.chave);
        setFoto = ', foto_chave=$' + params.length;
      }
      params.push(req.params.id);
      await query(
        `UPDATE diretivos SET nome=$1,rg=$2,cpf=$3,email=$4,whatsapp=$5,instagram=$6,catraca=$7,
         cargo=$8,semestre_turma=$9,data_nascimento=$10,sexo=$11,onde_reside=$12,disponibilidade=$13,
         ano_ingresso=$14,orcid=$15,graduacao=$16,experiencia_urologia=$17,
         transporte_proprio=$18,tipo_transporte=$19` + setFoto + ` WHERE id=$` + params.length,
        params
      );
      // Propaga os dados compartilhados p/ o cadastro FINANCEIRO (membros), casando pelo e-mail
      // anterior. Tudo que a secretaria altera reflete na mensalidade automaticamente.
      if(_oldEmailD && _oldEmailD.email){
        await query("UPDATE membros SET nome=$1, email=COALESCE(NULLIF($2,''),email), cpf=$3, whatsapp=$4, data_nascimento=$5 WHERE LOWER(email)=LOWER($6)",
          [nome, email, cpf||null, whatsapp||null, data_nascimento||null, _oldEmailD.email]).catch(()=>{});
      }
      req.session.msg = ['Diretivo atualizado com sucesso!'];
      res.redirect('/diretivos');
    } catch (e) {
      req.session.erro = ['Erro ao atualizar diretivo: ' + e.message];
      res.redirect('/diretivos');
    }
  });
});

router.get('/diretivos/:id/foto', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM diretivos WHERE id=$1', [req.params.id]);
    const d = r.rows[0];
    if (!d || !d.foto_chave) return res.status(404).send('Foto nao encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: d.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.post('/diretivos/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT ativo, email, cpf, nome, whatsapp FROM diretivos WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE diretivos SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  // Sincronizar membros (cadastro financeiro) automaticamente ao inativar/ativar diretivo - mesma logica do toggle de ligante
  try {
    const { email, cpf, nome, whatsapp } = r.rows[0];
    const memStatus = novoStatus === 1 ? 'ativo' : 'inativo';
    if (email) await query("UPDATE membros SET ativo=$1, status=$2 WHERE email=$3", [novoStatus, memStatus, email]);
    if (cpf) await query("UPDATE membros SET ativo=$1, status=$2 WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($3,'[^0-9]','','g')", [novoStatus, memStatus, cpf]).catch(()=>{});
    if (nome) await query("UPDATE membros SET ativo=$1, status=$2 WHERE LOWER(TRIM(nome))=LOWER(TRIM($3))", [novoStatus, memStatus, nome]).catch(()=>{});
    if (whatsapp) await query("UPDATE membros SET ativo=$1 WHERE whatsapp=$2 AND (email IS NULL OR email='')", [novoStatus, whatsapp]).catch(()=>{});
    if (novoStatus === 0) {
      if (cpf) await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($1,'[^0-9]','','g')) AND status IN ('pendente','atrasado')", [cpf]).catch(()=>{});
      if (email) await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE email=$1) AND status IN ('pendente','atrasado')", [email]).catch(()=>{});
    }
  } catch(e) {}
  if (novoStatus === 0 && motivo) {
    await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['diretivo', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
  }
  req.session.msg = [novoStatus == 1 ? 'Diretivo reativado! Cadastro financeiro sincronizado.' : 'Diretivo inativado, cobranças canceladas e cadastro financeiro atualizado!'];
  res.redirect('/diretivos' + (req.query.status ? '?status=' + req.query.status : ''));
});

router.post('/diretivos/grupo/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query("SELECT valor FROM configuracoes WHERE chave='edicao_diretivos_grupo'");
  const novo = (r.rows[0]?.valor === '1') ? '0' : '1';
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('edicao_diretivos_grupo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [novo]);
  req.session.msg = [novo === '1' ? 'Edição de cadastro liberada para todos os diretivos.' : 'Edição de cadastro em grupo bloqueada para os diretivos.'];
  res.redirect('/diretivos');
});

router.get('/diretivos/relatorio', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', cargo: q.cargo||'todos', semestre_turma: q.semestre_turma||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','cargo','semestre_turma','whatsapp','status'] };
  let where = [];
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.cargo !== 'todos') where.push(`cargo = '${filtros.cargo.replace(/'/g,"''")}'`);
  if (filtros.semestre_turma !== 'todos') where.push(`semestre_turma = '${filtros.semestre_turma.replace(/'/g,"''")}'`);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', cargo:'cargo ASC', semestre_turma:'semestre_turma ASC', cadastrado_em:'cadastrado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM diretivos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, cargosR, semestresR] = await Promise.all([
    query(sql),
    query("SELECT DISTINCT cargo FROM diretivos WHERE cargo IS NOT NULL AND cargo <> '' ORDER BY cargo"),
    query("SELECT DISTINCT semestre_turma FROM diretivos WHERE semestre_turma IS NOT NULL AND semestre_turma <> '' ORDER BY semestre_turma")
  ]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',instagram:'Instagram',cargo:'Cargo',semestre_turma:'Semestre/Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',data_nascimento:'Nascimento',ano_ingresso:'Ano ingresso',orcid:'ORCID',status:'Status',cadastrado_em:'Cadastro'}[col] || col);
  res.render('pages/diretivos-relatorio', { config, usuario: req.session.usuario, diretivos: r.rows, filtros, cargos: cargosR.rows.map(x=>x.cargo).filter(Boolean), semestresTurmas: semestresR.rows.map(x=>x.semestre_turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

};
