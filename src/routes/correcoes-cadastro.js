// ═══ CORREÇÕES DE CADASTRO (autoatualização feita pelo proprio ligante/diretivo no Portal) ═══
const { query } = require('../models/database');
const { requireAuth, requireSecretaria } = require('../middleware/auth');
const { getConfig } = require('../services/config');
const { logAtividade } = require('../services/log-atividade');
const { CAMPOS_MEUS_DADOS } = require('../services/campos-meus-dados');

module.exports = function (router) {

router.get('/correcoes-cadastro', requireAuth, requireSecretaria, async (req, res) => {
  const config = await getConfig();
  const msg = req.session.msg||[]; req.session.msg=[];
  const erro = req.session.erro||[]; req.session.erro=[];
  const r = await query("SELECT * FROM cadastro_correcoes WHERE status='pendente' ORDER BY criado_em ASC");
  const correcoes = await Promise.all(r.rows.map(async c => {
    const atualR = await query(`SELECT * FROM ${c.origem_tipo === 'ligante' ? 'ligantes' : 'diretivos'} WHERE id=$1`, [c.origem_id]);
    return { ...c, atual: atualR.rows[0] || null };
  }));
  res.render('pages/correcoes-cadastro', { config, usuario: req.session.usuario, correcoes, msg, erro });
});

router.post('/correcoes-cadastro/:id/aprovar', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query('SELECT * FROM cadastro_correcoes WHERE id=$1 AND status=$2', [req.params.id, 'pendente']);
  const c = r.rows[0];
  if (!c) { req.session.erro = ['Correção não encontrada ou já avaliada.']; return res.redirect('/correcoes-cadastro'); }
  const tabela = c.origem_tipo === 'ligante' ? 'ligantes' : 'diretivos';
  const campos = CAMPOS_MEUS_DADOS[c.origem_tipo];
  // Aprovou = cadastro já corrigido: refecha a liberação individual, que senão fica aberta p/ sempre.
  // (Não mexe na liberação em grupo: essa é global e a diretoria desliga quando a campanha acaba.)
  const sets = campos.map((campo, i) => `${campo}=$${i+1}`).join(',') + ', edicao_liberada=false';
  const valores = campos.map(campo => c.dados[campo]);
  const _oldC = (await query(`SELECT email FROM ${tabela} WHERE id=$1`, [c.origem_id])).rows[0];
  await query(`UPDATE ${tabela} SET ${sets} WHERE id=$${campos.length+1}`, [...valores, c.origem_id]);
  // Propaga a atualizacao cadastral (feita pelo membro no portal e aprovada) p/ o financeiro (membros).
  if (_oldC && _oldC.email) {
    const _n = (await query(`SELECT nome,email,cpf,whatsapp,data_nascimento FROM ${tabela} WHERE id=$1`, [c.origem_id])).rows[0];
    if (_n) await query("UPDATE membros SET nome=$1, email=COALESCE(NULLIF($2,''),email), cpf=$3, whatsapp=$4, data_nascimento=$5 WHERE LOWER(email)=LOWER($6)", [_n.nome, _n.email, _n.cpf||null, _n.whatsapp||null, _n.data_nascimento||null, _oldC.email]).catch(()=>{});
  }
  await query("UPDATE cadastro_correcoes SET status='aprovado', avaliado_por=$1, avaliado_em=NOW() WHERE id=$2", [req.session.usuario.id, req.params.id]);
  await logAtividade(req.session.usuario.id, 'CORRECAO_CADASTRO_APROVADA', c.origem_tipo + ' ID ' + c.origem_id, req);
  req.session.msg = ['Correção aplicada ao cadastro com sucesso!'];
  res.redirect('/correcoes-cadastro');
});

router.post('/correcoes-cadastro/:id/rejeitar', requireAuth, requireSecretaria, async (req, res) => {
  const r = await query("UPDATE cadastro_correcoes SET status='rejeitado', avaliado_por=$1, avaliado_em=NOW() WHERE id=$2 AND status='pendente' RETURNING origem_tipo, origem_id", [req.session.usuario.id, req.params.id]);
  if (r.rows.length) await logAtividade(req.session.usuario.id, 'CORRECAO_CADASTRO_REJEITADA', r.rows[0].origem_tipo + ' ID ' + r.rows[0].origem_id, req);
  req.session.msg = ['Correção rejeitada.'];
  res.redirect('/correcoes-cadastro');
});

};
