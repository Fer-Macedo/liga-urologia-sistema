// ═══ LIGANTES ═══════════════════════════════════════════════════════════════
const bcryptCient = require('bcrypt');
const { query } = require('../models/database');
const { requireAuth, requireAdmin, requireSecretaria, requirePermissao } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');

module.exports = function (router) {

router.get('/cadastro-ligante', async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg || []; req.session.msg = [];
  const erro = req.session.erro || []; req.session.erro = [];
  res.render('pages/cadastro-ligante-publico', { config, msg, erro, form: {} });
});

router.post('/cadastro-ligante', require('../services/arquivos').upload.single('foto'), async (req, res) => {
  const config = await getConfig();
  try {
    const { upload, uploadArquivo } = require('../services/arquivos');
    upload.single('foto')(req, res, async (err) => {
      const form = req.body;
      form.whatsapp = form.whatsapp || ((form.ddi||'')+(form.whatsapp_num||'').replace(/\D/g,'')).trim() || null;
      const campos = ['nome','data_nascimento','sexo','email','email_alternativo','whatsapp','rg','cpf','semestre','turma','catraca','orcid','tem_formacao','habilidades','aceita_cargo','contribuicao_grupo','ideia_inovadora','tema_interesse','porque_lauro','apresentacao'];
      const faltando = campos.filter(c => !form[c] || form[c].trim() === '');
      if (form.tem_formacao === 'Sim' && (!form.qual_formacao || form.qual_formacao.trim()==='')) faltando.push('qual_formacao');
      if (form.aceita_cargo === 'Sim' && (!form.qual_cargo || form.qual_cargo.trim()==='')) faltando.push('qual_cargo');
      if (faltando.length > 0) { req.session.erro = ['Preencha todos os campos obrigatórios.']; return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form }); }
      if (!req.file) { req.session.erro = ['A foto é obrigatória para o cadastro.']; return res.render('pages/cadastro-ligante-publico', { config, msg: [], erro: req.session.erro, form }); }
      let foto_chave = null;
      if (req.file) { const r = await uploadArquivo(req.file.buffer, req.file.originalname, req.file.mimetype, 'ligantes'); foto_chave = r.chave; }
      await query(`INSERT INTO ligantes (nome, data_nascimento, sexo, email, email_alternativo, whatsapp, rg, cpf, semestre, turma, catraca, orcid, tem_formacao, qual_formacao, habilidades, aceita_cargo, qual_cargo, contribuicao_grupo, ideia_inovadora, tema_interesse, porque_lauro, apresentacao, foto_chave, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())`,
      [form.nome, form.data_nascimento, form.sexo, form.email, form.email_alternativo||null, form.whatsapp, form.rg, form.cpf||null, form.semestre, form.turma, form.catraca||null, form.orcid||null, form.tem_formacao||null, form.qual_formacao||null, form.habilidades||null, form.aceita_cargo||null, form.qual_cargo||null, form.contribuicao_grupo||null, form.ideia_inovadora||null, form.tema_interesse||null, form.porque_lauro, form.apresentacao, foto_chave]);
      req.session.msg = ['Cadastro realizado com sucesso! Bem-vindo(a) à LAURO!'];
      res.redirect('/cadastro-ligante');
    });
  } catch(e) { console.error('Erro cadastro ligante:', e.message); req.session.erro = ['Erro ao salvar cadastro. Tente novamente.']; res.redirect('/cadastro-ligante'); }
});

router.post('/ligantes', requireAuth, requireSecretaria, async (req, res) => {
  const { nome, rg, cpf, email, whatsapp, data_nascimento, sexo, semestre, turma, catraca } = req.body;
  await query('INSERT INTO ligantes (nome,rg,cpf,email,whatsapp,data_nascimento,sexo,semestre,turma,catraca) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [nome,rg,cpf,email,whatsapp,data_nascimento||null,sexo||null,semestre,turma,catraca||null]);
  req.session.msg = ['Ligante cadastrado com sucesso!'];
  res.redirect('/ligantes');
});

router.get('/ligantes', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg = [];
  const erro = req.session.erro||[]; req.session.erro = [];
  const sfL = req.query.status || 'ativos';
  let whereAtivo;
  if (sfL === 'pendente') whereAtivo = 'WHERE pendente=true';
  else if (sfL === 'inativos') whereAtivo = 'WHERE ativo=0 AND pendente=false';
  else if (sfL === 'todos') whereAtivo = 'WHERE pendente=false';
  else whereAtivo = 'WHERE ativo=1 AND pendente=false';
  const r = await query('SELECT * FROM ligantes ' + whereAtivo + ' ORDER BY nome ASC');
  const ligantes = r.rows;
  const totR = await query('SELECT COUNT(*) t FROM ligantes WHERE pendente=false');
  const atvR = await query('SELECT COUNT(*) t FROM ligantes WHERE ativo=1 AND pendente=false');
  const pcR = await query('SELECT COUNT(*) n FROM ligantes WHERE pendente=true');
  const total = parseInt(totR.rows[0].t);
  const ativos = parseInt(atvR.rows[0].t);
  const inativos = total - ativos;
  const pendentesCount = parseInt(pcR.rows[0].n);
  res.render('pages/ligantes', { config, usuario: req.session.usuario, ligantes, msg, erro, total, ativos, inativos, statusFiltro: sfL, pendentesCount });
});

router.get('/ligantes/:id/aprovar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('UPDATE ligantes SET pendente=false, ativo=1 WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_APROTADMo', 'Ligante aprovado ID: ' + req.params.id, req);

  // Libera acesso ao Portal de Membros (senha padrao 12345678, obriga trocar no primeiro acesso).
  try {
    const jaTemSenha = await query('SELECT 1 FROM portal_cientifico_senhas WHERE origem_tipo=$1 AND origem_id=$2', ['ligante', req.params.id]);
    if (!jaTemSenha.rows.length) {
      const hashPadrao = await bcryptCient.hash('12345678', 10);
      await query('INSERT INTO portal_cientifico_senhas (origem_tipo,origem_id,senha_hash,primeiro_acesso) VALUES ($1,$2,$3,true)', ['ligante', req.params.id, hashPadrao]);
    }
  } catch(e) { console.error('[Portal] Erro ao liberar acesso do ligante:', e.message); }

  // AUTO-CADASTRO FINANCEIRO: ao aprovar ligante, criar membro automaticamente se nao existir
  try {
    const ligR = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
    const lig = ligR.rows[0];
    if (lig) {
      const cpfVal = lig.cpf || '';
      const emailVal = lig.email || '';
      const jaExiste = await query(
        'SELECT id FROM membros WHERE (cpf IS NOT NULL AND cpf <> $3 AND cpf = $1) OR (email IS NOT NULL AND email <> $3 AND email = $2)',
        [cpfVal, emailVal, '']
      );
      if (jaExiste.rows.length === 0) {
        await query(
          'INSERT INTO membros (nome, cpf, email, whatsapp, data_nascimento, rg, catraca, dia_vencimento, mensalidade, ativo, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            lig.nome || '',
            lig.cpf || null,
            lig.email || null,
            lig.whatsapp || null,
            lig.data_nascimento || null,
            lig.rg || null,
            lig.catraca || null,
            15,
            25.00,
            1,
            'Cadastro automatico via aprovacao de ligante ID: ' + lig.id
          ]
        );
        console.log('[AUTO-MEMBRO] Criado para ligante:', lig.nome, '| ID ligante:', lig.id);
      } else {
        console.log('[AUTO-MEMBRO] Ja existe membro com CPF/email do ligante:', lig.nome, '- pulando');
      }
    }
  } catch(e) {
    console.error('[AUTO-MEMBRO] Erro ao criar membro automatico:', e.message);
  }

  req.session.msg = ['Ligante aprovado e cadastrado no financeiro automaticamente!'];
  res.redirect('/ligantes?status=pendente');
});

router.get('/ligantes/:id/excluir-pendente', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  await query('DELETE FROM ligantes WHERE id=$1 AND pendente=true', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_RECUSADO', 'Ligante recusado ID: ' + req.params.id, req);
  req.session.msg = ['Cadastro recusado e removido.'];
  res.redirect('/ligantes?status=pendente');
});

router.post('/ligantes/:id(\\d+)/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  try {
    const r = await query('SELECT edicao_liberada, nome FROM ligantes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) { req.session.erro = ['Ligante não encontrado.']; return res.redirect('/ligantes'); }
    const novo = !r.rows[0].edicao_liberada;
    await query('UPDATE ligantes SET edicao_liberada=$1 WHERE id=$2', [novo, req.params.id]);
    await logAtividade(req.session.usuario.id, novo ? 'LIGANTE_EDICAO_LIBERADA' : 'LIGANTE_EDICAO_BLOQUEADA', r.rows[0].nome, req);
    req.session.msg = [novo ? 'Edição de cadastro liberada para este ligante.' : 'Edição de cadastro bloqueada para este ligante.'];
  } catch(e) { req.session.erro = ['Erro ao alterar edição: ' + e.message]; }
  res.redirect('/ligantes');
});

router.post('/ligantes/grupo/liberar-edicao', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query("SELECT valor FROM configuracoes WHERE chave='edicao_ligantes_grupo'");
  const novo = (r.rows[0]?.valor === '1') ? '0' : '1';
  await query("INSERT INTO configuracoes (chave,valor) VALUES ('edicao_ligantes_grupo',$1) ON CONFLICT (chave) DO UPDATE SET valor=$1", [novo]);
  req.session.msg = [novo === '1' ? 'Edição de cadastro liberada para todos os ligantes.' : 'Edição de cadastro em grupo bloqueada para os ligantes.'];
  res.redirect('/ligantes');
});

router.post('/ligantes/:id/toggle', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const r = await query('SELECT ativo, email FROM ligantes WHERE id=$1', [req.params.id]);
  const atual = r.rows[0]?.ativo;
  const novoStatus = atual == 0 ? 1 : 0;
  const motivo = req.body.motivo || null;
  await query('UPDATE ligantes SET ativo=$1 WHERE id=$2', [novoStatus, req.params.id]);
  // Sincronizar membros automaticamente ao inativar/ativar ligante
  try {
    const email = r.rows[0].email;
    const memStatus = novoStatus === 1 ? 'ativo' : 'inativo';
    if (email) await query("UPDATE membros SET ativo=$1, status=$2 WHERE email=$3", [novoStatus, memStatus, email]);
    // Fallback por CPF (cobre casos de email divergente)
    const cpfLig = r.rows[0].cpf;
    if (cpfLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($3,'[^0-9]','','g')", [novoStatus, memStatus, cpfLig]).catch(()=>{});
    // Fallback por nome exato (último recurso)
    const nomeLig = r.rows[0].nome;
    if (nomeLig) await query("UPDATE membros SET ativo=$1, status=$2 WHERE LOWER(TRIM(nome))=LOWER(TRIM($3))", [novoStatus, memStatus, nomeLig]).catch(()=>{});
    // Cancelar cobranças por CPF e nome também
    if (cpfLig) await query("UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE regexp_replace(cpf,'[^0-9]','','g')=regexp_replace($1,'[^0-9]','','g')) AND status IN ('pendente','atrasado')", [cpfLig]).catch(()=>{});
  } catch(e) {}
  if (novoStatus === 0) {
    // Cancelar cobranças pendentes do membro vinculado ao email do ligante
    const ligR = await query('SELECT email FROM ligantes WHERE id=$1', [req.params.id]);
    if (ligR.rows[0]?.email) {
      await query(
        "UPDATE cobrancas SET status='cancelado' WHERE membro_id IN (SELECT id FROM membros WHERE email=$1) AND status IN ('pendente','atrasado')",
        [ligR.rows[0].email]
      );
      // Sincronizar ativo em membros (cadastro financeiro)
      await query("UPDATE membros SET ativo=$1 WHERE email=$2", [novoStatus, ligR.rows[0].email]);
    }
    // Também sincronizar por whatsapp caso email não bata
    if (ligR.rows[0]?.whatsapp) {
      await query("UPDATE membros SET ativo=$1 WHERE whatsapp=$2 AND ($3::text IS NULL OR email IS NULL OR email='')", [novoStatus, ligR.rows[0].whatsapp, ligR.rows[0].email]);
    }
    if (motivo) {
      await query('INSERT INTO inativacoes_log (tipo, referencia_id, motivo, usuario_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', ['ligante', req.params.id, motivo, req.session.usuario.id]).catch(()=>{});
    }
  }
  await logAtividade(req.session.usuario.id, 'LIGANTE_STATUS', 'Status alterado ID: ' + req.params.id + (motivo ? ' — ' + motivo : ''), req);
  req.session.msg = [novoStatus == 1 ? 'Ligante reativado! Cadastro financeiro sincronizado.' : 'Ligante inativado, cobranças canceladas e cadastro financeiro atualizado!'];
  res.redirect('/ligantes');
});

router.get('/ligantes/:id/foto', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT foto_chave FROM ligantes WHERE id=$1', [req.params.id]);
    const ligante = r.rows[0];
    if (!ligante || !ligante.foto_chave) return res.status(404).send('Foto não encontrada');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const R2 = new S3Client({ region:'auto', endpoint:process.env.R2_ENDPOINT, credentials:{ accessKeyId:process.env.R2_ACCESS_KEY_ID, secretAccessKey:process.env.R2_SECRET_ACCESS_KEY } });
    const url = await getSignedUrl(R2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET||'liga-urologia-files', Key: ligante.foto_chave }), { expiresIn: 3600 });
    res.redirect(url);
  } catch(e) { res.status(500).send('Erro'); }
});

router.get('/ligantes/:id/editar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const r = await query('SELECT * FROM ligantes WHERE id=$1', [req.params.id]);
  const ligante = r.rows[0];
  if (!ligante) { req.session.erro=['Ligante não encontrado.']; return res.redirect('/ligantes'); }
  res.render('pages/ligante-editar', { config, usuario: req.session.usuario, ligante, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

router.post('/ligantes/:id/editar', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  try {
    const {upload,uploadArquivo}=require('../services/arquivos');
    upload.single('foto')(req,res,async(err)=>{
      const b=req.body; let fk=null;
      const _oldEmail=(await query('SELECT email FROM ligantes WHERE id=$1',[req.params.id])).rows[0];
      if(req.file){const r=await uploadArquivo(req.file.buffer,req.file.originalname,req.file.mimetype,'ligantes');fk=r.chave;}
      const fu=fk?',foto_chave=$24':'';
      const p=[b.nome,b.data_nascimento||null,b.sexo,b.email,b.email_alternativo||null,b.whatsapp,b.rg,b.cpf||null,b.semestre,b.turma,b.catraca||null,b.orcid||null,b.tem_formacao||null,b.qual_formacao||null,b.habilidades||null,b.aceita_cargo||null,b.qual_cargo||null,b.contribuicao_grupo||null,b.ideia_inovadora||null,b.tema_interesse||null,b.porque_lauro,b.apresentacao,req.params.id];
      if(fk)p.push(fk);
      await query('UPDATE ligantes SET nome=$1,data_nascimento=$2,sexo=$3,email=$4,email_alternativo=$5,whatsapp=$6,rg=$7,cpf=$8,semestre=$9,turma=$10,catraca=$11,orcid=$12,tem_formacao=$13,qual_formacao=$14,habilidades=$15,aceita_cargo=$16,qual_cargo=$17,contribuicao_grupo=$18,ideia_inovadora=$19,tema_interesse=$20,porque_lauro=$21,apresentacao=$22'+fu+' WHERE id=$23',p);
      // Propaga os dados compartilhados p/ o cadastro FINANCEIRO (membros), casando pelo e-mail
      // anterior. Assim tudo que a secretaria altera reflete na mensalidade automaticamente.
      if(_oldEmail && _oldEmail.email){
        await query("UPDATE membros SET nome=$1, email=COALESCE(NULLIF($2,''),email), cpf=$3, whatsapp=$4, data_nascimento=$5 WHERE LOWER(email)=LOWER($6)",
          [b.nome, b.email, b.cpf||null, b.whatsapp||null, b.data_nascimento||null, _oldEmail.email]).catch(()=>{});
      }
      await logAtividade(req.session.usuario.id,'LIGANTE_EDITADO','Ligante editado: '+b.nome,req);
      req.session.msg=['Ligante atualizado!']; res.redirect('/ligantes');
    });
  } catch(e){req.session.erro=[e.message];res.redirect('/ligantes');}
});

router.post('/ligantes/:id/deletar', requireAuth, requireAdmin, async (req, res) => {
  const r = await query('SELECT nome FROM ligantes WHERE id=$1', [req.params.id]);
  await query('DELETE FROM ligantes WHERE id=$1', [req.params.id]);
  await logAtividade(req.session.usuario.id, 'LIGANTE_DELETADO', 'Ligante excluído: ' + (r.rows[0]?.nome||''), req);
  req.session.msg = ['Ligante excluído com sucesso!'];
  res.redirect('/ligantes');
});
// ─── RELATÓRIO LIGANTES ───────────────────────────────────────────────────────
router.get('/ligantes/relatorio', requireAuth, requirePermissao('ligantes'), async (req, res) => {
  const config = await getConfig();
  const q = req.query;
  const filtros = { status: q.status||'todos', sexo: q.sexo||'todos', semestre: q.semestre||'todos', turma: q.turma||'todos', aceita_cargo: q.aceita_cargo||'todos', tem_formacao: q.tem_formacao||'todos', ordem: q.ordem||'nome', colunas: q.colunas ? (Array.isArray(q.colunas) ? q.colunas : [q.colunas]) : ['nome','email','whatsapp','semestre','turma','rg','catraca','status'] };
  // Filtros por valor viram parametros ($1, $2...), nunca interpolacao. Os nomes de coluna
  // sao literais fixos e o ORDER BY vem de um whitelist (ordens), entao nada do usuario
  // entra na string SQL. Antes os valores eram concatenados com escape manual de aspas.
  let where = [];
  const params = [];
  const eq = (coluna, valor) => { params.push(valor); where.push(`${coluna} = $${params.length}`); };
  if (filtros.status === 'ativo') where.push("ativo = 1");
  if (filtros.status === 'inativo') where.push("ativo = 0");
  if (filtros.sexo !== 'todos') eq('sexo', filtros.sexo);
  if (filtros.semestre !== 'todos') eq('semestre', filtros.semestre);
  if (filtros.turma !== 'todos') eq('turma', filtros.turma);
  if (filtros.aceita_cargo !== 'todos') eq('aceita_cargo', filtros.aceita_cargo);
  if (filtros.tem_formacao !== 'todos') eq('tem_formacao', filtros.tem_formacao);
  const ordens = { nome:'nome ASC', nome_desc:'nome DESC', idade:'data_nascimento DESC', idade_desc:'data_nascimento ASC', semestre:'semestre ASC', turma:'turma ASC', criado_em:'criado_em DESC' };
  const orderBy = ordens[filtros.ordem] || 'nome ASC';
  const sql = `SELECT * FROM ligantes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
  const [r, semestresR, turmasR] = await Promise.all([query(sql, params), query('SELECT DISTINCT semestre FROM ligantes WHERE semestre IS NOT NULL ORDER BY semestre'), query('SELECT DISTINCT turma FROM ligantes WHERE turma IS NOT NULL ORDER BY turma')]);
  const labelColuna = (col) => ({nome:'Nome',email:'E-mail',whatsapp:'WhatsApp',sexo:'Sexo',data_nascimento:'Nascimento',semestre:'Semestre',turma:'Turma',catraca:'Catraca',rg:'RG/CI',cpf:'CPF',orcid:'ORCID',tem_formacao:'Formação',aceita_cargo:'Aceita cargo',habilidades:'Habilidades',status:'Status',criado_em:'Cadastro'}[col] || col);
  res.render('pages/ligantes-relatorio', { config, usuario: req.session.usuario, ligantes: r.rows, filtros, semestres: semestresR.rows.map(x=>x.semestre).filter(Boolean), turmas: turmasR.rows.map(x=>x.turma).filter(Boolean), colunasVisiveis: filtros.colunas, labelColuna, msg: req.session.msg||[], erro: req.session.erro||[] });
  req.session.msg = []; req.session.erro = [];
});

};
